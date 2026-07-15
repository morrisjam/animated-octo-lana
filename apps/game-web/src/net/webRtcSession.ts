import type { ConnectionPath } from './transport';

export type WebRtcSignalType = 'offer' | 'answer' | 'ice_candidate' | 'end_of_candidates';

export interface WebRtcSignalEnvelope {
  signalId: string;
  transportAttemptId: string;
  senderAccountId: string;
  signalType: WebRtcSignalType;
  payload: unknown;
  createdAt: string;
}

export interface WebRtcSignalTransport {
  publish(signal: {
    clientMessageId: string;
    signalType: WebRtcSignalType;
    payload: unknown;
  }): Promise<{ signalId: string }>;
  poll(sinceSignalId: string): Promise<{ signals: WebRtcSignalEnvelope[] }>;
}

export interface WebRtcSessionOptions {
  transportAttemptId: string;
  localAccountId: string;
  remoteAccountId: string;
  initiator: boolean;
  rtcConfiguration: RTCConfiguration;
  signalTransport: WebRtcSignalTransport;
  connectTimeoutMs: number;
  pollIntervalMs?: number;
  peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
  createMessageId?: () => string;
}

export interface ConnectedWebRtcSession {
  channel: RTCDataChannel;
  connectionPath: ConnectionPath;
  close(): void;
}

interface DescriptionSignalPayload {
  connectionId: string;
  description: RTCSessionDescriptionInit;
}

interface CandidateSignalPayload {
  connectionId: string;
  candidate: RTCIceCandidateInit;
}

interface EndOfCandidatesSignalPayload {
  connectionId: string;
}

const DATA_CHANNEL_LABEL = 'gravity-well-input-v1';
const DEFAULT_POLL_INTERVAL_MS = 100;
const MINIMUM_CONNECT_TIMEOUT_MS = 5_000;
const SIGNAL_PUBLISH_ATTEMPTS = 3;
const INITIAL_OFFER_SETTLE_MS = 400;

function createDefaultMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDescriptionPayload(
  value: unknown,
  expectedType: 'offer' | 'answer',
): DescriptionSignalPayload | null {
  if (!isObject(value) || typeof value.connectionId !== 'string' || !isObject(value.description)) {
    return null;
  }
  const descriptionType = value.description.type;
  const sdp = value.description.sdp;
  if (descriptionType !== expectedType || typeof sdp !== 'string' || sdp.length === 0) {
    return null;
  }
  return {
    connectionId: value.connectionId,
    description: { type: expectedType, sdp },
  };
}

function parseCandidatePayload(value: unknown): CandidateSignalPayload | null {
  if (!isObject(value) || typeof value.connectionId !== 'string' || !isObject(value.candidate)) {
    return null;
  }
  if (typeof value.candidate.candidate !== 'string') {
    return null;
  }
  const candidate: RTCIceCandidateInit = {
    candidate: value.candidate.candidate,
  };
  const sdpMid = value.candidate.sdpMid;
  if (typeof sdpMid === 'string' || sdpMid === null) {
    candidate.sdpMid = sdpMid as string | null;
  }
  const sdpMLineIndex = value.candidate.sdpMLineIndex;
  if (typeof sdpMLineIndex === 'number' || sdpMLineIndex === null) {
    candidate.sdpMLineIndex = sdpMLineIndex as number | null;
  }
  if (typeof value.candidate.usernameFragment === 'string') {
    candidate.usernameFragment = value.candidate.usernameFragment;
  }
  return { connectionId: value.connectionId, candidate };
}

function parseEndOfCandidatesPayload(value: unknown): EndOfCandidatesSignalPayload | null {
  if (!isObject(value) || typeof value.connectionId !== 'string') {
    return null;
  }
  return { connectionId: value.connectionId };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function compareSignalIds(first: string, second: string): number {
  const firstId = BigInt(first);
  const secondId = BigInt(second);
  return firstId < secondId ? -1 : firstId > secondId ? 1 : 0;
}

async function inferConnectionPath(peerConnection: RTCPeerConnection): Promise<ConnectionPath> {
  try {
    const report = await peerConnection.getStats();
    const statsById = new Map<string, Record<string, unknown>>();
    report.forEach((entry) => {
      statsById.set(entry.id, entry as unknown as Record<string, unknown>);
    });
    let selectedPair: Record<string, unknown> | undefined;
    for (const entry of statsById.values()) {
      if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
        selectedPair = statsById.get(entry.selectedCandidatePairId);
        break;
      }
      if (
        entry.type === 'candidate-pair'
        && entry.state === 'succeeded'
        && (entry.nominated === true || entry.selected === true)
      ) {
        selectedPair = entry;
      }
    }
    if (!selectedPair) {
      return 'direct';
    }
    const localCandidate = typeof selectedPair.localCandidateId === 'string'
      ? statsById.get(selectedPair.localCandidateId)
      : undefined;
    const remoteCandidate = typeof selectedPair.remoteCandidateId === 'string'
      ? statsById.get(selectedPair.remoteCandidateId)
      : undefined;
    return localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay'
      ? 'relay'
      : 'direct';
  } catch {
    return 'direct';
  }
}

export async function connectWebRtcSession(
  options: WebRtcSessionOptions,
): Promise<ConnectedWebRtcSession> {
  const createPeerConnection = options.peerConnectionFactory
    ?? ((configuration: RTCConfiguration) => new RTCPeerConnection(configuration));
  const createMessageId = options.createMessageId ?? createDefaultMessageId;
  const pollIntervalMs = Math.max(25, Math.floor(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
  const connectTimeoutMs = Math.max(
    MINIMUM_CONNECT_TIMEOUT_MS,
    Math.floor(options.connectTimeoutMs),
  );
  const peerConnection = createPeerConnection(options.rtcConfiguration);
  const localConnectionId = options.initiator ? createMessageId() : null;
  let connectionId = localConnectionId;
  let dataChannel: RTCDataChannel | null = null;
  let remoteDescriptionSet = false;
  let stopped = false;
  let settled = false;
  let signalCursor = '0';
  let publishChain = Promise.resolve();
  let publishingCandidates = false;
  const pendingLocalCandidates: Array<{
    signalType: 'ice_candidate' | 'end_of_candidates';
    payload: CandidateSignalPayload | EndOfCandidatesSignalPayload;
  }> = [];
  const pendingRemoteCandidates: Array<RTCIceCandidateInit | null> = [];
  const pendingInitialSignals: WebRtcSignalEnvelope[] = [];
  let initialOfferReadyAtMs: number | null = null;

  let resolveChannelOpen: (channel: RTCDataChannel) => void = () => undefined;
  let rejectChannelOpen: (error: Error) => void = () => undefined;
  const channelOpen = new Promise<RTCDataChannel>((resolve, reject) => {
    resolveChannelOpen = resolve;
    rejectChannelOpen = reject;
  });

  const fail = (error: unknown): void => {
    if (settled) {
      return;
    }
    settled = true;
    rejectChannelOpen(error instanceof Error ? error : new Error(String(error)));
  };

  const installDataChannel = (channel: RTCDataChannel): void => {
    if (dataChannel && dataChannel !== channel) {
      fail(new Error('Peer opened more than one gameplay data channel.'));
      channel.close();
      return;
    }
    if (channel.label !== DATA_CHANNEL_LABEL) {
      fail(new Error(`Unexpected gameplay data channel label: ${channel.label}`));
      channel.close();
      return;
    }
    dataChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (!settled) {
        settled = true;
        resolveChannelOpen(channel);
      }
    };
    channel.onerror = () => fail(new Error('WebRTC gameplay data channel failed.'));
    if (channel.readyState === 'open' && !settled) {
      settled = true;
      resolveChannelOpen(channel);
    }
  };

  const publishWithRetry = async (
    signalType: WebRtcSignalType,
    payload: unknown,
  ): Promise<void> => {
    const clientMessageId = createMessageId();
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= SIGNAL_PUBLISH_ATTEMPTS; attempt += 1) {
      try {
        await options.signalTransport.publish({
          clientMessageId,
          signalType,
          payload,
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < SIGNAL_PUBLISH_ATTEMPTS) {
          await delay(attempt * 100);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('WebRTC signaling publish failed.');
  };

  const queueSignal = (signalType: WebRtcSignalType, payload: unknown): Promise<void> => {
    publishChain = publishChain.then(() => publishWithRetry(signalType, payload));
    publishChain.catch(fail);
    return publishChain;
  };

  const flushLocalCandidates = async (): Promise<void> => {
    publishingCandidates = true;
    while (pendingLocalCandidates.length > 0) {
      const pending = pendingLocalCandidates.shift();
      if (pending) {
        await queueSignal(pending.signalType, pending.payload);
      }
    }
  };

  const flushRemoteCandidates = async (): Promise<void> => {
    while (pendingRemoteCandidates.length > 0) {
      const candidate = pendingRemoteCandidates.shift();
      await peerConnection.addIceCandidate(candidate ?? null);
    }
  };

  const handleOffer = async (signal: WebRtcSignalEnvelope): Promise<void> => {
    const payload = parseDescriptionPayload(signal.payload, 'offer');
    if (!payload || options.initiator) {
      throw new Error('Received an invalid or unexpected WebRTC offer.');
    }
    if (connectionId && connectionId !== payload.connectionId) {
      throw new Error('Received an offer for a conflicting WebRTC connection.');
    }
    connectionId = payload.connectionId;
    await peerConnection.setRemoteDescription(payload.description);
    remoteDescriptionSet = true;
    await flushRemoteCandidates();
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    const localDescription = peerConnection.localDescription;
    if (!localDescription?.sdp) {
      throw new Error('WebRTC answer did not produce a local description.');
    }
    await queueSignal('answer', {
      connectionId,
      description: { type: 'answer', sdp: localDescription.sdp },
    } satisfies DescriptionSignalPayload);
    await flushLocalCandidates();
  };

  const handleAnswer = async (signal: WebRtcSignalEnvelope): Promise<void> => {
    const payload = parseDescriptionPayload(signal.payload, 'answer');
    if (!payload || !options.initiator) {
      throw new Error('Received an invalid or unexpected WebRTC answer.');
    }
    if (payload.connectionId !== connectionId) {
      return;
    }
    if (remoteDescriptionSet) {
      return;
    }
    await peerConnection.setRemoteDescription(payload.description);
    remoteDescriptionSet = true;
    await flushRemoteCandidates();
  };

  const handleCandidate = async (signal: WebRtcSignalEnvelope): Promise<void> => {
    const payload = signal.signalType === 'ice_candidate'
      ? parseCandidatePayload(signal.payload)
      : parseEndOfCandidatesPayload(signal.payload);
    if (!payload) {
      throw new Error('Received an invalid WebRTC candidate signal.');
    }
    if (connectionId && payload.connectionId !== connectionId) {
      return;
    }
    if (!connectionId) {
      connectionId = payload.connectionId;
    }
    const candidate = signal.signalType === 'ice_candidate'
      ? (payload as CandidateSignalPayload).candidate
      : null;
    if (!remoteDescriptionSet) {
      pendingRemoteCandidates.push(candidate);
      return;
    }
    await peerConnection.addIceCandidate(candidate);
  };

  const pollSignals = async (): Promise<void> => {
    let consecutiveFailures = 0;
    while (!stopped && !settled) {
      let response: { signals: WebRtcSignalEnvelope[] };
      try {
        response = await options.signalTransport.poll(signalCursor);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          fail(error);
          return;
        }
        if (!stopped && !settled) {
          await delay(pollIntervalMs);
        }
        continue;
      }

      try {
        const orderedSignals = [...response.signals].sort((first, second) => (
          compareSignalIds(first.signalId, second.signalId)
        ));
        let signalsToProcess = orderedSignals;
        if (!options.initiator && !connectionId) {
          pendingInitialSignals.push(...orderedSignals);
          for (const signal of orderedSignals) {
            if (compareSignalIds(signal.signalId, signalCursor) > 0) {
              signalCursor = signal.signalId;
            }
          }
          const initialOffers = pendingInitialSignals.filter((signal) => signal.signalType === 'offer');
          if (initialOffers.length > 0 && initialOfferReadyAtMs === null) {
            initialOfferReadyAtMs = Date.now() + INITIAL_OFFER_SETTLE_MS;
          }
          if (initialOfferReadyAtMs === null || Date.now() < initialOfferReadyAtMs) {
            if (!stopped && !settled) {
              await delay(pollIntervalMs);
            }
            continue;
          }
          const latestInitialOffer = initialOffers.at(-1);
          signalsToProcess = latestInitialOffer
            ? pendingInitialSignals.filter((signal) => (
              compareSignalIds(signal.signalId, latestInitialOffer.signalId) >= 0
            ))
            : [];
          pendingInitialSignals.length = 0;
        }
        for (const signal of signalsToProcess) {
          if (compareSignalIds(signal.signalId, signalCursor) > 0) {
            signalCursor = signal.signalId;
          }
          if (signal.senderAccountId !== options.remoteAccountId) {
            throw new Error(`WebRTC signal came from unexpected account ${signal.senderAccountId}.`);
          }
          if (signal.transportAttemptId !== options.transportAttemptId) {
            throw new Error(`WebRTC signal came from stale transport attempt ${signal.transportAttemptId}.`);
          }
          if (signal.signalType === 'offer') {
            await handleOffer(signal);
          } else if (signal.signalType === 'answer') {
            await handleAnswer(signal);
          } else {
            await handleCandidate(signal);
          }
        }
      } catch (error) {
        fail(error);
        return;
      }
      if (!stopped && !settled) {
        await delay(pollIntervalMs);
      }
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
      fail(new Error(`WebRTC peer connection entered ${peerConnection.connectionState} state.`));
    }
  };
  peerConnection.ondatachannel = (event) => installDataChannel(event.channel);
  peerConnection.onicecandidate = (event) => {
    if (!connectionId) {
      return;
    }
    const pending = event.candidate
      ? {
        signalType: 'ice_candidate' as const,
        payload: {
          connectionId,
          candidate: event.candidate.toJSON(),
        } satisfies CandidateSignalPayload,
      }
      : {
        signalType: 'end_of_candidates' as const,
        payload: { connectionId } satisfies EndOfCandidatesSignalPayload,
      };
    if (!publishingCandidates) {
      pendingLocalCandidates.push(pending);
      return;
    }
    void queueSignal(pending.signalType, pending.payload);
  };

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    if (options.initiator) {
      const channel = peerConnection.createDataChannel(DATA_CHANNEL_LABEL, {
        ordered: true,
      });
      installDataChannel(channel);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const localDescription = peerConnection.localDescription;
      if (!connectionId || !localDescription?.sdp) {
        throw new Error('WebRTC offer did not produce a local description.');
      }
      await queueSignal('offer', {
        connectionId,
        description: { type: 'offer', sdp: localDescription.sdp },
      } satisfies DescriptionSignalPayload);
      await flushLocalCandidates();
    }

    void pollSignals();
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`WebRTC gameplay channel did not connect within ${connectTimeoutMs}ms.`));
      }, connectTimeoutMs);
    });
    const connectedChannel = await Promise.race([channelOpen, timeout]);
    stopped = true;
    const connectionPath = await inferConnectionPath(peerConnection);
    return {
      channel: connectedChannel,
      connectionPath,
      close: () => {
        stopped = true;
        connectedChannel.close();
        peerConnection.close();
      },
    };
  } catch (error) {
    stopped = true;
    dataChannel?.close();
    peerConnection.close();
    throw error;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
