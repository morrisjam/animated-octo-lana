import { detectRankedAnomalies } from './anomalyDetection';
import { applyLeagueProgression, type LeagueTier } from './leagueService';
import { applyMasterRatingProgression } from './masterRatingService';
import { applyRankedRatingUpdate, type RankedOutcome } from './ratingService';
import { ensureActiveSeasonForSettlement } from './seasonService';

interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface RankedSettlementParticipant {
  accountId: string;
  side: 'P1' | 'P2';
}

export type RankedSettlementSource =
  | { kind: 'player_consensus'; submissionId: string }
  | { kind: 'server_authoritative'; resolutionId: string };

export interface RankedSettlementConfig {
  seasonDurationDays: number;
  calibrationMatchesRequired: number;
  masterEntryRating: number;
  masterBasePoints: number;
  masterQueueWeight: number;
  anomalyMinMatchIntervalSeconds: number;
  anomalyRatingJumpThreshold: number;
  anomalyMrJumpThreshold: number;
}

export interface RankedSettlementDeltaView {
  accountId: string;
  side: 'P1' | 'P2';
  preRating: number;
  postRating: number;
  ratingDelta: number;
  result: 'win' | 'loss' | 'draw' | 'forfeit';
  preLeagueTier: LeagueTier | null;
  postLeagueTier: LeagueTier | null;
  preLeaguePoints: number | null;
  postLeaguePoints: number | null;
  provisional: boolean;
  preMrPoints: number | null;
  postMrPoints: number | null;
  enteredMasterTrack: boolean;
}

export interface SettleRankedMatchArgs {
  matchId: string;
  sessionId: string;
  participants: [RankedSettlementParticipant, RankedSettlementParticipant];
  outcome: RankedOutcome;
  winnerAccountId: string | null;
  occurredAtIso: string;
  source: RankedSettlementSource;
  config: RankedSettlementConfig;
}

export interface RankedSettlementResult {
  seasonId: string;
  ratingDeltas: RankedSettlementDeltaView[];
}

export function assertRankedSettlementPolicy(
  args: Pick<SettleRankedMatchArgs, 'participants' | 'outcome' | 'winnerAccountId' | 'source'>,
): void {
  const [p1Participant, p2Participant] = args.participants;
  if (p1Participant.side !== 'P1' || p2Participant.side !== 'P2') {
    throw new Error('Ranked settlement participants must be ordered as P1 then P2.');
  }
  if (!p1Participant.accountId || p1Participant.accountId === p2Participant.accountId) {
    throw new Error('Ranked settlement requires two distinct participant accounts.');
  }
  if (args.source.kind === 'player_consensus' && args.outcome !== 'p1_win' && args.outcome !== 'p2_win') {
    throw new Error('Player-consensus settlement requires a proof-replayed P1 or P2 win; draws are no-contest.');
  }
  if (args.source.kind === 'server_authoritative' && args.outcome !== 'forfeit') {
    throw new Error('Server-authoritative settlement is reserved for attributed forfeits.');
  }
  const expectedWinnerAccountId = args.outcome === 'p1_win'
    ? p1Participant.accountId
    : args.outcome === 'p2_win'
      ? p2Participant.accountId
      : null;
  if (expectedWinnerAccountId && args.winnerAccountId !== expectedWinnerAccountId) {
    throw new Error(`Ranked ${args.outcome} winner does not match the corresponding participant.`);
  }
  if (args.outcome === 'forfeit') {
    if (
      args.winnerAccountId !== p1Participant.accountId
      && args.winnerAccountId !== p2Participant.accountId
    ) {
      throw new Error('Ranked forfeit winner must be one of the session participants.');
    }
  } else if (args.outcome === 'draw' && args.winnerAccountId !== null) {
    throw new Error('Ranked draw cannot name a winner.');
  }
}

interface LeagueProgressionRow {
  account_id: string;
  league_tier: LeagueTier | null;
  league_points: number | null;
  calibration_matches_required: number;
  calibration_matches_played: number;
  placed_at: string | null;
}

interface MasterRatingRow {
  account_id: string;
  mr_points: number;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  entered_at: string;
}

export async function settleRankedMatch(
  client: Queryable,
  args: SettleRankedMatchArgs,
): Promise<RankedSettlementResult> {
  assertRankedSettlementPolicy(args);
  const [p1Participant, p2Participant] = args.participants;
  const participantAccountIds = [p1Participant.accountId, p2Participant.accountId];
  const activeSeason = await ensureActiveSeasonForSettlement(
    client,
    new Date(),
    args.config.seasonDurationDays,
  );

  await client.query(
    `
    INSERT INTO ranked_player_ratings(account_id)
    VALUES ($1), ($2)
    ON CONFLICT (account_id) DO NOTHING
    `,
    participantAccountIds,
  );
  const ratingRows = await client.query(
    `
    SELECT account_id, rating
    FROM ranked_player_ratings
    WHERE account_id = ANY($1::uuid[])
    FOR UPDATE
    `,
    [participantAccountIds],
  );
  const ratingByAccount = new Map<string, number>();
  for (const rawRow of ratingRows.rows as Array<{ account_id: string; rating: number }>) {
    ratingByAccount.set(rawRow.account_id, Number(rawRow.rating));
  }
  const p1Rating = ratingByAccount.get(p1Participant.accountId);
  const p2Rating = ratingByAccount.get(p2Participant.accountId);
  if (!Number.isFinite(p1Rating) || !Number.isFinite(p2Rating)) {
    throw new Error('Failed to resolve ranked ratings for session participants.');
  }

  await client.query(
    `
    INSERT INTO ranked_league_progression(account_id, calibration_matches_required)
    VALUES ($1, $3), ($2, $3)
    ON CONFLICT (account_id) DO NOTHING
    `,
    [p1Participant.accountId, p2Participant.accountId, args.config.calibrationMatchesRequired],
  );
  const leagueRows = await client.query(
    `
    SELECT
      account_id,
      league_tier,
      league_points,
      calibration_matches_required,
      calibration_matches_played,
      placed_at
    FROM ranked_league_progression
    WHERE account_id = ANY($1::uuid[])
    FOR UPDATE
    `,
    [participantAccountIds],
  );
  const leagueStateByAccount = new Map<string, {
    leagueTier: LeagueTier | null;
    leaguePoints: number | null;
    calibrationMatchesRequired: number;
    calibrationMatchesPlayed: number;
    placedAt: string | null;
  }>();
  for (const rawRow of leagueRows.rows as LeagueProgressionRow[]) {
    leagueStateByAccount.set(rawRow.account_id, {
      leagueTier: rawRow.league_tier,
      leaguePoints: rawRow.league_points,
      calibrationMatchesRequired: Number(rawRow.calibration_matches_required),
      calibrationMatchesPlayed: Number(rawRow.calibration_matches_played),
      placedAt: rawRow.placed_at,
    });
  }

  const masterRows = await client.query(
    `
    SELECT
      account_id,
      mr_points,
      matches_played,
      wins,
      losses,
      draws,
      forfeits,
      entered_at
    FROM ranked_master_ratings
    WHERE season_id = $1
      AND account_id = ANY($2::uuid[])
    FOR UPDATE
    `,
    [activeSeason.seasonId, participantAccountIds],
  );
  const masterStateByAccount = new Map<string, {
    mrPoints: number | null;
    matchesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    forfeits: number;
    enteredAt: string | null;
  }>();
  for (const rawRow of masterRows.rows as MasterRatingRow[]) {
    masterStateByAccount.set(rawRow.account_id, {
      mrPoints: Number(rawRow.mr_points),
      matchesPlayed: Number(rawRow.matches_played),
      wins: Number(rawRow.wins),
      losses: Number(rawRow.losses),
      draws: Number(rawRow.draws),
      forfeits: Number(rawRow.forfeits),
      enteredAt: rawRow.entered_at,
    });
  }
  const previousMatchRows = await client.query(
    `
    SELECT account_id, MAX(created_at) AS previous_match_at
    FROM ranked_match_rating_deltas
    WHERE account_id = ANY($1::uuid[])
    GROUP BY account_id
    `,
    [participantAccountIds],
  );
  const previousMatchAtByAccount = new Map<string, string | null>();
  for (const rawRow of previousMatchRows.rows as Array<{ account_id: string; previous_match_at: string | null }>) {
    previousMatchAtByAccount.set(rawRow.account_id, rawRow.previous_match_at);
  }

  const ratingResult = applyRankedRatingUpdate({
    participants: [
      { accountId: p1Participant.accountId, side: 'P1', rating: p1Rating as number },
      { accountId: p2Participant.accountId, side: 'P2', rating: p2Rating as number },
    ],
    outcome: args.outcome,
    winnerAccountId: args.winnerAccountId,
  });
  const processedSubmissionId = args.source.kind === 'player_consensus'
    ? args.source.submissionId
    : null;
  const authoritativeResolutionId = args.source.kind === 'server_authoritative'
    ? args.source.resolutionId
    : null;
  await client.query(
    `
    INSERT INTO ranked_matches(
      match_id, session_id, season_id, queue_type, outcome, winner_account_id,
      processed_submission_id, authoritative_resolution_id, settlement_source,
      participant_p1_account_id, participant_p2_account_id
    )
    VALUES ($1, $2, $3, 'ranked', $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      args.matchId,
      args.sessionId,
      activeSeason.seasonId,
      args.outcome,
      args.winnerAccountId,
      processedSubmissionId,
      authoritativeResolutionId,
      args.source.kind,
      p1Participant.accountId,
      p2Participant.accountId,
    ],
  );

  const ratingDeltas: RankedSettlementDeltaView[] = [];
  for (const update of ratingResult.updates) {
    const currentLeagueState = leagueStateByAccount.get(update.accountId) ?? {
      leagueTier: null,
      leaguePoints: null,
      calibrationMatchesRequired: args.config.calibrationMatchesRequired,
      calibrationMatchesPlayed: 0,
      placedAt: null,
    };
    const leagueProgress = applyLeagueProgression({
      state: currentLeagueState,
      postRating: update.postRating,
      ratingDelta: update.delta,
      occurredAtIso: args.occurredAtIso,
    });
    leagueStateByAccount.set(update.accountId, leagueProgress.post);

    const currentMasterState = masterStateByAccount.get(update.accountId) ?? {
      mrPoints: null,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      forfeits: 0,
      enteredAt: null,
    };
    const masterProgress = applyMasterRatingProgression({
      state: currentMasterState,
      postRating: update.postRating,
      ratingDelta: update.delta,
      result: update.result,
      occurredAtIso: args.occurredAtIso,
      entryRatingThreshold: args.config.masterEntryRating,
      basePoints: args.config.masterBasePoints,
      queueWeight: args.config.masterQueueWeight,
    });
    masterStateByAccount.set(update.accountId, masterProgress.post);
    const mrDelta = masterProgress.pre.mrPoints !== null && masterProgress.post.mrPoints !== null
      ? masterProgress.post.mrPoints - masterProgress.pre.mrPoints
      : null;
    const anomalyAlerts = detectRankedAnomalies({
      occurredAtIso: args.occurredAtIso,
      previousMatchAtIso: previousMatchAtByAccount.get(update.accountId) ?? null,
      ratingDelta: update.delta,
      mrDelta,
      minMatchIntervalSeconds: args.config.anomalyMinMatchIntervalSeconds,
      ratingJumpThreshold: args.config.anomalyRatingJumpThreshold,
      mrJumpThreshold: args.config.anomalyMrJumpThreshold,
    });

    await client.query(
      `
      INSERT INTO ranked_match_rating_deltas(
        match_id, account_id, side, pre_rating, post_rating, rating_delta, result,
        pre_league_tier, post_league_tier, pre_league_points, post_league_points,
        pre_mr_points, post_mr_points
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        args.matchId,
        update.accountId,
        update.side,
        update.preRating,
        update.postRating,
        update.delta,
        update.result,
        leagueProgress.pre.leagueTier,
        leagueProgress.post.leagueTier,
        leagueProgress.pre.leaguePoints,
        leagueProgress.post.leaguePoints,
        masterProgress.pre.mrPoints,
        masterProgress.post.mrPoints,
      ],
    );
    for (const alert of anomalyAlerts) {
      await client.query(
        `
        INSERT INTO ranked_anomaly_alerts(
          alert_type, severity, status, account_id, match_id, message, metadata, detected_at
        )
        VALUES ($1, $2, 'open', $3, $4, $5, $6::jsonb, $7)
        `,
        [
          alert.type,
          alert.severity,
          update.accountId,
          args.matchId,
          alert.message,
          JSON.stringify({
            ...alert.metadata,
            outcome: args.outcome,
            settlementSource: args.source.kind,
            side: update.side,
            result: update.result,
            preRating: update.preRating,
            postRating: update.postRating,
            ratingDelta: update.delta,
            preMrPoints: masterProgress.pre.mrPoints,
            postMrPoints: masterProgress.post.mrPoints,
          }),
          args.occurredAtIso,
        ],
      );
    }
    previousMatchAtByAccount.set(update.accountId, args.occurredAtIso);

    const isForfeitLoss = args.outcome === 'forfeit' && update.result === 'forfeit';
    await client.query(
      `
      UPDATE ranked_player_ratings
      SET
        rating = $2,
        matches_played = matches_played + 1,
        wins = wins + $3,
        losses = losses + $4,
        draws = draws + $5,
        forfeits = forfeits + $6,
        updated_at = NOW()
      WHERE account_id = $1
      `,
      [
        update.accountId,
        update.postRating,
        update.result === 'win' ? 1 : 0,
        update.result === 'loss' || isForfeitLoss ? 1 : 0,
        update.result === 'draw' ? 1 : 0,
        isForfeitLoss ? 1 : 0,
      ],
    );
    await client.query(
      `
      UPDATE ranked_league_progression
      SET
        league_tier = $2,
        league_points = $3,
        calibration_matches_required = $4,
        calibration_matches_played = $5,
        placed_at = $6,
        updated_at = NOW()
      WHERE account_id = $1
      `,
      [
        update.accountId,
        leagueProgress.post.leagueTier,
        leagueProgress.post.leaguePoints,
        leagueProgress.post.calibrationMatchesRequired,
        leagueProgress.post.calibrationMatchesPlayed,
        leagueProgress.post.placedAt,
      ],
    );
    if (masterProgress.post.enteredAt) {
      await client.query(
        `
        INSERT INTO ranked_master_ratings(
          season_id, account_id, mr_points, matches_played,
          wins, losses, draws, forfeits, entered_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (season_id, account_id)
        DO UPDATE SET
          mr_points = EXCLUDED.mr_points,
          matches_played = EXCLUDED.matches_played,
          wins = EXCLUDED.wins,
          losses = EXCLUDED.losses,
          draws = EXCLUDED.draws,
          forfeits = EXCLUDED.forfeits,
          entered_at = LEAST(ranked_master_ratings.entered_at, EXCLUDED.entered_at),
          updated_at = NOW()
        `,
        [
          activeSeason.seasonId,
          update.accountId,
          masterProgress.post.mrPoints,
          masterProgress.post.matchesPlayed,
          masterProgress.post.wins,
          masterProgress.post.losses,
          masterProgress.post.draws,
          masterProgress.post.forfeits,
          masterProgress.post.enteredAt,
        ],
      );
    }

    ratingDeltas.push({
      accountId: update.accountId,
      side: update.side,
      preRating: update.preRating,
      postRating: update.postRating,
      ratingDelta: update.delta,
      result: update.result,
      preLeagueTier: leagueProgress.pre.leagueTier,
      postLeagueTier: leagueProgress.post.leagueTier,
      preLeaguePoints: leagueProgress.pre.leaguePoints,
      postLeaguePoints: leagueProgress.post.leaguePoints,
      provisional: leagueProgress.provisional,
      preMrPoints: masterProgress.pre.mrPoints,
      postMrPoints: masterProgress.post.mrPoints,
      enteredMasterTrack: masterProgress.enteredMasterTrack,
    });
  }

  return {
    seasonId: activeSeason.seasonId,
    ratingDeltas,
  };
}
