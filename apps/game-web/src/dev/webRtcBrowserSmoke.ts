import {
  installOnlineSessionLifecycleListeners,
  OnlineSessionLifecycleController,
  type OnlineSessionLifecycleError,
  type OnlineSessionLifecycleEvent,
} from '../net/onlineSessionLifecycle';
import { WebRtcFrameTransport } from '../net/webRtcFrameTransport';
import {
  exchangeWebRtcRecoveryCheckpoint,
  type WebRtcRecoveryCheckpoint,
} from '../net/webRtcRecoveryCheckpoint';
import {
  connectWebRtcSession,
  type ConnectedWebRtcSession,
  type WebRtcSignalType,
} from '../net/webRtcSession';
import type { PlayerFrameInput } from '../sim/types';
import { buildLocalSmokeRtcConfiguration } from './localSmokeIceConfig';
import { runWebRtcRollbackScenario } from './webRtcRollbackScenario';

interface SmokeAccount {
  id: string;
  accessToken: string;
}

interface SmokeMatchStart {
  sessionId: string;
  sessionToken: string;
  heartbeatIntervalSeconds: number;
  heartbeatTimeoutSeconds: number;
  reconnectGraceSeconds: number;
  queueType: 'ranked';
  region: 'eu-west';
  transportAttempt: {
    attemptId: string;
    generation: number;
    createdAt: string;
  };
  localPlayer: { accountId: string; side: 'P1' | 'P2' };
  peer: { accountId: string; side: 'P1' | 'P2' };
}

interface SmokeTicket {
  ticketId: string;
  status: 'queued' | 'matched' | 'closed';
  matchStart?: SmokeMatchStart;
}

interface SmokeIceConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  directConnectTimeoutMs: number;
  relayAvailable: boolean;
  turnCredentialMode: 'none' | 'static' | 'time_limited';
}

interface SmokeSignalResponse {
  signals: Array<{
    signalId: string;
    transportAttemptId: string;
    senderAccountId: string;
    signalType: WebRtcSignalType;
    payload: unknown;
    createdAt: string;
  }>;
}

interface SmokeSession {
  sessionId: string;
  status: 'active' | 'resolved';
  resolvedReason?: string;
  transportAttempt: SmokeMatchStart['transportAttempt'];
  participants: Array<{
    accountId: string;
    connectionStatus: 'connected' | 'disconnected';
    completionAttestedAt?: string;
    disconnectedAt?: string;
    reconnectDeadlineAt?: string;
  }>;
}

interface SmokeLifecycleReport {
  suspendedAccountId: string;
  disconnectObserved: boolean;
  duplicateSuspendDeduplicated: boolean;
  reconnectDeadlineStable: boolean;
  resumedConnected: boolean;
  disconnectRequests: number;
  reconnectRequests: number;
  lifecycleEvents: string[];
  lifecycleErrors: string[];
  postResumeAcknowledgedFrames: number[];
  postResumeReceivedFrameAccounts: Array<string | undefined>;
  postResumePeerConfirmations: number[];
}

interface SmokeTransportRecoveryReport {
  serverDisconnectObserved: boolean;
  serverReconnectObserved: boolean;
  staleAttemptRejected: boolean;
  previousAttemptGeneration: number;
  recoveredAttemptGeneration: number;
  recoveredAttemptId: string;
  connectionPaths: [string, string];
  checkpointChecksum: number;
  acknowledgedFrames: number[];
  receivedFrameAccounts: Array<string | undefined>;
  peerConfirmations: number[];
}

interface SmokeLifecycleTracker {
  disconnectRequests: number;
  reconnectRequests: number;
  events: string[];
  errors: string[];
}

const apiBaseInput = document.querySelector<HTMLInputElement>('#api-base');
const runButton = document.querySelector<HTMLButtonElement>('#run-smoke');
const result = document.querySelector<HTMLPreElement>('#result');

if (!apiBaseInput || !runButton || !result) {
  throw new Error('WebRTC smoke controls are missing.');
}

function writeResult(value: unknown, status: 'running' | 'pass' | 'fail'): void {
  result.className = status === 'running' ? '' : status;
  result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve text errors in the thrown diagnostic.
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function createAccount(baseUrl: string): Promise<SmokeAccount> {
  return await requestJson<SmokeAccount>(baseUrl, '/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

async function joinQueue(
  baseUrl: string,
  account: SmokeAccount,
  characterId: 'vanguard' | 'duelist',
): Promise<SmokeTicket> {
  return await requestJson<SmokeTicket>(baseUrl, '/matchmaking/queue/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      queueType: 'ranked',
      regionPreferences: ['eu-west'],
      buildVersion: 'webrtc-local-smoke-v1',
      rulesetVersion: 'prototype-2026.02',
      balanceProfileId: 'default',
      platform: 'web',
      characterId,
    }),
  }, account.accessToken);
}

async function readTicket(
  baseUrl: string,
  account: SmokeAccount,
  ticketId: string,
): Promise<SmokeTicket> {
  return await requestJson<SmokeTicket>(
    baseUrl,
    `/matchmaking/queue/tickets/${ticketId}`,
    {},
    account.accessToken,
  );
}

async function readSession(
  baseUrl: string,
  account: SmokeAccount,
  sessionId: string,
): Promise<SmokeSession> {
  return await requestJson<SmokeSession>(
    baseUrl,
    `/matchmaking/sessions/${sessionId}`,
    {},
    account.accessToken,
  );
}

async function resolveMatchedTicket(
  baseUrl: string,
  account: SmokeAccount,
  ticket: SmokeTicket,
): Promise<SmokeMatchStart> {
  const resolved = ticket.status === 'matched' ? ticket : await readTicket(baseUrl, account, ticket.ticketId);
  if (!resolved.matchStart) {
    throw new Error(`Ticket ${ticket.ticketId} did not resolve to a match.`);
  }
  return resolved.matchStart;
}

function createSignalTransport(baseUrl: string, account: SmokeAccount, match: SmokeMatchStart) {
  return {
    publish: async (signal: {
      clientMessageId: string;
      signalType: WebRtcSignalType;
      payload: unknown;
    }): Promise<{ signalId: string }> => await requestJson(
      baseUrl,
      `/matchmaking/sessions/${match.sessionId}/signals`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionToken: match.sessionToken,
          transportAttemptId: match.transportAttempt.attemptId,
          ...signal,
        }),
      },
      account.accessToken,
    ),
    poll: async (afterSignalId: string): Promise<SmokeSignalResponse> => {
      const query = new URLSearchParams({
        transportAttemptId: match.transportAttempt.attemptId,
        afterSignalId,
        limit: '100',
      });
      return await requestJson(
        baseUrl,
        `/matchmaking/sessions/${match.sessionId}/signals?${query.toString()}`,
        { headers: { 'x-match-session-token': match.sessionToken } },
        account.accessToken,
      );
    },
  };
}

async function runTransportRecoveryDrill(options: {
  baseUrl: string;
  account1: SmokeAccount;
  account2: SmokeAccount;
  match1: SmokeMatchStart;
  match2: SmokeMatchStart;
  iceConfig1: SmokeIceConfig;
  iceConfig2: SmokeIceConfig;
  forceRelay: boolean;
  peer1: ConnectedWebRtcSession;
  peer2: ConnectedWebRtcSession;
  frameTransport1: WebRtcFrameTransport;
  frameTransport2: WebRtcFrameTransport;
  checkpointChecksum: number;
}): Promise<{
  peer1: ConnectedWebRtcSession;
  peer2: ConnectedWebRtcSession;
  report: SmokeTransportRecoveryReport;
}> {
  options.peer1.close();
  options.peer2.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!options.frameTransport1.isRecovering() || !options.frameTransport2.isRecovering()) {
    throw new Error('Closed DataChannels did not enter recoverable transport state on both peers.');
  }
  await Promise.all([
    requestJson<SmokeSession>(options.baseUrl, '/matchmaking/sessions/disconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: options.match1.sessionId }),
    }, options.account1.accessToken),
    requestJson<SmokeSession>(options.baseUrl, '/matchmaking/sessions/disconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: options.match2.sessionId }),
    }, options.account2.accessToken),
  ]);
  const disconnectedSession = await readSession(
    options.baseUrl,
    options.account1,
    options.match1.sessionId,
  );
  const serverDisconnectObserved = disconnectedSession.participants.every(
    ({ connectionStatus }) => connectionStatus === 'disconnected',
  );
  if (!serverDisconnectObserved) {
    throw new Error('Server did not observe both peers entering recovery disconnect state.');
  }

  // Exercise the formerly asymmetric path: P2 is allowed to create the one
  // idempotent replacement generation without waiting for P1.
  const advancingAccount = options.match1.localPlayer.side === 'P2' ? options.account1 : options.account2;
  const advancingMatch = options.match1.localPlayer.side === 'P2' ? options.match1 : options.match2;
  const advancedSession = await requestJson<SmokeSession>(
    options.baseUrl,
    `/matchmaking/sessions/${advancingMatch.sessionId}/transport-attempts`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionToken: advancingMatch.sessionToken,
        expectedGeneration: advancingMatch.transportAttempt.generation,
      }),
    },
    advancingAccount.accessToken,
  );
  if (advancedSession.transportAttempt.generation !== advancingMatch.transportAttempt.generation + 1) {
    throw new Error('Server did not issue the next transport-attempt generation.');
  }
  let staleAttemptRejected = false;
  try {
    const staleQuery = new URLSearchParams({
      transportAttemptId: advancingMatch.transportAttempt.attemptId,
      afterSignalId: '0',
      limit: '1',
    });
    await requestJson(
      options.baseUrl,
      `/matchmaking/sessions/${advancingMatch.sessionId}/signals?${staleQuery.toString()}`,
      { headers: { 'x-match-session-token': advancingMatch.sessionToken } },
      advancingAccount.accessToken,
    );
  } catch (error) {
    staleAttemptRejected = error instanceof Error && error.message.includes('returned 409');
  }
  if (!staleAttemptRejected) {
    throw new Error('Server did not reject signaling from the superseded transport attempt.');
  }
  const match1 = { ...options.match1, transportAttempt: advancedSession.transportAttempt };
  const match2 = { ...options.match2, transportAttempt: advancedSession.transportAttempt };

  // Restore durable session presence before potentially slow ICE/TURN negotiation.
  const reconnectId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await Promise.all([
    requestJson<SmokeSession>(options.baseUrl, '/matchmaking/sessions/reconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: match1.sessionId,
        sessionToken: match1.sessionToken,
        reconnectAttemptId: `recovery-p1-${reconnectId}`,
      }),
    }, options.account1.accessToken),
    requestJson<SmokeSession>(options.baseUrl, '/matchmaking/sessions/reconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: match2.sessionId,
        sessionToken: match2.sessionToken,
        reconnectAttemptId: `recovery-p2-${reconnectId}`,
      }),
    }, options.account2.accessToken),
  ]);
  const reconnectedSession = await readSession(
    options.baseUrl,
    options.account1,
    options.match1.sessionId,
  );
  const serverReconnectObserved = reconnectedSession.participants.every(
    ({ connectionStatus }) => connectionStatus === 'connected',
  );
  if (!serverReconnectObserved) {
    throw new Error('Server did not observe both peers completing recovery reconnect.');
  }

  const [peer1, peer2] = await Promise.all([
    connectWebRtcSession({
      transportAttemptId: advancedSession.transportAttempt.attemptId,
      localAccountId: options.account1.id,
      remoteAccountId: options.account2.id,
      initiator: match1.localPlayer.side === 'P1',
      rtcConfiguration: buildLocalSmokeRtcConfiguration(options.iceConfig1, options.forceRelay),
      signalTransport: createSignalTransport(options.baseUrl, options.account1, match1),
      connectTimeoutMs: 12_000,
    }),
    connectWebRtcSession({
      transportAttemptId: advancedSession.transportAttempt.attemptId,
      localAccountId: options.account2.id,
      remoteAccountId: options.account1.id,
      initiator: match2.localPlayer.side === 'P1',
      rtcConfiguration: buildLocalSmokeRtcConfiguration(options.iceConfig2, options.forceRelay),
      signalTransport: createSignalTransport(options.baseUrl, options.account2, match2),
      connectTimeoutMs: 12_000,
    }),
  ]);

  try {
    const checkpoint: WebRtcRecoveryCheckpoint = {
      transportAttemptId: advancedSession.transportAttempt.attemptId,
      roundEpoch: 1,
      confirmedThrough: 119,
      p1Rounds: 0,
      p2Rounds: 0,
      stateChecksum: options.checkpointChecksum,
    };
    await Promise.all([
      exchangeWebRtcRecoveryCheckpoint(peer1.channel, checkpoint),
      exchangeWebRtcRecoveryCheckpoint(peer2.channel, checkpoint),
    ]);
    options.frameTransport1.replaceChannel(peer1.channel);
    options.frameTransport2.replaceChannel(peer2.channel);

    const acknowledgements = await Promise.all([
      options.frameTransport1.submitFrames([{
        epoch: 1,
        frame: 120,
        input: createFrameInput(0.25, false),
      }]),
      options.frameTransport2.submitFrames([{
        epoch: 1,
        frame: 120,
        input: createFrameInput(-0.25, false),
      }]),
    ]);
    const [receivedBy1, receivedBy2] = await Promise.all([
      options.frameTransport1.pollFrames(1, 119),
      options.frameTransport2.pollFrames(1, 119),
    ]);
    await Promise.all([
      options.frameTransport1.confirmFrames(1, 120),
      options.frameTransport2.confirmFrames(1, 120),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [confirmedBy1, confirmedBy2] = await Promise.all([
      options.frameTransport1.pollFrames(1, 120),
      options.frameTransport2.pollFrames(1, 120),
    ]);
    if (
      receivedBy1.frames[0]?.accountId !== options.account2.id
      || receivedBy2.frames[0]?.accountId !== options.account1.id
      || confirmedBy1.peerConfirmedThrough !== 120
      || confirmedBy2.peerConfirmedThrough !== 120
    ) {
      throw new Error('Recovered transport did not preserve routing and confirmation state.');
    }

    return {
      peer1,
      peer2,
      report: {
        serverDisconnectObserved,
        serverReconnectObserved,
        staleAttemptRejected,
        previousAttemptGeneration: options.match1.transportAttempt.generation,
        recoveredAttemptGeneration: advancedSession.transportAttempt.generation,
        recoveredAttemptId: advancedSession.transportAttempt.attemptId,
        connectionPaths: [peer1.connectionPath, peer2.connectionPath],
        checkpointChecksum: options.checkpointChecksum,
        acknowledgedFrames: acknowledgements.map((entry) => entry.acceptedFrames),
        receivedFrameAccounts: [
          receivedBy1.frames[0]?.accountId,
          receivedBy2.frames[0]?.accountId,
        ],
        peerConfirmations: [
          confirmedBy1.peerConfirmedThrough,
          confirmedBy2.peerConfirmedThrough,
        ],
      },
    };
  } catch (error) {
    peer1.close();
    peer2.close();
    throw error;
  }
}

function createFrameInput(moveX: number, launch: boolean): PlayerFrameInput {
  return {
    moveX,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

function formatLifecycleError(failure: OnlineSessionLifecycleError): string {
  const detail = failure.error instanceof Error ? failure.error.message : String(failure.error);
  return `${failure.phase}:${failure.source ?? 'heartbeat'}:${detail}`;
}

async function waitForSessionParticipant(
  baseUrl: string,
  account: SmokeAccount,
  sessionId: string,
  participantAccountId: string,
  connectionStatus: 'connected' | 'disconnected',
  timeoutMs = 5_000,
): Promise<{ session: SmokeSession; participant: SmokeSession['participants'][number] }> {
  const deadline = performance.now() + timeoutMs;
  let lastSession: SmokeSession | null = null;
  while (performance.now() < deadline) {
    lastSession = await readSession(baseUrl, account, sessionId);
    const participant = lastSession.participants.find((entry) => entry.accountId === participantAccountId);
    if (participant?.connectionStatus === connectionStatus) {
      return { session: lastSession, participant };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Participant ${participantAccountId} did not become ${connectionStatus}: ${JSON.stringify(lastSession)}`,
  );
}

function installSyntheticVisibilityState(): {
  set(value: DocumentVisibilityState): void;
  restore(): void;
} {
  const previousDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  let syntheticState = document.visibilityState;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => syntheticState,
  });
  return {
    set: (value) => { syntheticState = value; },
    restore: () => {
      if (previousDescriptor) {
        Object.defineProperty(document, 'visibilityState', previousDescriptor);
      } else {
        delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
      }
    },
  };
}

function createSmokeLifecycleTracker(): SmokeLifecycleTracker {
  return {
    disconnectRequests: 0,
    reconnectRequests: 0,
    events: [],
    errors: [],
  };
}

function createSmokeSessionLifecycle(
  baseUrl: string,
  account: SmokeAccount,
  match: SmokeMatchStart,
  tracker: SmokeLifecycleTracker,
): OnlineSessionLifecycleController {
  const controller = new OnlineSessionLifecycleController({
    heartbeat: async (target) => {
      await requestJson(baseUrl, '/matchmaking/sessions/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: target.sessionId,
          sessionToken: target.sessionToken,
        }),
      }, account.accessToken);
    },
    disconnect: async (target) => {
      tracker.disconnectRequests += 1;
      await requestJson(baseUrl, '/matchmaking/sessions/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: target.sessionId }),
        keepalive: true,
      }, account.accessToken);
    },
    reconnect: async (target) => {
      tracker.reconnectRequests += 1;
      await requestJson(baseUrl, '/matchmaking/sessions/reconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: target.sessionId,
          sessionToken: target.sessionToken,
          reconnectAttemptId: `browser-smoke-${crypto.randomUUID()}`,
        }),
      }, account.accessToken);
    },
    isDisconnectedError: (error) => (
      error instanceof Error
      && error.message.includes('participant_disconnected')
    ),
    onEvent: (event: OnlineSessionLifecycleEvent) => {
      tracker.events.push(`${event.type}:${event.source}`);
    },
    onError: (failure) => {
      tracker.errors.push(formatLifecycleError(failure));
    },
  });
  controller.start({
    sessionId: match.sessionId,
    sessionToken: match.sessionToken,
    localAccountId: account.id,
    intervalMs: match.heartbeatIntervalSeconds * 1_000,
  });
  return controller;
}

async function runSuspendReconnectDrill(options: {
  baseUrl: string;
  account1: SmokeAccount;
  account2: SmokeAccount;
  match: SmokeMatchStart;
  lifecycle: OnlineSessionLifecycleController;
  tracker: SmokeLifecycleTracker;
  frameTransport1: WebRtcFrameTransport;
  frameTransport2: WebRtcFrameTransport;
}): Promise<SmokeLifecycleReport> {
  const syntheticVisibility = installSyntheticVisibilityState();
  const disposeListeners = installOnlineSessionLifecycleListeners({
    controller: options.lifecycle,
    canManage: () => true,
  });
  try {
    syntheticVisibility.set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));

    const disconnected = await waitForSessionParticipant(
      options.baseUrl,
      options.account1,
      options.match.sessionId,
      options.account1.id,
      'disconnected',
    );
    const reconnectDeadline = disconnected.participant.reconnectDeadlineAt;
    if (!reconnectDeadline || !disconnected.participant.disconnectedAt) {
      throw new Error('Suspended participant did not receive reconnect timing metadata.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const duplicateCheck = await readSession(
      options.baseUrl,
      options.account1,
      options.match.sessionId,
    );
    const duplicateParticipant = duplicateCheck.participants.find(
      (entry) => entry.accountId === options.account1.id,
    );
    const reconnectDeadlineStable = duplicateParticipant?.reconnectDeadlineAt === reconnectDeadline;
    const duplicateSuspendDeduplicated = options.tracker.disconnectRequests === 1;
    if (!reconnectDeadlineStable || !duplicateSuspendDeduplicated) {
      throw new Error('Duplicate visibility/pagehide suspension extended or repeated the disconnect.');
    }

    syntheticVisibility.set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitForSessionParticipant(
      options.baseUrl,
      options.account1,
      options.match.sessionId,
      options.account1.id,
      'connected',
    );
    await Promise.resolve();
    const lifecycleSnapshot = options.lifecycle.getSnapshot();
    if (
      options.tracker.reconnectRequests !== 1
      || lifecycleSnapshot.phase !== 'active'
      || !lifecycleSnapshot.heartbeatRunning
      || options.tracker.errors.length > 0
    ) {
      throw new Error(`Lifecycle did not resume cleanly: ${JSON.stringify({
        tracker: options.tracker,
        lifecycleSnapshot,
      })}`);
    }

    const acknowledgements = await Promise.all([
      options.frameTransport1.submitFrames([{ epoch: 2, frame: 0, input: createFrameInput(0.5, false) }]),
      options.frameTransport2.submitFrames([{ epoch: 2, frame: 0, input: createFrameInput(-0.5, true) }]),
    ]);
    const [receivedBy1, receivedBy2] = await Promise.all([
      options.frameTransport1.pollFrames(2, -1),
      options.frameTransport2.pollFrames(2, -1),
    ]);
    if (
      receivedBy1.frames[0]?.accountId !== options.account2.id
      || receivedBy2.frames[0]?.accountId !== options.account1.id
    ) {
      throw new Error('Post-resume DataChannel exchange did not preserve peer identity.');
    }
    await Promise.all([
      options.frameTransport1.confirmFrames(2, 0),
      options.frameTransport2.confirmFrames(2, 0),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [confirmedBy1, confirmedBy2] = await Promise.all([
      options.frameTransport1.pollFrames(2, 0),
      options.frameTransport2.pollFrames(2, 0),
    ]);
    if (confirmedBy1.peerConfirmedThrough !== 0 || confirmedBy2.peerConfirmedThrough !== 0) {
      throw new Error('Post-resume DataChannel confirmation handshake did not converge.');
    }

    return {
      suspendedAccountId: options.account1.id,
      disconnectObserved: true,
      duplicateSuspendDeduplicated,
      reconnectDeadlineStable,
      resumedConnected: true,
      disconnectRequests: options.tracker.disconnectRequests,
      reconnectRequests: options.tracker.reconnectRequests,
      lifecycleEvents: [...options.tracker.events],
      lifecycleErrors: [...options.tracker.errors],
      postResumeAcknowledgedFrames: acknowledgements.map((entry) => entry.acceptedFrames),
      postResumeReceivedFrameAccounts: [
        receivedBy1.frames[0]?.accountId,
        receivedBy2.frames[0]?.accountId,
      ],
      postResumePeerConfirmations: [
        confirmedBy1.peerConfirmedThrough,
        confirmedBy2.peerConfirmedThrough,
      ],
    };
  } finally {
    disposeListeners();
    syntheticVisibility.restore();
  }
}

async function runSmoke(baseUrl: string, forceRelay: boolean): Promise<Record<string, unknown>> {
  const [account1, account2] = await Promise.all([createAccount(baseUrl), createAccount(baseUrl)]);
  const ticket1 = await joinQueue(baseUrl, account1, 'vanguard');
  const ticket2 = await joinQueue(baseUrl, account2, 'duelist');
  const [match1, match2] = await Promise.all([
    resolveMatchedTicket(baseUrl, account1, ticket1),
    resolveMatchedTicket(baseUrl, account2, ticket2),
  ]);
  if (match1.sessionId !== match2.sessionId) {
    throw new Error('Matched peers disagree on the session id.');
  }

  const [iceConfig1, iceConfig2] = await Promise.all([
    requestJson<SmokeIceConfig>(baseUrl, '/matchmaking/network/ice-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: match1.sessionId,
        sessionToken: match1.sessionToken,
        forceRelay,
      }),
    }, account1.accessToken),
    requestJson<SmokeIceConfig>(baseUrl, '/matchmaking/network/ice-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: match2.sessionId,
        sessionToken: match2.sessionToken,
        forceRelay,
      }),
    }, account2.accessToken),
  ]);
  const [peer1, peer2] = await Promise.all([
    connectWebRtcSession({
      transportAttemptId: match1.transportAttempt.attemptId,
      localAccountId: account1.id,
      remoteAccountId: account2.id,
      initiator: match1.localPlayer.side === 'P1',
      rtcConfiguration: buildLocalSmokeRtcConfiguration(iceConfig1, forceRelay),
      signalTransport: createSignalTransport(baseUrl, account1, match1),
      connectTimeoutMs: 12_000,
    }),
    connectWebRtcSession({
      transportAttemptId: match2.transportAttempt.attemptId,
      localAccountId: account2.id,
      remoteAccountId: account1.id,
      initiator: match2.localPlayer.side === 'P1',
      rtcConfiguration: buildLocalSmokeRtcConfiguration(iceConfig2, forceRelay),
      signalTransport: createSignalTransport(baseUrl, account2, match2),
      connectTimeoutMs: 12_000,
    }),
  ]);
  let activePeer1 = peer1;
  let activePeer2 = peer2;

  const frameTransport1 = new WebRtcFrameTransport({
    channel: peer1.channel,
    localAccountId: account1.id,
    remoteAccountId: account2.id,
    ackTimeoutMs: 2_000,
    maxFramesPerBatch: 30,
    recoverOnChannelFailure: true,
  });
  const frameTransport2 = new WebRtcFrameTransport({
    channel: peer2.channel,
    localAccountId: account2.id,
    remoteAccountId: account1.id,
    ackTimeoutMs: 2_000,
    maxFramesPerBatch: 30,
    recoverOnChannelFailure: true,
  });
  const lifecycleTracker1 = createSmokeLifecycleTracker();
  const lifecycleTracker2 = createSmokeLifecycleTracker();
  const lifecycle1 = createSmokeSessionLifecycle(baseUrl, account1, match1, lifecycleTracker1);
  const lifecycle2 = createSmokeSessionLifecycle(baseUrl, account2, match2, lifecycleTracker2);

  try {
    const acknowledgements = await Promise.all([
      frameTransport1.submitFrames([{ epoch: 0, frame: 0, input: createFrameInput(1, true) }]),
      frameTransport2.submitFrames([{ epoch: 0, frame: 0, input: createFrameInput(-1, false) }]),
    ]);
    const [receivedBy1, receivedBy2] = await Promise.all([
      frameTransport1.pollFrames(0, -1),
      frameTransport2.pollFrames(0, -1),
    ]);
    if (receivedBy1.frames[0]?.accountId !== account2.id || receivedBy2.frames[0]?.accountId !== account1.id) {
      throw new Error('DataChannel frame routing did not preserve peer account identity.');
    }

    await Promise.all([
      frameTransport1.confirmFrames(0, 0),
      frameTransport2.confirmFrames(0, 0),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [confirmedBy1, confirmedBy2] = await Promise.all([
      frameTransport1.pollFrames(0, 0),
      frameTransport2.pollFrames(0, 0),
    ]);
    if (confirmedBy1.peerConfirmedThrough !== 0 || confirmedBy2.peerConfirmedThrough !== 0) {
      throw new Error('DataChannel confirmation handshake did not converge.');
    }

    const accountIdsBySide = match1.localPlayer.side === 'P1'
      ? { P1: account1.id, P2: account2.id }
      : { P1: account2.id, P2: account1.id };
    const transportsBySide = match1.localPlayer.side === 'P1'
      ? { P1: frameTransport1, P2: frameTransport2 }
      : { P1: frameTransport2, P2: frameTransport1 };
    const loadoutBySide = match1.localPlayer.side === 'P1'
      ? { P1: 'vanguard' as const, P2: 'duelist' as const }
      : { P1: 'duelist' as const, P2: 'vanguard' as const };
    const rollback = await runWebRtcRollbackScenario({
      transports: transportsBySide,
      accountIds: accountIdsBySide,
      loadout: loadoutBySide,
      settleTransport: () => new Promise((resolve) => setTimeout(resolve, 10)),
    });
    const recovery = await runTransportRecoveryDrill({
      baseUrl,
      account1,
      account2,
      match1,
      match2,
      iceConfig1,
      iceConfig2,
      forceRelay,
      peer1,
      peer2,
      frameTransport1,
      frameTransport2,
      checkpointChecksum: rollback.canonicalChecksum,
    });
    activePeer1 = recovery.peer1;
    activePeer2 = recovery.peer2;
    const lifecycle = await runSuspendReconnectDrill({
      baseUrl,
      account1,
      account2,
      match: match1,
      lifecycle: lifecycle1,
      tracker: lifecycleTracker1,
      frameTransport1,
      frameTransport2,
    });
    if (lifecycleTracker2.errors.length > 0) {
      throw new Error(`Peer heartbeat failed during lifecycle drill: ${lifecycleTracker2.errors.join('; ')}`);
    }

    lifecycle1.clear();
    lifecycle2.clear();

    const firstCompletion = await requestJson<SmokeSession>(
      baseUrl,
      '/matchmaking/sessions/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: match1.sessionId, sessionToken: match1.sessionToken }),
      },
      account1.accessToken,
    );
    if (
      firstCompletion.status !== 'active'
      || !firstCompletion.participants.find(({ accountId }) => accountId === account1.id)?.completionAttestedAt
    ) {
      throw new Error('First completion attestation did not leave an active session awaiting its peer.');
    }
    const completion = await requestJson<SmokeSession>(
      baseUrl,
      '/matchmaking/sessions/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: match2.sessionId, sessionToken: match2.sessionToken }),
      },
      account2.accessToken,
    );
    if (completion.status !== 'resolved' || completion.resolvedReason !== 'completed') {
      throw new Error('Both completion attestations did not resolve the browser smoke session.');
    }

    return {
      schemaVersion: 'gw.webrtc-browser-core-smoke.v2',
      ok: true,
      forceRelayRequested: forceRelay,
      sessionId: match1.sessionId,
      accounts: [account1.id, account2.id],
      connectionPaths: [peer1.connectionPath, peer2.connectionPath],
      relayAvailable: iceConfig1.relayAvailable && iceConfig2.relayAvailable,
      iceTransportPolicies: [iceConfig1.iceTransportPolicy, iceConfig2.iceTransportPolicy],
      turnCredentialModes: [iceConfig1.turnCredentialMode, iceConfig2.turnCredentialMode],
      acknowledgedFrames: acknowledgements.map((entry) => entry.acceptedFrames),
      receivedFrameAccounts: [receivedBy1.frames[0]?.accountId, receivedBy2.frames[0]?.accountId],
      peerConfirmations: [confirmedBy1.peerConfirmedThrough, confirmedBy2.peerConfirmedThrough],
      rollback,
      recovery: recovery.report,
      lifecycle,
    };
  } finally {
    lifecycle1.clear();
    lifecycle2.clear();
    frameTransport1.close();
    frameTransport2.close();
    activePeer1.close();
    activePeer2.close();
    peer1.close();
    peer2.close();
  }
}

runButton.addEventListener('click', () => {
  const baseUrl = apiBaseInput.value.trim().replace(/\/+$/, '');
  const forceRelay = new URL(window.location.href).searchParams.get('forceRelay') === '1';
  if (!baseUrl) {
    writeResult('API base URL is required.', 'fail');
    return;
  }
  runButton.disabled = true;
  writeResult('Running authenticated signaling and real DataChannel exchange...', 'running');
  void runSmoke(baseUrl, forceRelay)
    .then((report) => writeResult(report, 'pass'))
    .catch((error) => writeResult(error instanceof Error ? error.stack ?? error.message : String(error), 'fail'))
    .finally(() => {
      runButton.disabled = false;
    });
});
