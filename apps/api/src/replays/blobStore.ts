import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import type { Pool } from 'pg';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type ReplayBlobProvider = 'local' | 'postgres';

export interface ReplayBlobPutResult {
  storageKey: string;
  compressedBytes: number;
  sha256: string;
}

export interface ReplayBlobStore {
  readonly provider: ReplayBlobProvider;
  readonly durable: boolean;
  putReplayPayload(replayId: string, payload: unknown): Promise<ReplayBlobPutResult>;
  getReplayPayload(storageKey: string): Promise<unknown>;
  deleteReplayPayload(storageKey: string): Promise<void>;
}

export interface ReplayBlobStoreOptions {
  rootDirectory: string;
}

export interface PostgresReplayBlobStoreOptions {
  database: Pick<Pool, 'query'>;
}

export interface ReplayBlobStoreDependencies {
  database?: Pick<Pool, 'query'>;
}

interface EncodedReplayPayload {
  compressed: Buffer;
  compressedBytes: number;
  sha256: string;
}

async function encodeReplayPayload(payload: unknown): Promise<EncodedReplayPayload> {
  const jsonPayload = JSON.stringify(payload);
  const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf8'), { level: 6 });
  return {
    compressed,
    compressedBytes: compressed.byteLength,
    sha256: createHash('sha256').update(compressed).digest('hex'),
  };
}

async function decodeReplayPayload(compressed: Buffer | Uint8Array): Promise<unknown> {
  const decoded = await gunzipAsync(compressed);
  return JSON.parse(decoded.toString('utf8')) as unknown;
}

function replayBlobNotFound(storageKey: string): Error & { code: 'ENOENT' } {
  return Object.assign(new Error(`Replay payload blob not found: ${storageKey}`), { code: 'ENOENT' as const });
}

export class LocalReplayBlobStore implements ReplayBlobStore {
  public readonly provider = 'local' as const;
  public readonly durable = false;
  private readonly rootDirectory: string;

  public constructor(options: ReplayBlobStoreOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
  }

  public async putReplayPayload(replayId: string, payload: unknown): Promise<ReplayBlobPutResult> {
    await mkdir(this.rootDirectory, { recursive: true });
    const storageKey = `${replayId}.json.gz`;
    const filePath = path.join(this.rootDirectory, storageKey);
    const encoded = await encodeReplayPayload(payload);
    await writeFile(filePath, encoded.compressed);

    return {
      storageKey,
      compressedBytes: encoded.compressedBytes,
      sha256: encoded.sha256,
    };
  }

  public async getReplayPayload(storageKey: string): Promise<unknown> {
    const filePath = path.join(this.rootDirectory, storageKey);
    const compressed = await readFile(filePath);
    return await decodeReplayPayload(compressed);
  }

  public async deleteReplayPayload(storageKey: string): Promise<void> {
    const filePath = path.join(this.rootDirectory, storageKey);
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      const errorCode = (error as { code?: string } | undefined)?.code;
      if (errorCode !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export class PostgresReplayBlobStore implements ReplayBlobStore {
  public readonly provider = 'postgres' as const;
  public readonly durable = true;
  private readonly database: Pick<Pool, 'query'>;

  public constructor(options: PostgresReplayBlobStoreOptions) {
    this.database = options.database;
  }

  public async putReplayPayload(replayId: string, payload: unknown): Promise<ReplayBlobPutResult> {
    const storageKey = `${replayId}.json.gz`;
    const encoded = await encodeReplayPayload(payload);
    await this.database.query(
      `
        INSERT INTO replay_payload_blobs(storage_key, payload_gzip, compressed_bytes, sha256)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (storage_key)
        DO UPDATE SET
          payload_gzip = EXCLUDED.payload_gzip,
          compressed_bytes = EXCLUDED.compressed_bytes,
          sha256 = EXCLUDED.sha256,
          updated_at = NOW()
      `,
      [storageKey, encoded.compressed, encoded.compressedBytes, encoded.sha256],
    );
    return {
      storageKey,
      compressedBytes: encoded.compressedBytes,
      sha256: encoded.sha256,
    };
  }

  public async getReplayPayload(storageKey: string): Promise<unknown> {
    const result = await this.database.query<{ payload_gzip: Buffer }>(
      'SELECT payload_gzip FROM replay_payload_blobs WHERE storage_key = $1 LIMIT 1',
      [storageKey],
    );
    const compressed = result.rows[0]?.payload_gzip;
    if (!compressed) {
      throw replayBlobNotFound(storageKey);
    }
    return await decodeReplayPayload(compressed);
  }

  public async deleteReplayPayload(storageKey: string): Promise<void> {
    await this.database.query(
      'DELETE FROM replay_payload_blobs WHERE storage_key = $1',
      [storageKey],
    );
  }
}

export function createReplayBlobStoreFromEnv(
  env: Record<string, string | undefined>,
  dependencies: ReplayBlobStoreDependencies = {},
): ReplayBlobStore {
  const provider = env.REPLAY_BLOB_PROVIDER?.trim().toLowerCase() ?? 'local';
  const rootDirectory = env.REPLAY_BLOB_DIR?.trim() || './data/replay-blobs';
  if (provider === 'local') {
    return new LocalReplayBlobStore({ rootDirectory });
  }
  if (provider === 'postgres') {
    if (!dependencies.database) {
      throw new Error('REPLAY_BLOB_PROVIDER=postgres requires a database connection.');
    }
    return new PostgresReplayBlobStore({ database: dependencies.database });
  }
  throw new Error(`Unsupported REPLAY_BLOB_PROVIDER "${provider}". Expected "local" or "postgres".`);
}
