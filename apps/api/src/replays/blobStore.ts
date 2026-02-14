import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export interface ReplayBlobPutResult {
  storageKey: string;
  compressedBytes: number;
  sha256: string;
}

export interface ReplayBlobStore {
  putReplayPayload(replayId: string, payload: unknown): Promise<ReplayBlobPutResult>;
  getReplayPayload(storageKey: string): Promise<unknown>;
  deleteReplayPayload(storageKey: string): Promise<void>;
}

export interface ReplayBlobStoreOptions {
  rootDirectory: string;
}

export class LocalReplayBlobStore implements ReplayBlobStore {
  private readonly rootDirectory: string;

  public constructor(options: ReplayBlobStoreOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
  }

  public async putReplayPayload(replayId: string, payload: unknown): Promise<ReplayBlobPutResult> {
    await mkdir(this.rootDirectory, { recursive: true });
    const storageKey = `${replayId}.json.gz`;
    const filePath = path.join(this.rootDirectory, storageKey);
    const jsonPayload = JSON.stringify(payload);
    const compressed = gzipSync(Buffer.from(jsonPayload, 'utf8'), { level: 9 });
    await writeFile(filePath, compressed);

    return {
      storageKey,
      compressedBytes: compressed.byteLength,
      sha256: createHash('sha256').update(compressed).digest('hex'),
    };
  }

  public async getReplayPayload(storageKey: string): Promise<unknown> {
    const filePath = path.join(this.rootDirectory, storageKey);
    const compressed = await readFile(filePath);
    const decompressed = gunzipSync(compressed);
    return JSON.parse(decompressed.toString('utf8')) as unknown;
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

export function createReplayBlobStoreFromEnv(env: Record<string, string | undefined>): ReplayBlobStore {
  const provider = env.REPLAY_BLOB_PROVIDER?.trim().toLowerCase() ?? 'local';
  const rootDirectory = env.REPLAY_BLOB_DIR?.trim() || './data/replay-blobs';
  if (provider !== 'local') {
    throw new Error(`Unsupported REPLAY_BLOB_PROVIDER "${provider}". Only "local" is currently supported.`);
  }
  return new LocalReplayBlobStore({ rootDirectory });
}
