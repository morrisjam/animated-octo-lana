import type { ReplayBlobStore } from './blobStore';

export interface ReplayRetentionDatabase {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
}

export interface ReplayRetentionPruneResult {
  selected: number;
  deleted: number;
}

export async function pruneExpiredReplayArchives(
  database: ReplayRetentionDatabase,
  blobStore: Pick<ReplayBlobStore, 'deleteReplayPayload'>,
  batchSize = 100,
): Promise<ReplayRetentionPruneResult> {
  const limit = Math.min(1_000, Math.max(1, Math.floor(batchSize)));
  const expired = await database.query<{ replay_id: string; storage_key: string }>(
    `
      SELECT replay_id, storage_key
      FROM replays
      WHERE retention_until <= NOW()
      ORDER BY retention_until ASC, replay_id ASC
      LIMIT $1
    `,
    [limit],
  );
  let deleted = 0;
  for (const replay of expired.rows) {
    await blobStore.deleteReplayPayload(replay.storage_key);
    const result = await database.query(
      'DELETE FROM replays WHERE replay_id = $1 AND retention_until <= NOW()',
      [replay.replay_id],
    );
    deleted += result.rowCount ?? 0;
  }
  return { selected: expired.rows.length, deleted };
}
