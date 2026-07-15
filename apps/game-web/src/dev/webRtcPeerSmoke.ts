import { WebRtcFrameTransport } from '../net/webRtcFrameTransport';
import {
  connectWebRtcSession,
  type ConnectedWebRtcSession,
  type WebRtcSignalType,
} from '../net/webRtcSession';
import type {
  OnlineFrameEnvelope,
  OnlineFrameSubmission,
} from '../net/onlineInputPump';
import {
  installOnlineSessionLifecycleListeners,
  OnlineSessionLifecycleController,
  type OnlineSessionLifecyclePhase,
  type OnlineSessionSuspendSource,
} from '../net/onlineSessionLifecycle';
import type { PlayerFrameInput } from '../sim/types';

interface PeerSmokeAccount {
  id: string;
  accessToken: string;
}

interface PeerSmokeMatchStart {
  sessionId: string;
  sessionToken: string;
  heartbeatIntervalSeconds?: number;
  transportAttempt: {
    attemptId: string;
  };
  localPlayer: {
    accountId: string;
    side: 'P1' | 'P2';
  };
  peer: {
    accountId: string;
    side: 'P1' | 'P2';
  };
}

interface PeerSmokeIceConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
}

export interface PeerSmokeConnectOptions {
  apiBaseUrl: string;
  account: PeerSmokeAccount;
  match: PeerSmokeMatchStart;
  iceConfig: PeerSmokeIceConfig;
}

export interface PeerSmokeIdentity {
  localAccountId: string;
  remoteAccountId: string;
  side: 'P1' | 'P2';
  sessionId: string;
  connectionPath: 'direct' | 'relay';
}

export interface PeerSmokeTransportDiagnostics {
  channelState: string;
  submitAttempts: number;
  submittedFrames: number;
  acceptedFrames: number;
  submitFailures: number;
  pollAttempts: number;
  polledFrames: number;
  pollFailures: number;
  confirmationAttempts: number;
  confirmationFailures: number;
  protocolErrors: string[];
  recoverableDisconnects: string[];
}

export interface PeerSmokeLifecycleDiagnostics {
  phase: OnlineSessionLifecyclePhase;
  heartbeatRunning: boolean;
  heartbeatRequests: number;
  disconnectRequests: number;
  reconnectRequests: number;
  events: string[];
  errors: string[];
}

interface PeerSmokeSignalResponse {
  signals: Array<{
    signalId: string;
    transportAttemptId: string;
    senderAccountId: string;
    signalType: WebRtcSignalType;
    payload: unknown;
    createdAt: string;
  }>;
}

export interface PeerSmokeRuntime {
  connect(options: PeerSmokeConnectOptions): Promise<PeerSmokeIdentity>;
  getIdentity(): PeerSmokeIdentity | null;
  submitFrame(epoch: number, frame: number, input: PlayerFrameInput): Promise<number>;
  submitFrames(frames: OnlineFrameSubmission[]): Promise<{ acceptedFrames: number }>;
  pollFrames(epoch: number, afterFrame: number): Promise<{
    frames: OnlineFrameEnvelope[];
    peerConfirmedThrough: number;
  }>;
  confirmFrames(epoch: number, throughFrame: number): Promise<{ confirmedThrough: number }>;
  getTransportDiagnostics(): PeerSmokeTransportDiagnostics;
  suspend(source: OnlineSessionSuspendSource): Promise<void>;
  resume(source: 'visibility_visible'): Promise<void>;
  getLifecycleDiagnostics(): PeerSmokeLifecycleDiagnostics;
  close(): void;
}

declare global {
  interface Window {
    gravityWellPeerSmoke?: PeerSmokeRuntime;
  }
}

const status = document.querySelector<HTMLOutputElement>('#peer-status');
let peer: ConnectedWebRtcSession | null = null;
let frameTransport: WebRtcFrameTransport | null = null;
let identity: PeerSmokeIdentity | null = null;
let transportDiagnostics = createTransportDiagnostics();
let lifecycleController: OnlineSessionLifecycleController | null = null;
let disposeLifecycleListeners: (() => void) | null = null;
let lifecycleDiagnostics = createLifecycleDiagnostics();

class PeerSmokeRequestError extends Error {
  public readonly status: number;

  public readonly code: string | null;

  public constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'PeerSmokeRequestError';
    this.status = status;
    this.code = code;
  }
}

function createTransportDiagnostics(): Omit<PeerSmokeTransportDiagnostics, 'channelState'> {
  return {
    submitAttempts: 0,
    submittedFrames: 0,
    acceptedFrames: 0,
    submitFailures: 0,
    pollAttempts: 0,
    polledFrames: 0,
    pollFailures: 0,
    confirmationAttempts: 0,
    confirmationFailures: 0,
    protocolErrors: [],
    recoverableDisconnects: [],
  };
}

function createLifecycleDiagnostics(): Omit<
  PeerSmokeLifecycleDiagnostics,
  'phase' | 'heartbeatRunning'
> {
  return {
    heartbeatRequests: 0,
    disconnectRequests: 0,
    reconnectRequests: 0,
    events: [],
    errors: [],
  };
}

function recordBoundedError(target: string[], error: Error): void {
  target.push(error.message);
  if (target.length > 10) {
    target.splice(0, target.length - 10);
  }
}

function setStatus(value: string): void {
  if (status) {
    status.textContent = value;
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  accessToken: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve text errors in the thrown diagnostic.
  }
  if (!response.ok) {
    const code = body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : null;
    throw new PeerSmokeRequestError(
      `${init.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
      response.status,
      code,
    );
  }
  return body as T;
}

function closePeer(): void {
  disposeLifecycleListeners?.();
  disposeLifecycleListeners = null;
  lifecycleController?.clear();
  lifecycleController = null;
  frameTransport?.close();
  frameTransport = null;
  peer?.close();
  peer = null;
  identity = null;
  setStatus('Peer runtime ready.');
}

function createReconnectAttemptId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return `peer-smoke-${crypto.randomUUID()}`;
  }
  return `peer-smoke-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xFFFFFF).toString(36)}`;
}

function startLifecycle(options: PeerSmokeConnectOptions): void {
  lifecycleDiagnostics = createLifecycleDiagnostics();
  const apiBaseUrl = options.apiBaseUrl.trim().replace(/\/+$/, '');
  lifecycleController = new OnlineSessionLifecycleController({
    heartbeat: async (target, signal) => {
      lifecycleDiagnostics.heartbeatRequests += 1;
      await requestJson(
        apiBaseUrl,
        '/matchmaking/sessions/heartbeat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: target.sessionId,
            sessionToken: target.sessionToken,
          }),
          signal,
        },
        options.account.accessToken,
      );
    },
    disconnect: async (target) => {
      lifecycleDiagnostics.disconnectRequests += 1;
      await requestJson(
        apiBaseUrl,
        '/matchmaking/sessions/disconnect',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: target.sessionId }),
          keepalive: true,
        },
        options.account.accessToken,
      );
    },
    reconnect: async (target) => {
      lifecycleDiagnostics.reconnectRequests += 1;
      await requestJson(
        apiBaseUrl,
        '/matchmaking/sessions/reconnect',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: target.sessionId,
            sessionToken: target.sessionToken,
            reconnectAttemptId: createReconnectAttemptId(),
          }),
        },
        options.account.accessToken,
      );
    },
    isDisconnectedError: (error) => (
      error instanceof PeerSmokeRequestError
      && error.code === 'participant_disconnected'
    ),
    onEvent: (event) => {
      lifecycleDiagnostics.events.push(`${event.type}:${event.source}`);
    },
    onError: (failure) => {
      const detail = failure.error instanceof Error ? failure.error.message : String(failure.error);
      lifecycleDiagnostics.errors.push(`${failure.phase}:${failure.source ?? 'none'}:${detail}`);
    },
  });
  lifecycleController.start({
    sessionId: options.match.sessionId,
    sessionToken: options.match.sessionToken,
    localAccountId: options.account.id,
    intervalMs: Math.max(1_000, Math.floor((options.match.heartbeatIntervalSeconds ?? 5) * 1_000)),
  });
  disposeLifecycleListeners = installOnlineSessionLifecycleListeners({
    controller: lifecycleController,
    canManage: () => identity?.sessionId === options.match.sessionId,
  });
}

async function submitFrames(
  frames: OnlineFrameSubmission[],
): Promise<{ acceptedFrames: number }> {
  if (!frameTransport) {
    throw new Error('Peer smoke is not connected.');
  }
  transportDiagnostics.submitAttempts += 1;
  transportDiagnostics.submittedFrames += frames.length;
  try {
    const response = await frameTransport.submitFrames(frames);
    transportDiagnostics.acceptedFrames += response.acceptedFrames;
    return response;
  } catch (error) {
    transportDiagnostics.submitFailures += 1;
    throw error;
  }
}

async function pollFrames(epoch: number, afterFrame: number): Promise<{
  frames: OnlineFrameEnvelope[];
  peerConfirmedThrough: number;
}> {
  if (!frameTransport) {
    throw new Error('Peer smoke is not connected.');
  }
  transportDiagnostics.pollAttempts += 1;
  try {
    const response = await frameTransport.pollFrames(epoch, afterFrame);
    transportDiagnostics.polledFrames += response.frames.length;
    return {
      frames: response.frames,
      peerConfirmedThrough: response.peerConfirmedThrough ?? -1,
    };
  } catch (error) {
    transportDiagnostics.pollFailures += 1;
    throw error;
  }
}

async function confirmFrames(
  epoch: number,
  throughFrame: number,
): Promise<{ confirmedThrough: number }> {
  if (!frameTransport) {
    throw new Error('Peer smoke is not connected.');
  }
  transportDiagnostics.confirmationAttempts += 1;
  try {
    return await frameTransport.confirmFrames(epoch, throughFrame);
  } catch (error) {
    transportDiagnostics.confirmationFailures += 1;
    throw error;
  }
}

const runtime: PeerSmokeRuntime = {
  connect: async (options) => {
    closePeer();
    transportDiagnostics = createTransportDiagnostics();
    const apiBaseUrl = options.apiBaseUrl.trim().replace(/\/+$/, '');
    if (!apiBaseUrl || options.account.id !== options.match.localPlayer.accountId) {
      throw new Error('Peer smoke received an invalid local account/session binding.');
    }
    const signalTransport = {
      publish: async (signal: {
        clientMessageId: string;
        signalType: WebRtcSignalType;
        payload: unknown;
      }): Promise<{ signalId: string }> => await requestJson(
        apiBaseUrl,
        `/matchmaking/sessions/${options.match.sessionId}/signals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionToken: options.match.sessionToken,
            transportAttemptId: options.match.transportAttempt.attemptId,
            ...signal,
          }),
        },
        options.account.accessToken,
      ),
      poll: async (afterSignalId: string): Promise<PeerSmokeSignalResponse> => {
        const query = new URLSearchParams({
          transportAttemptId: options.match.transportAttempt.attemptId,
          afterSignalId,
          limit: '100',
        });
        return await requestJson(
          apiBaseUrl,
          `/matchmaking/sessions/${options.match.sessionId}/signals?${query.toString()}`,
          { headers: { 'x-match-session-token': options.match.sessionToken } },
          options.account.accessToken,
        );
      },
    };

    setStatus(`Connecting ${options.match.localPlayer.side}...`);
    peer = await connectWebRtcSession({
      transportAttemptId: options.match.transportAttempt.attemptId,
      localAccountId: options.account.id,
      remoteAccountId: options.match.peer.accountId,
      initiator: options.match.localPlayer.side === 'P1',
      rtcConfiguration: {
        iceServers: options.iceConfig.iceServers,
        iceTransportPolicy: options.iceConfig.iceTransportPolicy,
      },
      signalTransport,
      connectTimeoutMs: 12_000,
    });
    frameTransport = new WebRtcFrameTransport({
      channel: peer.channel,
      localAccountId: options.account.id,
      remoteAccountId: options.match.peer.accountId,
      ackTimeoutMs: 2_000,
      maxFramesPerBatch: 30,
      recoverOnChannelFailure: true,
      onProtocolError: (error) => recordBoundedError(transportDiagnostics.protocolErrors, error),
      onRecoverableDisconnect: (error) => {
        recordBoundedError(transportDiagnostics.recoverableDisconnects, error);
      },
    });
    identity = {
      localAccountId: options.account.id,
      remoteAccountId: options.match.peer.accountId,
      side: options.match.localPlayer.side,
      sessionId: options.match.sessionId,
      connectionPath: peer.connectionPath,
    };
    startLifecycle(options);
    setStatus(`Connected ${identity.side} via ${identity.connectionPath}.`);
    return { ...identity };
  },
  getIdentity: () => identity ? { ...identity } : null,
  submitFrame: async (epoch, frame, input) => {
    const response = await submitFrames([{ epoch, frame, input }]);
    return response.acceptedFrames;
  },
  submitFrames,
  pollFrames,
  confirmFrames,
  getTransportDiagnostics: () => ({
    ...transportDiagnostics,
    channelState: peer?.channel.readyState ?? 'closed',
    protocolErrors: [...transportDiagnostics.protocolErrors],
    recoverableDisconnects: [...transportDiagnostics.recoverableDisconnects],
  }),
  suspend: async (source) => {
    if (!lifecycleController) {
      throw new Error('Peer smoke lifecycle is not connected.');
    }
    await lifecycleController.suspend(source);
  },
  resume: async (source) => {
    if (!lifecycleController) {
      throw new Error('Peer smoke lifecycle is not connected.');
    }
    await lifecycleController.resume(source);
  },
  getLifecycleDiagnostics: () => {
    const snapshot = lifecycleController?.getSnapshot();
    return {
      ...lifecycleDiagnostics,
      phase: snapshot?.phase ?? 'idle',
      heartbeatRunning: snapshot?.heartbeatRunning ?? false,
      events: [...lifecycleDiagnostics.events],
      errors: [...lifecycleDiagnostics.errors],
    };
  },
  close: closePeer,
};

window.gravityWellPeerSmoke = runtime;
window.addEventListener('beforeunload', closePeer);
setStatus('Peer runtime ready.');
