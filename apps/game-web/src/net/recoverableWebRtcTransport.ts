import type {
  OnlineFrameEnvelope,
  OnlineFrameSubmission,
  OnlineFrameTransport,
} from './onlineInputPump';
import {
  WebRtcFrameAckTimeoutError,
  WebRtcFrameTransport,
  WebRtcFrameTransportClosedError,
  type PreparedWebRtcFrameChannel,
  type WebRtcFrameTransportOptions,
} from './webRtcFrameTransport';
import type { ConnectedWebRtcSession } from './webRtcSession';

export type WebRtcRecoveryState = 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface WebRtcRecoverySnapshot {
  state: WebRtcRecoveryState;
  attempt: number;
  maxAttempts: number;
  lastError: Error | null;
}

export interface RecoverableWebRtcTransportOptions {
  initialSession: ConnectedWebRtcSession;
  localAccountId: string;
  remoteAccountId: string;
  connect: () => Promise<ConnectedWebRtcSession>;
  prepareRecovery?: () => Promise<void>;
  validateReplacement?: (session: ConnectedWebRtcSession) => Promise<void>;
  maxAttempts?: number;
  maxRecoveries?: number;
  retryDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  frameTransport?: Omit<
    WebRtcFrameTransportOptions,
    'channel' | 'localAccountId' | 'remoteAccountId' | 'recoverOnChannelFailure' | 'onRecoverableDisconnect'
  >;
  onStateChange?: (snapshot: WebRtcRecoverySnapshot) => void;
  onRecovered?: (session: ConnectedWebRtcSession) => void;
  onTerminalFailure?: (error: Error) => void;
}

const DEFAULT_MAX_RECOVERY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return resolved;
}

export class WebRtcRecoveryExhaustedError extends Error {
  public readonly cause: Error;

  public constructor(attempts: number, cause: Error) {
    super(`WebRTC recovery failed after ${attempts} attempts: ${cause.message}`);
    this.name = 'WebRtcRecoveryExhaustedError';
    this.cause = cause;
  }
}

export class RecoverableWebRtcTransport implements OnlineFrameTransport {
  private readonly connect: () => Promise<ConnectedWebRtcSession>;

  private readonly prepareRecovery?: () => Promise<void>;

  private readonly validateReplacement?: (session: ConnectedWebRtcSession) => Promise<void>;

  private readonly maxAttempts: number;

  private readonly maxRecoveries: number;

  private readonly retryDelayMs: number;

  private readonly wait: (milliseconds: number) => Promise<void>;

  private readonly onStateChange?: (snapshot: WebRtcRecoverySnapshot) => void;

  private readonly onRecovered?: (session: ConnectedWebRtcSession) => void;

  private readonly onTerminalFailure?: (error: Error) => void;

  private readonly frameTransport: WebRtcFrameTransport;

  private currentSession: ConnectedWebRtcSession;

  private state: WebRtcRecoveryState = 'connected';

  private attempt = 0;

  private lastError: Error | null = null;

  private generation = 1;

  private recoveryPromise: Promise<void> | null = null;

  private completedRecoveries = 0;

  public constructor(options: RecoverableWebRtcTransportOptions) {
    this.connect = options.connect;
    this.prepareRecovery = options.prepareRecovery;
    this.validateReplacement = options.validateReplacement;
    this.maxAttempts = positiveInteger(
      options.maxAttempts,
      DEFAULT_MAX_RECOVERY_ATTEMPTS,
      'maxAttempts',
    );
    this.maxRecoveries = positiveInteger(options.maxRecoveries, 1, 'maxRecoveries');
    this.retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
    this.wait = options.wait ?? waitFor;
    this.onStateChange = options.onStateChange;
    this.onRecovered = options.onRecovered;
    this.onTerminalFailure = options.onTerminalFailure;
    this.currentSession = options.initialSession;
    this.frameTransport = new WebRtcFrameTransport({
      ...options.frameTransport,
      channel: options.initialSession.channel,
      localAccountId: options.localAccountId,
      remoteAccountId: options.remoteAccountId,
      recoverOnChannelFailure: true,
      onRecoverableDisconnect: (error) => this.requestRecovery(error),
    });
  }

  public async submitFrames(frames: OnlineFrameSubmission[]): Promise<{ acceptedFrames: number }> {
    try {
      return await this.frameTransport.submitFrames(frames);
    } catch (error) {
      if (error instanceof WebRtcFrameAckTimeoutError && this.state === 'connected') {
        const disconnect = new WebRtcFrameTransportClosedError(error.message);
        this.requestRecovery(disconnect);
        throw disconnect;
      }
      throw error;
    }
  }

  public pollFrames(
    epoch: number,
    sinceFrame: number,
  ): Promise<{ frames: OnlineFrameEnvelope[]; peerConfirmedThrough: number }> {
    return this.frameTransport.pollFrames(epoch, sinceFrame);
  }

  public confirmFrames(
    epoch: number,
    confirmedThrough: number,
  ): Promise<{ confirmedThrough: number }> {
    return this.frameTransport.confirmFrames(epoch, confirmedThrough);
  }

  public requestRecovery(reason: Error): void {
    if (this.state !== 'connected') {
      return;
    }
    if (this.completedRecoveries >= this.maxRecoveries) {
      this.failRecovery(new WebRtcRecoveryExhaustedError(this.maxAttempts, new Error(
        `Transport already used its ${this.maxRecoveries} allowed recovery window.`,
      )));
      return;
    }
    this.state = 'reconnecting';
    this.attempt = 0;
    this.lastError = reason;
    const generation = ++this.generation;
    this.emitState();
    this.frameTransport.suspendForRecovery(
      reason instanceof WebRtcFrameTransportClosedError
        ? reason
        : new WebRtcFrameTransportClosedError(reason.message),
    );
    this.recoveryPromise = this.recover(generation);
  }

  public getSnapshot(): WebRtcRecoverySnapshot {
    return {
      state: this.state,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
      lastError: this.lastError,
    };
  }

  public waitForRecovery(): Promise<void> {
    return this.recoveryPromise ?? Promise.resolve();
  }

  public close(): void {
    if (this.state === 'closed') {
      return;
    }
    this.generation += 1;
    this.state = 'closed';
    this.frameTransport.close();
    this.currentSession.close();
    this.emitState();
  }

  private async recover(generation: number): Promise<void> {
    let finalError = this.lastError ?? new Error('WebRTC transport disconnected.');
    if (this.prepareRecovery) {
      try {
        await this.prepareRecovery();
      } catch (error) {
        finalError = error instanceof Error ? error : new Error(String(error));
        if (this.isCurrentRecovery(generation)) {
          this.failRecovery(new WebRtcRecoveryExhaustedError(0, finalError));
        }
        return;
      }
    }
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (!this.isCurrentRecovery(generation)) {
        return;
      }
      this.attempt = attempt;
      this.emitState();
      let nextSession: ConnectedWebRtcSession | null = null;
      let preparedChannel: PreparedWebRtcFrameChannel | null = null;
      try {
        nextSession = await this.connect();
        if (!this.isCurrentRecovery(generation)) {
          nextSession.close();
          return;
        }
        preparedChannel = this.frameTransport.prepareReplacementChannel(nextSession.channel);
        await this.validateReplacement?.(nextSession);
        if (!this.isCurrentRecovery(generation)) {
          preparedChannel.discard();
          nextSession.close();
          return;
        }
        preparedChannel.activate();
        preparedChannel = null;
        const previousSession = this.currentSession;
        this.currentSession = nextSession;
        this.state = 'connected';
        this.completedRecoveries += 1;
        this.attempt = 0;
        this.lastError = null;
        try {
          this.onRecovered?.(nextSession);
        } catch {
          // Observers cannot invalidate an already established replacement channel.
        }
        this.emitState();
        previousSession.close();
        return;
      } catch (error) {
        preparedChannel?.discard();
        nextSession?.close();
        finalError = error instanceof Error ? error : new Error(String(error));
        this.lastError = finalError;
        if (attempt < this.maxAttempts && this.isCurrentRecovery(generation)) {
          await this.wait(this.retryDelayMs * attempt);
        }
      }
    }

    if (!this.isCurrentRecovery(generation)) {
      return;
    }
    const exhausted = new WebRtcRecoveryExhaustedError(this.maxAttempts, finalError);
    this.failRecovery(exhausted);
  }

  private failRecovery(exhausted: WebRtcRecoveryExhaustedError): void {
    if (this.state === 'closed' || this.state === 'failed') {
      return;
    }
    this.state = 'failed';
    this.lastError = exhausted;
    this.frameTransport.close();
    this.currentSession.close();
    this.emitState();
    try {
      this.onTerminalFailure?.(exhausted);
    } catch {
      // The owner will observe the terminal state even if its callback fails.
    }
  }

  private isCurrentRecovery(generation: number): boolean {
    return this.generation === generation && this.state === 'reconnecting';
  }

  private emitState(): void {
    try {
      this.onStateChange?.(this.getSnapshot());
    } catch {
      // State observers are diagnostic and cannot own transport lifetime.
    }
  }
}
