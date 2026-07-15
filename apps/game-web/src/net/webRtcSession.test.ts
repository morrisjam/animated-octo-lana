import { describe, expect, it } from 'vitest';
import {
  connectWebRtcSession,
  type WebRtcSignalEnvelope,
  type WebRtcSignalTransport,
} from './webRtcSession';

const TRANSPORT_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class FakeDataChannel {
  public binaryType: BinaryType = 'blob';

  public readyState: RTCDataChannelState = 'connecting';

  public onopen: ((event: Event) => void) | null = null;

  public onerror: ((event: Event) => void) | null = null;

  public readonly label = 'gravity-well-input-v1';

  public close(): void {
    this.readyState = 'closed';
  }

  public open(): void {
    this.readyState = 'open';
    this.onopen?.(new Event('open'));
  }
}

interface FakePeerPair {
  candidateType: 'host' | 'relay';
  created: number;
  initiatorChannel: FakeDataChannel | null;
  responderChannel: FakeDataChannel | null;
}

class FakePeerConnection {
  public connectionState: RTCPeerConnectionState = 'new';

  public localDescription: RTCSessionDescription | null = null;

  public onconnectionstatechange: ((event: Event) => void) | null = null;

  public ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

  public onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;

  private readonly initiator: boolean;

  public constructor(private readonly pair: FakePeerPair) {
    this.initiator = pair.created === 0;
    pair.created += 1;
  }

  public createDataChannel(): RTCDataChannel {
    const channel = new FakeDataChannel();
    this.pair.initiatorChannel = channel;
    return channel as unknown as RTCDataChannel;
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer' };
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake-answer' };
  }

  public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
  }

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.initiator && description.type === 'offer') {
      const channel = new FakeDataChannel();
      this.pair.responderChannel = channel;
      this.ondatachannel?.({ channel } as unknown as RTCDataChannelEvent);
      return;
    }
    if (this.initiator && description.type === 'answer') {
      this.connectionState = 'connected';
      queueMicrotask(() => {
        this.pair.initiatorChannel?.open();
        this.pair.responderChannel?.open();
      });
    }
  }

  public async addIceCandidate(): Promise<void> {
    return undefined;
  }

  public async getStats(): Promise<RTCStatsReport> {
    const entries = new Map<string, RTCStats>([
      ['transport', {
        id: 'transport',
        timestamp: 1,
        type: 'transport',
        selectedCandidatePairId: 'pair',
      } as RTCStats],
      ['pair', {
        id: 'pair',
        timestamp: 1,
        type: 'candidate-pair',
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
      } as RTCStats],
      ['local', {
        id: 'local',
        timestamp: 1,
        type: 'local-candidate',
        candidateType: this.pair.candidateType,
      } as RTCStats],
      ['remote', {
        id: 'remote',
        timestamp: 1,
        type: 'remote-candidate',
        candidateType: this.pair.candidateType,
      } as RTCStats],
    ]);
    return entries as unknown as RTCStatsReport;
  }

  public close(): void {
    this.connectionState = 'closed';
  }
}

class FakeSignalMailbox {
  private nextSignalId = 1n;

  private readonly signals: WebRtcSignalEnvelope[] = [];

  public seed(
    senderAccountId: string,
    signalType: WebRtcSignalEnvelope['signalType'],
    payload: unknown,
    transportAttemptId = TRANSPORT_ATTEMPT_ID,
  ): void {
    const signalId = this.nextSignalId.toString();
    this.nextSignalId += 1n;
    this.signals.push({
      signalId,
      transportAttemptId,
      senderAccountId,
      signalType,
      payload,
      createdAt: new Date(Number(signalId) * 1_000).toISOString(),
    });
  }

  public transport(accountId: string): WebRtcSignalTransport {
    return {
      publish: async (signal) => {
        const signalId = this.nextSignalId.toString();
        this.nextSignalId += 1n;
        this.signals.push({
          signalId,
          transportAttemptId: TRANSPORT_ATTEMPT_ID,
          senderAccountId: accountId,
          signalType: signal.signalType,
          payload: signal.payload,
          createdAt: new Date(Number(signalId) * 1_000).toISOString(),
        });
        return { signalId };
      },
      poll: async (sinceSignalId) => ({
        signals: this.signals.filter((signal) => (
          signal.senderAccountId !== accountId && BigInt(signal.signalId) > BigInt(sinceSignalId)
        )),
      }),
    };
  }
}

function createMessageIdFactory(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}-${counter += 1}`;
}

describe('connectWebRtcSession', () => {
  it.each([
    ['host', 'direct'],
    ['relay', 'relay'],
  ] as const)('negotiates a paired channel and reports the %s path', async (candidateType, expectedPath) => {
    const mailbox = new FakeSignalMailbox();
    const pair: FakePeerPair = {
      candidateType,
      created: 0,
      initiatorChannel: null,
      responderChannel: null,
    };
    const peerConnectionFactory = () => (
      new FakePeerConnection(pair) as unknown as RTCPeerConnection
    );

    const initiatorPromise = connectWebRtcSession({
      transportAttemptId: TRANSPORT_ATTEMPT_ID,
      localAccountId: 'account-p1',
      remoteAccountId: 'account-p2',
      initiator: true,
      rtcConfiguration: {},
      signalTransport: mailbox.transport('account-p1'),
      connectTimeoutMs: 5_000,
      pollIntervalMs: 25,
      peerConnectionFactory,
      createMessageId: createMessageIdFactory('p1'),
    });
    const responderPromise = connectWebRtcSession({
      transportAttemptId: TRANSPORT_ATTEMPT_ID,
      localAccountId: 'account-p2',
      remoteAccountId: 'account-p1',
      initiator: false,
      rtcConfiguration: {},
      signalTransport: mailbox.transport('account-p2'),
      connectTimeoutMs: 5_000,
      pollIntervalMs: 25,
      peerConnectionFactory,
      createMessageId: createMessageIdFactory('p2'),
    });

    const [initiator, responder] = await Promise.all([initiatorPromise, responderPromise]);
    expect(initiator.channel.readyState).toBe('open');
    expect(responder.channel.readyState).toBe('open');
    expect(initiator.connectionPath).toBe(expectedPath);
    expect(responder.connectionPath).toBe(expectedPath);

    initiator.close();
    responder.close();
  });

  it('selects the newest offer when an earlier connection attempt remains in the mailbox', async () => {
    const mailbox = new FakeSignalMailbox();
    mailbox.seed('account-p1', 'offer', {
      connectionId: 'stale-attempt',
      description: { type: 'offer', sdp: 'stale-offer' },
    });
    const pair: FakePeerPair = {
      candidateType: 'host',
      created: 0,
      initiatorChannel: null,
      responderChannel: null,
    };
    const peerConnectionFactory = () => (
      new FakePeerConnection(pair) as unknown as RTCPeerConnection
    );

    const [initiator, responder] = await Promise.all([
      connectWebRtcSession({
        transportAttemptId: TRANSPORT_ATTEMPT_ID,
        localAccountId: 'account-p1',
        remoteAccountId: 'account-p2',
        initiator: true,
        rtcConfiguration: {},
        signalTransport: mailbox.transport('account-p1'),
        connectTimeoutMs: 5_000,
        pollIntervalMs: 25,
        peerConnectionFactory,
        createMessageId: createMessageIdFactory('fresh-p1'),
      }),
      connectWebRtcSession({
        transportAttemptId: TRANSPORT_ATTEMPT_ID,
        localAccountId: 'account-p2',
        remoteAccountId: 'account-p1',
        initiator: false,
        rtcConfiguration: {},
        signalTransport: mailbox.transport('account-p2'),
        connectTimeoutMs: 5_000,
        pollIntervalMs: 25,
        peerConnectionFactory,
        createMessageId: createMessageIdFactory('fresh-p2'),
      }),
    ]);

    expect(initiator.channel.readyState).toBe('open');
    expect(responder.channel.readyState).toBe('open');
    initiator.close();
    responder.close();
  });

  it('retries transient signaling polls without treating them as protocol errors', async () => {
    const mailbox = new FakeSignalMailbox();
    const pair: FakePeerPair = {
      candidateType: 'host',
      created: 0,
      initiatorChannel: null,
      responderChannel: null,
    };
    const peerConnectionFactory = () => (
      new FakePeerConnection(pair) as unknown as RTCPeerConnection
    );
    const responderTransport = mailbox.transport('account-p2');
    let failedPolls = 0;

    const [initiator, responder] = await Promise.all([
      connectWebRtcSession({
        transportAttemptId: TRANSPORT_ATTEMPT_ID,
        localAccountId: 'account-p1',
        remoteAccountId: 'account-p2',
        initiator: true,
        rtcConfiguration: {},
        signalTransport: mailbox.transport('account-p1'),
        connectTimeoutMs: 5_000,
        pollIntervalMs: 25,
        peerConnectionFactory,
        createMessageId: createMessageIdFactory('retry-p1'),
      }),
      connectWebRtcSession({
        transportAttemptId: TRANSPORT_ATTEMPT_ID,
        localAccountId: 'account-p2',
        remoteAccountId: 'account-p1',
        initiator: false,
        rtcConfiguration: {},
        signalTransport: {
          ...responderTransport,
          poll: async (cursor) => {
            if (failedPolls < 2) {
              failedPolls += 1;
              throw new Error('temporary signaling outage');
            }
            return await responderTransport.poll(cursor);
          },
        },
        connectTimeoutMs: 5_000,
        pollIntervalMs: 25,
        peerConnectionFactory,
        createMessageId: createMessageIdFactory('retry-p2'),
      }),
    ]);

    expect(failedPolls).toBe(2);
    initiator.close();
    responder.close();
  });

  it('reuses a client message id after the signal commits but its response is lost', async () => {
    const pair: FakePeerPair = {
      candidateType: 'host',
      created: 0,
      initiatorChannel: null,
      responderChannel: null,
    };
    type PublishedSignal = Parameters<WebRtcSignalTransport['publish']>[0];
    const attempts: PublishedSignal[] = [];
    const committedSignals = new Map<string, { signalId: string; signal: PublishedSignal }>();
    let loseFirstResponse = true;
    const signalTransport: WebRtcSignalTransport = {
      publish: async (signal) => {
        attempts.push(signal);
        let committed = committedSignals.get(signal.clientMessageId);
        if (!committed) {
          committed = {
            signalId: String(committedSignals.size + 1),
            signal,
          };
          committedSignals.set(signal.clientMessageId, committed);
        }
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('response lost after commit');
        }
        queueMicrotask(() => pair.initiatorChannel?.open());
        return { signalId: committed.signalId };
      },
      poll: async () => ({ signals: [] }),
    };

    const session = await connectWebRtcSession({
      transportAttemptId: TRANSPORT_ATTEMPT_ID,
      localAccountId: 'account-p1',
      remoteAccountId: 'account-p2',
      initiator: true,
      rtcConfiguration: {},
      signalTransport,
      connectTimeoutMs: 5_000,
      pollIntervalMs: 25,
      peerConnectionFactory: () => (
        new FakePeerConnection(pair) as unknown as RTCPeerConnection
      ),
      createMessageId: createMessageIdFactory('commit-loss'),
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.clientMessageId).toBe('commit-loss-2');
    expect(attempts[1]?.clientMessageId).toBe(attempts[0]?.clientMessageId);
    expect(committedSignals.size).toBe(1);
    expect(session.channel.readyState).toBe('open');
    session.close();
  });

  it('fails immediately on a signal from an unexpected account', async () => {
    const mailbox = new FakeSignalMailbox();
    mailbox.seed('intruder-account', 'offer', {
      connectionId: 'intruder-attempt',
      description: { type: 'offer', sdp: 'intruder-offer' },
    });
    const pair: FakePeerPair = {
      candidateType: 'host',
      created: 0,
      initiatorChannel: null,
      responderChannel: null,
    };

    await expect(connectWebRtcSession({
      transportAttemptId: TRANSPORT_ATTEMPT_ID,
      localAccountId: 'account-p2',
      remoteAccountId: 'account-p1',
      initiator: false,
      rtcConfiguration: {},
      signalTransport: mailbox.transport('account-p2'),
      connectTimeoutMs: 5_000,
      pollIntervalMs: 25,
      peerConnectionFactory: () => new FakePeerConnection(pair) as unknown as RTCPeerConnection,
      createMessageId: createMessageIdFactory('invalid-p2'),
    })).rejects.toThrow('unexpected account');
  });

  it('rejects a delayed signal from a superseded transport attempt', async () => {
    const mailbox = new FakeSignalMailbox();
    mailbox.seed('account-p1', 'offer', {
      connectionId: 'stale-connection',
      description: { type: 'offer', sdp: 'stale-offer' },
    }, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const pair: FakePeerPair = {
      candidateType: 'host',
      created: 0,
      initiatorChannel: null,
      responderChannel: null,
    };

    await expect(connectWebRtcSession({
      transportAttemptId: TRANSPORT_ATTEMPT_ID,
      localAccountId: 'account-p2',
      remoteAccountId: 'account-p1',
      initiator: false,
      rtcConfiguration: {},
      signalTransport: mailbox.transport('account-p2'),
      connectTimeoutMs: 5_000,
      pollIntervalMs: 25,
      peerConnectionFactory: () => new FakePeerConnection(pair) as unknown as RTCPeerConnection,
      createMessageId: createMessageIdFactory('stale-p2'),
    })).rejects.toThrow('stale transport attempt');
  });
});
