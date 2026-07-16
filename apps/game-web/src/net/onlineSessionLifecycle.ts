import { SessionHeartbeatLoop, type SessionHeartbeatLoopOptions } from './sessionHeartbeat';

export type OnlineSessionSuspendSource = 'visibility_hidden' | 'pagehide';
export type OnlineSessionResumeSource = 'visibility_visible' | 'heartbeat_timeout';
export type OnlineSessionLifecyclePhase = 'idle' | 'active' | 'suspending' | 'suspended' | 'resuming';

export const ONLINE_PAUSE_BLOCKED_MESSAGE = 'Pause is unavailable during online play. The match continues in real time.';

export interface GameplayPauseDecision {
  togglePause: boolean;
  forceUnpaused: boolean;
  resetAccumulator: boolean;
  statusText: string | null;
}

export function resolveGameplayPauseRequest(onlineMatchActive: boolean): GameplayPauseDecision {
  if (onlineMatchActive) {
    return {
      togglePause: false,
      forceUnpaused: true,
      resetAccumulator: false,
      statusText: ONLINE_PAUSE_BLOCKED_MESSAGE,
    };
  }
  return {
    togglePause: true,
    forceUnpaused: false,
    resetAccumulator: true,
    statusText: null,
  };
}

export interface MatchedTicketBootstrapView {
  ticketId: string;
  status: 'queued' | 'matched' | 'closed';
  sessionId: string | null;
}

export type MatchedTicketBootstrapAction =
  | 'none'
  | 'start_fresh'
  | 'restore_checkpoint'
  | 'resume_or_rejoin';

export interface MatchedTicketBootstrapOptions {
  previousTicket: MatchedTicketBootstrapView | null;
  currentTicket: MatchedTicketBootstrapView;
  sessionStatus: 'active' | 'resolved' | null;
  hasVerifiedCheckpoint?: boolean;
  serverCreatedTicket?: boolean;
}

export function decideMatchedTicketBootstrap(
  options: MatchedTicketBootstrapOptions,
): MatchedTicketBootstrapAction {
  const { currentTicket, previousTicket } = options;
  if (currentTicket.status !== 'matched' || !currentTicket.sessionId) {
    return 'none';
  }
  if (options.sessionStatus !== 'active') {
    return 'resume_or_rejoin';
  }
  if (options.hasVerifiedCheckpoint) {
    return 'restore_checkpoint';
  }
  if (
    previousTicket?.ticketId === currentTicket.ticketId
    && previousTicket.status === 'queued'
  ) {
    return 'start_fresh';
  }
  if (
    options.serverCreatedTicket
  ) {
    return 'start_fresh';
  }
  return 'resume_or_rejoin';
}

export interface PeerPresenceRecoveryOptions {
  localSide: 'P1' | 'P2';
  peerConnectionStatus: 'connected' | 'disconnected' | null;
  transportState: 'connected' | 'reconnecting' | 'failed' | 'closed';
}

export function shouldRecoverForPeerPresence(
  options: PeerPresenceRecoveryOptions,
): boolean {
  return options.peerConnectionStatus === 'disconnected'
    && options.transportState === 'connected';
}

export interface OnlineSessionLifecycleTarget {
  sessionId: string;
  sessionToken: string;
  localAccountId: string;
  intervalMs: number;
}

export type OnlineSessionLifecycleEvent =
  | {
    type: 'suspended';
    source: OnlineSessionSuspendSource;
    target: OnlineSessionLifecycleTarget;
  }
  | {
    type: 'reconnecting';
    source: OnlineSessionResumeSource;
    target: OnlineSessionLifecycleTarget;
  }
  | {
    type: 'resumed';
    source: OnlineSessionResumeSource;
    target: OnlineSessionLifecycleTarget;
  }
  | {
    type: 'heartbeat_recovered';
    source: 'heartbeat_timeout';
    target: OnlineSessionLifecycleTarget;
  };

export interface OnlineSessionLifecycleError {
  phase: 'heartbeat' | 'disconnect' | 'reconnect';
  source: OnlineSessionSuspendSource | OnlineSessionResumeSource | null;
  target: OnlineSessionLifecycleTarget;
  error: unknown;
}

export interface OnlineSessionLifecycleSnapshot {
  generation: number;
  phase: OnlineSessionLifecyclePhase;
  sessionId: string | null;
  desiredSuspended: boolean;
  disconnectConfirmed: boolean;
  heartbeatRunning: boolean;
}

interface HeartbeatLoopLike {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export interface OnlineSessionLifecycleControllerOptions {
  heartbeat(target: OnlineSessionLifecycleTarget, signal?: AbortSignal): Promise<void>;
  disconnect(target: OnlineSessionLifecycleTarget, source: OnlineSessionSuspendSource): Promise<void>;
  reconnect(target: OnlineSessionLifecycleTarget, source: OnlineSessionResumeSource): Promise<void>;
  isDisconnectedError(error: unknown): boolean;
  reconnectMaxAttempts?: number;
  reconnectRetryDelayMs?: number;
  isRetryableReconnectError?(error: unknown): boolean;
  waitForReconnectRetry?(milliseconds: number): Promise<void>;
  onEvent?(event: OnlineSessionLifecycleEvent): void;
  onError?(error: OnlineSessionLifecycleError): void;
  createHeartbeatLoop?(options: SessionHeartbeatLoopOptions): HeartbeatLoopLike;
}

export class OnlineSessionLifecycleController {
  private readonly options: OnlineSessionLifecycleControllerOptions;

  private readonly reconnectMaxAttempts: number;

  private readonly reconnectRetryDelayMs: number;

  private readonly waitForReconnectRetry: (milliseconds: number) => Promise<void>;

  private target: OnlineSessionLifecycleTarget | null = null;

  private heartbeatLoop: HeartbeatLoopLike | null = null;

  private generation = 0;

  private phase: OnlineSessionLifecyclePhase = 'idle';

  private desiredSuspended = false;

  private disconnectConfirmed = false;

  private transition = Promise.resolve();

  public constructor(options: OnlineSessionLifecycleControllerOptions) {
    const reconnectMaxAttempts = options.reconnectMaxAttempts ?? 1;
    if (!Number.isSafeInteger(reconnectMaxAttempts) || reconnectMaxAttempts < 1) {
      throw new Error('reconnectMaxAttempts must be a positive safe integer.');
    }
    const reconnectRetryDelayMs = options.reconnectRetryDelayMs ?? 0;
    if (!Number.isSafeInteger(reconnectRetryDelayMs) || reconnectRetryDelayMs < 0) {
      throw new Error('reconnectRetryDelayMs must be a non-negative safe integer.');
    }
    this.options = options;
    this.reconnectMaxAttempts = reconnectMaxAttempts;
    this.reconnectRetryDelayMs = reconnectRetryDelayMs;
    this.waitForReconnectRetry = options.waitForReconnectRetry
      ?? ((milliseconds) => new Promise((resolve) => {
        globalThis.setTimeout(resolve, milliseconds);
      }));
  }

  public start(target: OnlineSessionLifecycleTarget): void {
    this.resetRuntime();
    const generation = this.generation;
    const activeTarget = { ...target, intervalMs: Math.max(1_000, Math.floor(target.intervalMs)) };
    const createHeartbeatLoop = this.options.createHeartbeatLoop
      ?? ((loopOptions: SessionHeartbeatLoopOptions) => new SessionHeartbeatLoop(loopOptions));
    const heartbeatLoop = createHeartbeatLoop({
      intervalMs: activeTarget.intervalMs,
      heartbeat: (signal) => this.sendHeartbeat(generation, activeTarget, signal),
      onError: (error) => {
        if (!this.isCurrent(generation, activeTarget)) {
          return;
        }
        this.options.onError?.({
          phase: 'heartbeat',
          source: null,
          target: activeTarget,
          error,
        });
      },
    });
    this.target = activeTarget;
    this.heartbeatLoop = heartbeatLoop;
    this.phase = 'active';
    heartbeatLoop.start();
  }

  public clear(): void {
    this.resetRuntime();
  }

  public suspend(source: OnlineSessionSuspendSource): Promise<void> {
    const target = this.target;
    if (!target) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.desiredSuspended = true;
    this.heartbeatLoop?.stop();
    return this.enqueue(generation, target, async () => {
      if (this.phase === 'suspended' && this.disconnectConfirmed) {
        return;
      }
      this.phase = 'suspending';
      let confirmed = false;
      try {
        await this.options.disconnect(target, source);
        confirmed = true;
      } catch (error) {
        if (this.isCurrent(generation, target)) {
          this.options.onError?.({ phase: 'disconnect', source, target, error });
        }
      }
      if (!this.isCurrent(generation, target)) {
        return;
      }
      this.disconnectConfirmed = confirmed;
      this.phase = 'suspended';
      if (confirmed) {
        this.options.onEvent?.({ type: 'suspended', source, target });
      }
    });
  }

  public resume(source: 'visibility_visible'): Promise<void> {
    const target = this.target;
    if (!target) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.desiredSuspended = false;
    return this.enqueue(generation, target, async () => {
      if (this.phase === 'active') {
        this.heartbeatLoop?.start();
        return;
      }
      await this.reconnect(generation, target, source, false);
    });
  }

  public getSnapshot(): OnlineSessionLifecycleSnapshot {
    return {
      generation: this.generation,
      phase: this.phase,
      sessionId: this.target?.sessionId ?? null,
      desiredSuspended: this.desiredSuspended,
      disconnectConfirmed: this.disconnectConfirmed,
      heartbeatRunning: this.heartbeatLoop?.isRunning() ?? false,
    };
  }

  private resetRuntime(): void {
    this.generation += 1;
    this.heartbeatLoop?.stop();
    this.target = null;
    this.heartbeatLoop = null;
    this.phase = 'idle';
    this.desiredSuspended = false;
    this.disconnectConfirmed = false;
    // New sessions must never queue behind a stale network request from an old one.
    this.transition = Promise.resolve();
  }

  private isCurrent(generation: number, target: OnlineSessionLifecycleTarget): boolean {
    return this.generation === generation && this.target === target;
  }

  private enqueue(
    generation: number,
    target: OnlineSessionLifecycleTarget,
    operation: () => Promise<void>,
  ): Promise<void> {
    const queued = this.transition.then(async () => {
      if (!this.isCurrent(generation, target)) {
        return;
      }
      await operation();
    });
    this.transition = queued.catch(() => undefined);
    return queued;
  }

  private async sendHeartbeat(
    generation: number,
    target: OnlineSessionLifecycleTarget,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !this.isCurrent(generation, target)
      || this.phase !== 'active'
      || this.desiredSuspended
    ) {
      return;
    }
    try {
      await this.options.heartbeat(target, signal);
    } catch (error) {
      if (!this.options.isDisconnectedError(error)) {
        throw error;
      }
      if (!this.isCurrent(generation, target) || this.desiredSuspended) {
        return;
      }
      this.heartbeatLoop?.stop();
      this.disconnectConfirmed = true;
      await this.enqueue(generation, target, async () => {
        if (this.desiredSuspended) {
          this.phase = 'suspended';
          return;
        }
        await this.reconnect(generation, target, 'heartbeat_timeout', true);
      });
    }
  }

  private async reconnect(
    generation: number,
    target: OnlineSessionLifecycleTarget,
    source: OnlineSessionResumeSource,
    heartbeatRecovery: boolean,
  ): Promise<void> {
    this.phase = 'resuming';
    if (this.disconnectConfirmed) {
      this.options.onEvent?.({ type: 'reconnecting', source, target });
      for (let attempt = 1; attempt <= this.reconnectMaxAttempts; attempt += 1) {
        try {
          await this.options.reconnect(target, source);
          break;
        } catch (error) {
          if (!this.isCurrent(generation, target)) {
            return;
          }
          const retryable = !this.desiredSuspended
            && attempt < this.reconnectMaxAttempts
            && (this.options.isRetryableReconnectError?.(error) ?? false);
          if (retryable) {
            await this.waitForReconnectRetry(this.reconnectRetryDelayMs * attempt);
            if (!this.isCurrent(generation, target)) {
              return;
            }
            if (!this.desiredSuspended) {
              continue;
            }
          }
          if (!this.desiredSuspended) {
            this.options.onError?.({ phase: 'reconnect', source, target, error });
          }
          this.phase = 'suspended';
          this.heartbeatLoop?.stop();
          return;
        }
      }
    }
    if (!this.isCurrent(generation, target)) {
      return;
    }
    const reconnected = this.disconnectConfirmed;
    this.disconnectConfirmed = false;
    this.phase = this.desiredSuspended ? 'suspended' : 'active';
    if (!this.desiredSuspended) {
      this.heartbeatLoop?.start();
    }
    if (reconnected) {
      this.options.onEvent?.(heartbeatRecovery
        ? { type: 'heartbeat_recovered', source: 'heartbeat_timeout', target }
        : { type: 'resumed', source, target });
    }
  }
}

interface VisibilityDocumentLike {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface PageLifecycleWindowLike {
  addEventListener(type: 'pagehide' | 'pageshow', listener: () => void): void;
  removeEventListener(type: 'pagehide' | 'pageshow', listener: () => void): void;
}

export interface OnlineSessionLifecycleListenerOptions {
  controller: Pick<OnlineSessionLifecycleController, 'suspend' | 'resume'>;
  canManage(): boolean;
  documentTarget?: VisibilityDocumentLike;
  windowTarget?: PageLifecycleWindowLike;
}

export function installOnlineSessionLifecycleListeners(
  options: OnlineSessionLifecycleListenerOptions,
): () => void {
  const documentTarget = options.documentTarget ?? document;
  const windowTarget = options.windowTarget ?? window;
  const onVisibilityChange = (): void => {
    if (!options.canManage()) {
      return;
    }
    if (documentTarget.visibilityState === 'hidden') {
      void options.controller.suspend('visibility_hidden');
      return;
    }
    if (documentTarget.visibilityState === 'visible') {
      void options.controller.resume('visibility_visible');
    }
  };
  const onPageHide = (): void => {
    if (options.canManage()) {
      void options.controller.suspend('pagehide');
    }
  };
  const onPageShow = (): void => {
    if (options.canManage()) {
      void options.controller.resume('visibility_visible');
    }
  };
  documentTarget.addEventListener('visibilitychange', onVisibilityChange);
  windowTarget.addEventListener('pagehide', onPageHide);
  windowTarget.addEventListener('pageshow', onPageShow);
  return () => {
    documentTarget.removeEventListener('visibilitychange', onVisibilityChange);
    windowTarget.removeEventListener('pagehide', onPageHide);
    windowTarget.removeEventListener('pageshow', onPageShow);
  };
}
