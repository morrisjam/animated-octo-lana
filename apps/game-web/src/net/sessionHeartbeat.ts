export interface SessionHeartbeatLoopOptions {
  intervalMs: number;
  /**
   * The loop always supplies a signal. Forward it to the underlying request so
   * stop/restart and deadline cancellation can release transport resources.
   */
  heartbeat: (signal?: AbortSignal) => Promise<void>;
  /** Defaults to intervalMs so every pulse is bounded even for legacy callers. */
  timeoutMs?: number;
  onError?: (error: unknown) => void;
  setIntervalFn?: (callback: () => void, intervalMs: number) => unknown;
  clearIntervalFn?: (timer: unknown) => void;
  setTimeoutFn?: (callback: () => void, timeoutMs: number) => unknown;
  clearTimeoutFn?: (timer: unknown) => void;
}

export class SessionHeartbeatTimeoutError extends Error {
  public readonly timeoutMs: number;

  public constructor(timeoutMs: number) {
    super(`Session heartbeat did not settle within ${timeoutMs}ms.`);
    this.name = 'SessionHeartbeatTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

interface ActiveHeartbeatPulse {
  controller: AbortController;
  cancel(error: Error): void;
  timeoutTimer: unknown | null;
}

function createAbortError(): Error {
  const error = new Error('Session heartbeat stopped.');
  error.name = 'AbortError';
  return error;
}

function normaliseMilliseconds(value: number, minimum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

export class SessionHeartbeatLoop {
  private readonly intervalMs: number;

  private readonly timeoutMs: number;

  private readonly heartbeat: (signal?: AbortSignal) => Promise<void>;

  private readonly onError: (error: unknown) => void;

  private readonly setIntervalFn: (callback: () => void, intervalMs: number) => unknown;

  private readonly clearIntervalFn: (timer: unknown) => void;

  private readonly setTimeoutFn: (callback: () => void, timeoutMs: number) => unknown;

  private readonly clearTimeoutFn: (timer: unknown) => void;

  private timer: unknown = null;

  private running = false;

  private activePulse: ActiveHeartbeatPulse | null = null;

  private generation = 0;

  public constructor(options: SessionHeartbeatLoopOptions) {
    this.intervalMs = normaliseMilliseconds(options.intervalMs, 1_000, 1_000);
    this.timeoutMs = normaliseMilliseconds(
      options.timeoutMs ?? this.intervalMs,
      1,
      this.intervalMs,
    );
    this.heartbeat = options.heartbeat;
    this.onError = options.onError ?? (() => undefined);
    this.setIntervalFn = options.setIntervalFn
      ?? ((callback, intervalMs) => globalThis.setInterval(callback, intervalMs));
    this.clearIntervalFn = options.clearIntervalFn
      ?? ((timer) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>));
    this.setTimeoutFn = options.setTimeoutFn
      ?? ((callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs));
    this.clearTimeoutFn = options.clearTimeoutFn
      ?? ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.generation += 1;
    const generation = this.generation;
    this.timer = this.setIntervalFn(() => {
      if (this.running && this.generation === generation) {
        void this.pulse();
      }
    }, this.intervalMs);
    void this.pulse();
  }

  public stop(): void {
    this.running = false;
    this.generation += 1;
    const activePulse = this.activePulse;
    this.activePulse = null;
    if (activePulse) {
      if (activePulse.timeoutTimer !== null) {
        this.clearTimeoutFn(activePulse.timeoutTimer);
        activePulse.timeoutTimer = null;
      }
      const error = createAbortError();
      activePulse.cancel(error);
      activePulse.controller.abort(error);
    }
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async pulse(): Promise<boolean> {
    if (!this.running || this.activePulse !== null) {
      return false;
    }
    const generation = this.generation;
    const controller = new AbortController();
    let cancelPulse: (error: Error) => void = () => undefined;
    const cancellation = new Promise<never>((_, reject) => {
      cancelPulse = reject;
    });
    const activePulse: ActiveHeartbeatPulse = {
      controller,
      cancel: cancelPulse,
      timeoutTimer: null,
    };
    this.activePulse = activePulse;
    try {
      activePulse.timeoutTimer = this.setTimeoutFn(() => {
        activePulse.timeoutTimer = null;
        const error = new SessionHeartbeatTimeoutError(this.timeoutMs);
        activePulse.cancel(error);
        activePulse.controller.abort(error);
      }, this.timeoutMs);
      const heartbeat = this.heartbeat(controller.signal);
      await Promise.race([heartbeat, cancellation]);
    } catch (error) {
      if (this.running && this.generation === generation) {
        this.onError(error);
      }
    } finally {
      if (activePulse.timeoutTimer !== null) {
        this.clearTimeoutFn(activePulse.timeoutTimer);
        activePulse.timeoutTimer = null;
      }
      if (this.activePulse === activePulse) {
        this.activePulse = null;
      }
    }
    return true;
  }
}
