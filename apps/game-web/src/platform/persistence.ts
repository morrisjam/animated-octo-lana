import type {
  PersistenceReadResult,
  PersistenceScope,
  PersistenceWriteResult,
  PlatformPersistenceService,
  PlatformStorageService,
} from './types';

const DEFAULT_SCOPE: PersistenceScope = 'local';

function resolveScope(options?: { scope?: PersistenceScope }): PersistenceScope {
  return options?.scope ?? DEFAULT_SCOPE;
}

export function createStorageBackedPersistenceService(
  storage: PlatformStorageService,
  supportedScopes: PersistenceScope[] = ['local'],
): PlatformPersistenceService {
  const supportedScopeSet = new Set<PersistenceScope>(supportedScopes);

  function unsupportedResult(): PersistenceWriteResult {
    return {
      ok: false,
      status: 'unsupported',
      reason: 'Persistence scope is not supported on this platform.',
    };
  }

  function isScopeSupported(scope: PersistenceScope): boolean {
    return supportedScopeSet.has(scope);
  }

  return {
    isScopeSupported,
    readJson<T>(key: string, options?: { scope?: PersistenceScope }): PersistenceReadResult<T> {
      const scope = resolveScope(options);
      if (!isScopeSupported(scope)) {
        return {
          ok: false,
          status: 'unsupported',
          reason: 'Persistence scope is not supported on this platform.',
        };
      }

      const raw = storage.getItem(key);
      if (raw === null) {
        return {
          ok: false,
          status: 'not_found',
          reason: 'No persisted value exists for this key.',
        };
      }

      try {
        return {
          ok: true,
          status: 'ok',
          value: JSON.parse(raw) as T,
        };
      } catch {
        return {
          ok: false,
          status: 'invalid_data',
          reason: 'Persisted value is not valid JSON.',
        };
      }
    },
    writeJson(key: string, value: unknown, options?: { scope?: PersistenceScope }): PersistenceWriteResult {
      const scope = resolveScope(options);
      if (!isScopeSupported(scope)) {
        return unsupportedResult();
      }

      try {
        storage.setItem(key, JSON.stringify(value));
        return { ok: true, status: 'ok' };
      } catch {
        return {
          ok: false,
          status: 'error',
          reason: 'Failed to write persisted value.',
        };
      }
    },
    remove(key: string, options?: { scope?: PersistenceScope }): PersistenceWriteResult {
      const scope = resolveScope(options);
      if (!isScopeSupported(scope)) {
        return unsupportedResult();
      }

      try {
        storage.removeItem(key);
        return { ok: true, status: 'ok' };
      } catch {
        return {
          ok: false,
          status: 'error',
          reason: 'Failed to remove persisted value.',
        };
      }
    },
  };
}
