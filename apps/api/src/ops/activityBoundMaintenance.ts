export interface ActivityBoundMaintenanceTask {
  id: string;
  intervalMs: number;
  run(): Promise<void>;
}
export interface ActivityBoundMaintenanceError {
  taskId: string;
  error: unknown;
}

export interface ActivityBoundMaintenanceOptions {
  now?: () => number;
  onError?: (failure: ActivityBoundMaintenanceError) => void;
}

function requestPath(url: string): string {
  return (url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
}

export function isInfrastructureProbe(url: string): boolean {
  const path = requestPath(url);
  return path === '/health' || path === '/readyz';
}

export function shouldTriggerDatabaseMaintenance(method: string, url: string): boolean {
  return method.toUpperCase() !== 'OPTIONS' && !isInfrastructureProbe(url);
}

export class ActivityBoundMaintenanceScheduler {
  private readonly now: () => number;

  private readonly onError: (failure: ActivityBoundMaintenanceError) => void;

  private readonly nextEligibleAtByTask = new Map<string, number>();

  private inFlight: Promise<void> | null = null;

  public constructor(
    private readonly tasks: readonly ActivityBoundMaintenanceTask[],
    options: ActivityBoundMaintenanceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.onError = options.onError ?? (() => undefined);
    const createdAt = this.now();
    for (const task of tasks) {
      if (!task.id.trim() || this.nextEligibleAtByTask.has(task.id)) {
        throw new Error('Maintenance task ids must be unique and non-empty.');
      }
      if (!Number.isSafeInteger(task.intervalMs) || task.intervalMs <= 0) {
        throw new Error(`Maintenance task ${task.id} must have a positive integer interval.`);
      }
      this.nextEligibleAtByTask.set(task.id, createdAt + task.intervalMs);
    }
  }

  public notifyActivity(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const operation = this.runDueTasks().catch((error) => {
      this.onError({ taskId: 'scheduler', error });
    });
    this.inFlight = operation;
    operation.then(() => {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    });
    return operation;
  }

  public nextEligibleAt(taskId: string): number | null {
    return this.nextEligibleAtByTask.get(taskId) ?? null;
  }

  private async runDueTasks(): Promise<void> {
    for (const task of this.tasks) {
      const now = this.now();
      const nextEligibleAt = this.nextEligibleAtByTask.get(task.id);
      if (nextEligibleAt === undefined || now < nextEligibleAt) {
        continue;
      }
      // Advance before running so a failed task retains the same bounded cadence.
      this.nextEligibleAtByTask.set(task.id, now + task.intervalMs);
      try {
        await task.run();
      } catch (error) {
        this.onError({ taskId: task.id, error });
      }
    }
  }
}
