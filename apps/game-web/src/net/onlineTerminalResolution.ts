export type OnlineSessionResolvedReason =
  | 'session_expired'
  | 'reconnect_timeout'
  | 'peer_left'
  | 'completed';

export interface OnlineTerminalSessionView {
  status: 'active' | 'resolved';
  resolvedReason?: OnlineSessionResolvedReason;
  forfeitingAccountId?: string;
}

export type OnlineTerminalResolutionKind =
  | 'transport_interrupted'
  | 'casual_session_ended'
  | 'ranked_forfeit_win'
  | 'ranked_forfeit_loss'
  | 'ranked_no_contest'
  | 'ranked_completion_pending';

export type RankedRatingDisposition =
  | 'not_applicable'
  | 'unchanged'
  | 'authoritative_settlement_pending'
  | 'proof_settlement_pending';

export interface OnlineTerminalResolution {
  kind: OnlineTerminalResolutionKind;
  title: string;
  outcomeLine: string;
  winnerAccountId: string | null;
  ratingDisposition: RankedRatingDisposition;
  shouldPollRankedResult: boolean;
}

export interface ResolveOnlineTerminalResolutionArgs {
  queueType: 'ranked' | 'unranked';
  localAccountId: string;
  remoteAccountId: string;
  session: OnlineTerminalSessionView | null;
}

export interface PollOnlineTerminalSessionOptions<T extends OnlineTerminalSessionView> {
  read(): Promise<T>;
  maxAttempts: number;
  retryIntervalMs: number;
  wait(milliseconds: number): Promise<void>;
  onAttempt?(attempt: number, maxAttempts: number, session: T | null, error: unknown): void;
}

export type PollOnlineTerminalSessionResult<T extends OnlineTerminalSessionView> =
  | {
    status: 'resolved';
    attempts: number;
    session: T;
    lastError: null;
  }
  | {
    status: 'grace_expired';
    attempts: number;
    session: T | null;
    lastError: unknown;
  };

export async function pollOnlineTerminalSession<T extends OnlineTerminalSessionView>(
  options: PollOnlineTerminalSessionOptions<T>,
): Promise<PollOnlineTerminalSessionResult<T>> {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts <= 0) {
    throw new Error('maxAttempts must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(options.retryIntervalMs) || options.retryIntervalMs <= 0) {
    throw new Error('retryIntervalMs must be a positive safe integer.');
  }
  let lastSession: T | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      lastSession = await options.read();
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    options.onAttempt?.(attempt, options.maxAttempts, lastSession, lastError);
    if (lastSession?.status === 'resolved') {
      return {
        status: 'resolved',
        attempts: attempt,
        session: lastSession,
        lastError: null,
      };
    }
    if (attempt < options.maxAttempts) {
      await options.wait(options.retryIntervalMs);
    }
  }
  return {
    status: 'grace_expired',
    attempts: options.maxAttempts,
    session: lastSession,
    lastError,
  };
}

function formatResolvedReason(reason: OnlineSessionResolvedReason | undefined): string {
  switch (reason) {
    case 'session_expired':
      return 'the session expired';
    case 'reconnect_timeout':
      return 'the reconnect window expired';
    case 'peer_left':
      return 'a player left the session';
    case 'completed':
      return 'the session completed';
    default:
      return 'the server ended the session';
  }
}

export function resolveOnlineTerminalResolution(
  args: ResolveOnlineTerminalResolutionArgs,
): OnlineTerminalResolution {
  if (!args.session || args.session.status !== 'resolved') {
    return {
      kind: 'transport_interrupted',
      title: 'Online Session Interrupted',
      outcomeLine: 'The server has not reported a terminal match outcome.',
      winnerAccountId: null,
      ratingDisposition: args.queueType === 'ranked' ? 'proof_settlement_pending' : 'not_applicable',
      shouldPollRankedResult: false,
    };
  }

  if (args.queueType !== 'ranked') {
    return {
      kind: 'casual_session_ended',
      title: 'Online Session Ended',
      outcomeLine: `Casual match ended because ${formatResolvedReason(args.session.resolvedReason)}.`,
      winnerAccountId: null,
      ratingDisposition: 'not_applicable',
      shouldPollRankedResult: false,
    };
  }

  const forfeitingAccountId = args.session.forfeitingAccountId;
  if (
    forfeitingAccountId === args.localAccountId
    || forfeitingAccountId === args.remoteAccountId
  ) {
    const localForfeited = forfeitingAccountId === args.localAccountId;
    return {
      kind: localForfeited ? 'ranked_forfeit_loss' : 'ranked_forfeit_win',
      title: localForfeited ? 'Ranked Defeat by Forfeit' : 'Ranked Victory by Forfeit',
      outcomeLine: localForfeited
        ? 'The server attributed the disconnect or departure to this client.'
        : 'The server attributed the disconnect or departure to your opponent.',
      winnerAccountId: localForfeited ? args.remoteAccountId : args.localAccountId,
      ratingDisposition: 'authoritative_settlement_pending',
      shouldPollRankedResult: true,
    };
  }

  if (args.session.resolvedReason === 'completed') {
    return {
      kind: 'ranked_completion_pending',
      title: 'Ranked Result Pending',
      outcomeLine: 'The session completed; deterministic result verification is still being reconciled.',
      winnerAccountId: null,
      ratingDisposition: 'proof_settlement_pending',
      shouldPollRankedResult: true,
    };
  }

  return {
    kind: 'ranked_no_contest',
    title: 'Ranked Match No Contest',
    outcomeLine: `The match ended because ${formatResolvedReason(args.session.resolvedReason)}, without one attributable forfeiter.`,
    winnerAccountId: null,
    ratingDisposition: 'unchanged',
    shouldPollRankedResult: false,
  };
}
