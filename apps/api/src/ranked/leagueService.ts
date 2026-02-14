export const LEAGUE_TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum'] as const;
export type LeagueTier = (typeof LEAGUE_TIERS)[number];

export interface LeagueProgressionState {
  leagueTier: LeagueTier | null;
  leaguePoints: number | null;
  calibrationMatchesRequired: number;
  calibrationMatchesPlayed: number;
  placedAt: string | null;
}

export interface ApplyLeagueProgressionArgs {
  state: LeagueProgressionState;
  postRating: number;
  ratingDelta: number;
  occurredAtIso: string;
}

export interface LeagueProgressionResult {
  pre: LeagueProgressionState;
  post: LeagueProgressionState;
  provisional: boolean;
}

const LEAGUE_POINT_WINDOW = 100;

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function tierIndex(tier: LeagueTier): number {
  return LEAGUE_TIERS.indexOf(tier);
}

function normaliseState(state: LeagueProgressionState): LeagueProgressionState {
  const required = clampInteger(state.calibrationMatchesRequired, 1, 20);
  const played = clampInteger(state.calibrationMatchesPlayed, 0, required);
  return {
    leagueTier: state.leagueTier,
    leaguePoints: state.leaguePoints === null ? null : clampInteger(state.leaguePoints, 0, LEAGUE_POINT_WINDOW - 1),
    calibrationMatchesRequired: required,
    calibrationMatchesPlayed: played,
    placedAt: state.placedAt,
  };
}

export function leagueTierFromRating(rating: number): LeagueTier {
  if (rating >= 1800) {
    return 'Platinum';
  }
  if (rating >= 1600) {
    return 'Gold';
  }
  if (rating >= 1400) {
    return 'Silver';
  }
  if (rating >= 1200) {
    return 'Bronze';
  }
  return 'Iron';
}

function leaguePointsFromRating(rating: number, tier: LeagueTier): number {
  const floorByTier: Record<LeagueTier, number> = {
    Iron: 1000,
    Bronze: 1200,
    Silver: 1400,
    Gold: 1600,
    Platinum: 1800,
  };
  return clampInteger(rating - floorByTier[tier], 0, LEAGUE_POINT_WINDOW - 1);
}

function applyPromotionDemotion(
  tier: LeagueTier,
  points: number,
): { tier: LeagueTier; points: number } {
  let currentTier = tier;
  let currentPoints = points;

  while (currentPoints >= LEAGUE_POINT_WINDOW && currentTier !== 'Platinum') {
    currentPoints -= LEAGUE_POINT_WINDOW;
    currentTier = LEAGUE_TIERS[tierIndex(currentTier) + 1];
  }
  while (currentPoints < 0 && currentTier !== 'Iron') {
    currentPoints += LEAGUE_POINT_WINDOW;
    currentTier = LEAGUE_TIERS[tierIndex(currentTier) - 1];
  }
  if (currentTier === 'Iron' && currentPoints < 0) {
    currentPoints = 0;
  }
  if (currentTier === 'Platinum' && currentPoints >= LEAGUE_POINT_WINDOW) {
    currentPoints = LEAGUE_POINT_WINDOW - 1;
  }
  return {
    tier: currentTier,
    points: clampInteger(currentPoints, 0, LEAGUE_POINT_WINDOW - 1),
  };
}

export function applyLeagueProgression(args: ApplyLeagueProgressionArgs): LeagueProgressionResult {
  const pre = normaliseState(args.state);
  const post: LeagueProgressionState = {
    ...pre,
  };

  if (!pre.placedAt) {
    post.calibrationMatchesPlayed = clampInteger(pre.calibrationMatchesPlayed + 1, 0, pre.calibrationMatchesRequired);
    if (post.calibrationMatchesPlayed >= post.calibrationMatchesRequired) {
      const placedTier = leagueTierFromRating(args.postRating);
      post.leagueTier = placedTier;
      post.leaguePoints = leaguePointsFromRating(args.postRating, placedTier);
      post.placedAt = args.occurredAtIso;
    }
    return {
      pre,
      post,
      provisional: true,
    };
  }

  const currentTier = pre.leagueTier ?? 'Iron';
  const currentPoints = pre.leaguePoints ?? 0;
  const next = applyPromotionDemotion(currentTier, currentPoints + args.ratingDelta);
  post.leagueTier = next.tier;
  post.leaguePoints = next.points;

  return {
    pre,
    post,
    provisional: false,
  };
}
