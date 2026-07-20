import type { StorageBackedPersistenceOptions } from './persistence';
import type {
  LegacyPersistenceReadResult,
  LegacyPersistenceWriteResult,
  PersistenceScope,
  PlatformPersistenceService,
  PlatformStorageService,
} from './types';

const DEFAULT_SCOPE: PersistenceScope = 'local';

function resolveScope(options?: { scope?: PersistenceScope }): PersistenceScope {
  return options?.scope ?? DEFAULT_SCOPE;
}

export function createLazyStorageBackedPersistenceService(
  storage: PlatformStorageService,
  options: StorageBackedPersistenceOptions = {},
): PlatformPersistenceService {
  const supportedScopes = new Set<PersistenceScope>(options.supportedScopes ?? ['local']);
  let delegatePromise: Promise<PlatformPersistenceService> | null = null;

  const getDelegate = (): Promise<PlatformPersistenceService> => {
    delegatePromise ??= import('./persistence').then(({ createStorageBackedPersistenceService }) => (
      createStorageBackedPersistenceService(storage, options)
    ));
    return delegatePromise;
  };

  const isScopeSupported = (scope: PersistenceScope): boolean => supportedScopes.has(scope);
  const unsupportedWrite = (): LegacyPersistenceWriteResult => ({
    ok: false,
    status: 'unsupported',
    reason: 'Persistence scope is not supported on this platform.',
  });

  return {
    isScopeSupported,
    async read(key, readOptions) {
      return (await getDelegate()).read(key, readOptions);
    },
    async write(key, value, writeOptions) {
      return (await getDelegate()).write(key, value, writeOptions);
    },
    async delete(key, deleteOptions) {
      return (await getDelegate()).delete(key, deleteOptions);
    },
    async getQuota(quotaOptions) {
      return (await getDelegate()).getQuota(quotaOptions);
    },
    readJson<T>(key: string, legacyOptions?: { scope?: PersistenceScope }): LegacyPersistenceReadResult<T> {
      const scope = resolveScope(legacyOptions);
      if (!isScopeSupported(scope)) {
        return {
          ok: false,
          status: 'unsupported',
          reason: 'Persistence scope is not supported on this platform.',
        };
      }
      const raw = storage.getItem(key);
      if (raw === null) {
        return { ok: false, status: 'not_found', reason: 'No persisted value exists for this key.' };
      }
      try {
        return { ok: true, status: 'ok', value: JSON.parse(raw) as T };
      } catch {
        return { ok: false, status: 'invalid_data', reason: 'Persisted value is not valid JSON.' };
      }
    },
    writeJson(key: string, value: unknown, legacyOptions?: { scope?: PersistenceScope }): LegacyPersistenceWriteResult {
      if (!isScopeSupported(resolveScope(legacyOptions))) {
        return unsupportedWrite();
      }
      try {
        storage.setItem(key, JSON.stringify(value));
        return { ok: true, status: 'ok' };
      } catch {
        return { ok: false, status: 'error', reason: 'Failed to write persisted value.' };
      }
    },
    remove(key: string, legacyOptions?: { scope?: PersistenceScope }): LegacyPersistenceWriteResult {
      if (!isScopeSupported(resolveScope(legacyOptions))) {
        return unsupportedWrite();
      }
      try {
        storage.removeItem(key);
        return { ok: true, status: 'ok' };
      } catch {
        return { ok: false, status: 'error', reason: 'Failed to remove persisted value.' };
      }
    },
  };
}
