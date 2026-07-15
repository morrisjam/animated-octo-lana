export interface OnlineCompletionSessionView {
  status: 'active' | 'resolved';
  resolvedReason?: string;
}

export type OnlineCompletionConsensusResult<T extends OnlineCompletionSessionView> =
  | {
    status: 'consensus';
    attempts: number;
    session: T;
    lastError: null;
  }
  | {
    status: 'terminal';
    attempts: number;
    session: T;
    lastError: unknown;
  }
  | {
    status: 'grace_expired';
    attempts: number;
    session: T | null;
    lastError: unknown;
  };

export interface ReconcileOnlineCompletionConsensusOptions<T extends OnlineCompletionSessionView> {
  attest(): Promise<T>;
  read(): Promise<T>;
  maxAttempts: number;
  wait(milliseconds: number): Promise<void>;
  retryIntervalMs: number;
  onAttempt?(attempt: number, maxAttempts: number, session: T | null, error: unknown): void;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

export async function reconcileOnlineCompletionConsensus<T extends OnlineCompletionSessionView>(
  options: ReconcileOnlineCompletionConsensusOptions<T>,
): Promise<OnlineCompletionConsensusResult<T>> {
  const maxAttempts = positiveInteger(options.maxAttempts, 'maxAttempts');
  const retryIntervalMs = positiveInteger(options.retryIntervalMs, 'retryIntervalMs');
  let lastSession: T | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastSession = await options.attest();
      lastError = null;
    } catch (attestError) {
      lastError = attestError;
      try {
        lastSession = await options.read();
      } catch (readError) {
        lastError = readError;
      }
    }

    options.onAttempt?.(attempt, maxAttempts, lastSession, lastError);
    if (lastSession?.status === 'resolved') {
      if (lastSession.resolvedReason === 'completed') {
        return {
          status: 'consensus',
          attempts: attempt,
          session: lastSession,
          lastError: null,
        };
      }
      return {
        status: 'terminal',
        attempts: attempt,
        session: lastSession,
        lastError,
      };
    }
    if (attempt < maxAttempts) {
      await options.wait(retryIntervalMs);
    }
  }

  return {
    status: 'grace_expired',
    attempts: maxAttempts,
    session: lastSession,
    lastError,
  };
}
