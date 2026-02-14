export interface MasterRatingState {
  mrPoints: number | null;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  enteredAt: string | null;
}

export interface ApplyMasterRatingArgs {
  state: MasterRatingState;
  postRating: number;
  ratingDelta: number;
  result: 'win' | 'loss' | 'draw' | 'forfeit';
  occurredAtIso: string;
  entryRatingThreshold: number;
  basePoints: number;
  queueWeight: number;
}

export interface MasterRatingResult {
  pre: MasterRatingState;
  post: MasterRatingState;
  enteredMasterTrack: boolean;
}

function clampInteger(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.floor(value));
}

function normaliseState(state: MasterRatingState): MasterRatingState {
  return {
    mrPoints: state.mrPoints === null ? null : clampInteger(state.mrPoints, 0),
    matchesPlayed: clampInteger(state.matchesPlayed, 0),
    wins: clampInteger(state.wins, 0),
    losses: clampInteger(state.losses, 0),
    draws: clampInteger(state.draws, 0),
    forfeits: clampInteger(state.forfeits, 0),
    enteredAt: state.enteredAt,
  };
}

function baseResultDelta(result: 'win' | 'loss' | 'draw' | 'forfeit'): number {
  switch (result) {
    case 'win':
      return 10;
    case 'draw':
      return 0;
    case 'forfeit':
      return -15;
    case 'loss':
    default:
      return -10;
  }
}

export function applyMasterRatingProgression(args: ApplyMasterRatingArgs): MasterRatingResult {
  const weight = Number.isFinite(args.queueWeight) && args.queueWeight > 0 ? args.queueWeight : 1;
  const pre = normaliseState(args.state);
  const post: MasterRatingState = {
    ...pre,
  };

  const alreadyInTrack = pre.enteredAt !== null;
  const entersNow = !alreadyInTrack && args.postRating >= args.entryRatingThreshold;
  if (!alreadyInTrack && !entersNow) {
    return {
      pre,
      post,
      enteredMasterTrack: false,
    };
  }

  if (entersNow) {
    post.enteredAt = args.occurredAtIso;
    post.mrPoints = args.basePoints;
  }

  const prePoints = post.mrPoints ?? args.basePoints;
  const momentum = Math.round(args.ratingDelta * 0.25);
  const rawDelta = baseResultDelta(args.result) + momentum;
  const weightedDelta = Math.round(rawDelta * weight);
  post.mrPoints = Math.max(0, prePoints + weightedDelta);
  post.matchesPlayed += 1;
  if (args.result === 'win') {
    post.wins += 1;
  } else if (args.result === 'draw') {
    post.draws += 1;
  } else if (args.result === 'forfeit') {
    post.forfeits += 1;
    post.losses += 1;
  } else {
    post.losses += 1;
  }

  return {
    pre,
    post,
    enteredMasterTrack: entersNow,
  };
}
