import type { MatchSessionView } from '../matchmaking/queueService';
import {
  RANKED_SESSION_TRANSACTION_LOCK_SQL,
  type EnqueueRankedTerminalDecisionInput,
} from './terminalDecisionStore';
import {
  settleRankedMatch,
  type RankedSettlementConfig,
  type RankedSettlementParticipant,
} from './settlementService';

interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

interface ReleasableQueryable extends Queryable {
  release: () => void;
}

interface Connectable {
  connect: () => Promise<ReleasableQueryable>;
}

export interface RankedAuthoritativeResolutionCandidate {
  sessionId: string;
  matchId: string;
  reason: 'reconnect_timeout' | 'peer_left';
  forfeitingAccountId: string;
  winnerAccountId: string;
  participants: [RankedSettlementParticipant, RankedSettlementParticipant];
  resolvedAt: string;
  metadata: Record<string, unknown>;
}

export interface RankedAuthoritativeResolutionResult {
  resolutionId: string;
  status: 'settled' | 'superseded';
}

export function deriveRankedTerminalDecision(
  session: MatchSessionView,
): EnqueueRankedTerminalDecisionInput | null {
  if (
    session.queueType !== 'ranked'
    || session.status !== 'resolved'
    || !session.resolvedAt
  ) {
    return null;
  }
  const p1 = session.participants.find((participant) => participant.side === 'P1');
  const p2 = session.participants.find((participant) => participant.side === 'P2');
  if (!p1 || !p2 || p1.accountId === p2.accountId) {
    return null;
  }
  const common = {
    sessionId: session.sessionId,
    participantP1AccountId: p1.accountId,
    participantP2AccountId: p2.accountId,
    dueAt: session.resolvedAt,
    decidedAt: session.resolvedAt,
  };
  if (session.resolvedReason === 'session_expired') {
    return {
      ...common,
      decisionType: 'no_contest',
      reason: 'session_expired',
      winnerAccountId: null,
      forfeitingAccountId: null,
    };
  }
  if (session.resolvedReason !== 'reconnect_timeout' && session.resolvedReason !== 'peer_left') {
    return null;
  }
  if (!session.forfeitingAccountId) {
    return session.resolvedReason === 'reconnect_timeout'
      ? {
        ...common,
        decisionType: 'no_contest',
        reason: 'reconnect_timeout',
        winnerAccountId: null,
        forfeitingAccountId: null,
      }
      : null;
  }
  const forfeitingParticipant = session.participants.find(
    (participant) => participant.accountId === session.forfeitingAccountId,
  );
  if (!forfeitingParticipant) {
    return null;
  }
  const winner = forfeitingParticipant.side === 'P1' ? p2 : p1;
  return {
    ...common,
    decisionType: 'forfeit',
    reason: session.resolvedReason,
    winnerAccountId: winner.accountId,
    forfeitingAccountId: forfeitingParticipant.accountId,
  };
}

export function deriveRankedAuthoritativeResolution(
  session: MatchSessionView,
): RankedAuthoritativeResolutionCandidate | null {
  if (
    session.queueType !== 'ranked'
    || session.status !== 'resolved'
    || (session.resolvedReason !== 'reconnect_timeout' && session.resolvedReason !== 'peer_left')
    || !session.resolvedAt
    || !session.forfeitingAccountId
  ) {
    return null;
  }
  const p1 = session.participants.find((participant) => participant.side === 'P1');
  const p2 = session.participants.find((participant) => participant.side === 'P2');
  if (!p1 || !p2 || p1.accountId === p2.accountId) {
    return null;
  }
  const forfeitingParticipant = session.participants.find(
    (participant) => participant.accountId === session.forfeitingAccountId,
  );
  if (!forfeitingParticipant) {
    return null;
  }
  const winner = forfeitingParticipant.side === 'P1' ? p2 : p1;

  return {
    sessionId: session.sessionId,
    matchId: session.sessionId,
    reason: session.resolvedReason,
    forfeitingAccountId: forfeitingParticipant.accountId,
    winnerAccountId: winner.accountId,
    participants: [
      { accountId: p1.accountId, side: 'P1' },
      { accountId: p2.accountId, side: 'P2' },
    ],
    resolvedAt: session.resolvedAt,
    metadata: {
      buildVersion: session.buildVersion,
      rulesetVersion: session.rulesetVersion,
      balanceProfileId: session.balanceProfileId,
      region: session.region,
      reconnectGraceSeconds: session.reconnectGraceSeconds,
    },
  };
}

export async function processRankedAuthoritativeResolution(
  database: Connectable,
  candidate: RankedAuthoritativeResolutionCandidate,
  config: RankedSettlementConfig,
): Promise<RankedAuthoritativeResolutionResult> {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(RANKED_SESSION_TRANSACTION_LOCK_SQL, [candidate.sessionId]);
    const resolutionResult = await client.query(
      `
      INSERT INTO ranked_authoritative_resolutions(
        session_id, match_id, reason, forfeiting_account_id, winner_account_id,
        participant_p1_account_id, participant_p2_account_id, resolved_at, metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (session_id)
      DO UPDATE SET updated_at = NOW()
      RETURNING
        resolution_id, status, match_id, reason, forfeiting_account_id, winner_account_id,
        participant_p1_account_id, participant_p2_account_id
      `,
      [
        candidate.sessionId,
        candidate.matchId,
        candidate.reason,
        candidate.forfeitingAccountId,
        candidate.winnerAccountId,
        candidate.participants[0].accountId,
        candidate.participants[1].accountId,
        candidate.resolvedAt,
        JSON.stringify(candidate.metadata),
      ],
    );
    const resolution = resolutionResult.rows[0] as {
      resolution_id: string;
      status: 'pending' | 'settled' | 'superseded';
      match_id: string;
      reason: 'reconnect_timeout' | 'peer_left';
      forfeiting_account_id: string;
      winner_account_id: string;
      participant_p1_account_id: string;
      participant_p2_account_id: string;
    };
    if (!resolution?.resolution_id) {
      throw new Error('Failed to create authoritative ranked resolution.');
    }
    if (
      resolution.match_id !== candidate.matchId
      || resolution.reason !== candidate.reason
      || resolution.forfeiting_account_id !== candidate.forfeitingAccountId
      || resolution.winner_account_id !== candidate.winnerAccountId
      || resolution.participant_p1_account_id !== candidate.participants[0].accountId
      || resolution.participant_p2_account_id !== candidate.participants[1].accountId
    ) {
      throw new Error('Authoritative ranked resolution retry does not match the persisted decision.');
    }

    const existingMatch = await client.query(
      `
      SELECT authoritative_resolution_id
      FROM ranked_matches
      WHERE session_id = $1
      LIMIT 1
      `,
      [candidate.sessionId],
    );
    if (existingMatch.rowCount) {
      const existingResolutionId = (existingMatch.rows[0] as { authoritative_resolution_id?: string | null })
        .authoritative_resolution_id ?? null;
      const status = existingResolutionId === resolution.resolution_id ? 'settled' : 'superseded';
      await client.query(
        `
        UPDATE ranked_authoritative_resolutions
        SET status = $2, processed_at = COALESCE(processed_at, NOW()), updated_at = NOW()
        WHERE resolution_id = $1
        `,
        [resolution.resolution_id, status],
      );
      await client.query('COMMIT');
      return { resolutionId: resolution.resolution_id, status };
    }
    if (resolution.status === 'superseded') {
      await client.query('COMMIT');
      return { resolutionId: resolution.resolution_id, status: 'superseded' };
    }

    await settleRankedMatch(client, {
      matchId: candidate.matchId,
      sessionId: candidate.sessionId,
      participants: candidate.participants,
      outcome: 'forfeit',
      winnerAccountId: candidate.winnerAccountId,
      occurredAtIso: candidate.resolvedAt,
      source: {
        kind: 'server_authoritative',
        resolutionId: resolution.resolution_id,
      },
      config,
    });
    await client.query(
      `
      UPDATE ranked_authoritative_resolutions
      SET status = 'settled', processed_at = NOW(), updated_at = NOW()
      WHERE resolution_id = $1
      `,
      [resolution.resolution_id],
    );
    await client.query('COMMIT');
    return { resolutionId: resolution.resolution_id, status: 'settled' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
