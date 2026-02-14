export type RankedOutcome = 'p1_win' | 'p2_win' | 'draw' | 'forfeit';

export interface RankedParticipant {
  accountId: string;
  side: 'P1' | 'P2';
  rating: number;
}

export interface RankedRatingUpdate {
  accountId: string;
  side: 'P1' | 'P2';
  preRating: number;
  postRating: number;
  delta: number;
  result: 'win' | 'loss' | 'draw' | 'forfeit';
}

export interface ApplyRankedRatingArgs {
  participants: [RankedParticipant, RankedParticipant];
  outcome: RankedOutcome;
  winnerAccountId: string | null;
  kFactor?: number;
}

export interface RankedRatingResult {
  updates: [RankedRatingUpdate, RankedRatingUpdate];
}

function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + (10 ** ((opponentRating - playerRating) / 400)));
}

function resolveActualScores(
  participants: [RankedParticipant, RankedParticipant],
  outcome: RankedOutcome,
  winnerAccountId: string | null,
): [number, number] {
  if (outcome === 'draw') {
    return [0.5, 0.5];
  }
  if (outcome === 'p1_win') {
    return [1, 0];
  }
  if (outcome === 'p2_win') {
    return [0, 1];
  }
  if (!winnerAccountId) {
    throw new Error('winnerAccountId is required for forfeit outcomes.');
  }
  if (winnerAccountId === participants[0].accountId) {
    return [1, 0];
  }
  if (winnerAccountId === participants[1].accountId) {
    return [0, 1];
  }
  throw new Error('winnerAccountId must match one of the ranked participants.');
}

function mapResultLabel(
  participant: RankedParticipant,
  actualScore: number,
  outcome: RankedOutcome,
  winnerAccountId: string | null,
): 'win' | 'loss' | 'draw' | 'forfeit' {
  if (outcome === 'draw') {
    return 'draw';
  }
  if (outcome === 'forfeit' && winnerAccountId && participant.accountId !== winnerAccountId) {
    return 'forfeit';
  }
  return actualScore === 1 ? 'win' : 'loss';
}

export function applyRankedRatingUpdate(args: ApplyRankedRatingArgs): RankedRatingResult {
  const kFactor = Number.isFinite(args.kFactor) && Number(args.kFactor) > 0 ? Math.floor(Number(args.kFactor)) : 32;
  const [p1, p2] = args.participants;

  const expectedP1 = expectedScore(p1.rating, p2.rating);
  const expectedP2 = expectedScore(p2.rating, p1.rating);
  const [actualP1, actualP2] = resolveActualScores(args.participants, args.outcome, args.winnerAccountId);

  const p1Delta = Math.round(kFactor * (actualP1 - expectedP1));
  const p2Delta = Math.round(kFactor * (actualP2 - expectedP2));

  const p1Post = p1.rating + p1Delta;
  const p2Post = p2.rating + p2Delta;

  return {
    updates: [
      {
        accountId: p1.accountId,
        side: p1.side,
        preRating: p1.rating,
        postRating: p1Post,
        delta: p1Delta,
        result: mapResultLabel(p1, actualP1, args.outcome, args.winnerAccountId),
      },
      {
        accountId: p2.accountId,
        side: p2.side,
        preRating: p2.rating,
        postRating: p2Post,
        delta: p2Delta,
        result: mapResultLabel(p2, actualP2, args.outcome, args.winnerAccountId),
      },
    ],
  };
}
