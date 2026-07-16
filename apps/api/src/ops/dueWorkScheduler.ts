export interface DueWorkSchedulerOptions {
  run(): Promise<number | null>;
  retryDelayMs: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  onError?: (error: unknown) => void;
}
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class DueWorkScheduler {
  private readonly now: () => number;

  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;

  private readonly clearTimer: (timer: unknown) => void;

  private readonly onError: (error: unknown) => void;

  private timer: unknown | null = null;

  private scheduledForMs: number | null = null;

  private inFlight: Promise<void> | null = null;

  private rerunRequested = false;

  private stopped = false;

  public constructor(private readonly options: DueWorkSchedulerOptions) {
    if (!Number.isSafeInteger(options.retryDelayMs) || options.retryDelayMs <= 0) {
      throw new Error('Due-work retry delay must be a positive integer.');
    }
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
    this.onError = options.onError ?? (() => undefined);
  }

  public runNow(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    this.rerunRequested = true;
    this.clearScheduledTimer();
    if (this.inFlight) {
      return this.inFlight;
    }
    const operation = this.drain();
    this.inFlight = operation;
    operation.then(() => {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    });
    return operation;
  }

  public stop(): void {
    this.stopped = true;
    this.rerunRequested = false;
    this.clearScheduledTimer();
  }

  public scheduledAt(): number | null {
    return this.scheduledForMs;
  }

  public whenIdle(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    while (this.rerunRequested && !this.stopped) {
      this.rerunRequested = false;
      try {
        const nextRunAt = await this.options.run();
        if (!this.rerunRequested && nextRunAt !== null) {
          if (!Number.isFinite(nextRunAt)) {
            throw new Error('Due-work callback returned an invalid timestamp.');
          }
          this.scheduleAt(Math.max(0, Math.floor(nextRunAt)));
        }
      } catch (error) {
        this.onError(error);
        if (!this.rerunRequested && !this.stopped) {
          this.scheduleAt(this.now() + this.options.retryDelayMs);
        }
      }
    }
  }

  private scheduleAt(timestampMs: number): void {
    this.clearScheduledTimer();
    this.scheduledForMs = timestampMs;
    this.armTimer();
  }

  private armTimer(): void {
    const scheduledForMs = this.scheduledForMs;
    if (this.stopped || scheduledForMs === null) {
      return;
    }
    const delayMs = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, scheduledForMs - this.now()),
    );
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.stopped) {
        return;
      }
      if (this.now() < scheduledForMs) {
        this.armTimer();
        return;
      }
      this.scheduledForMs = null;
      void this.runNow();
    }, delayMs);
    (this.timer as { unref?: () => void } | null)?.unref?.();
  }

  private clearScheduledTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.scheduledForMs = null;
  }
}
