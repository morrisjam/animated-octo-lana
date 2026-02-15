import type { PlatformServices, PlatformStorageService } from './types';
import { createStorageBackedPersistenceService } from './persistence';

function createMemoryStorage(): PlatformStorageService {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };
}

export function createSteamPlatformServices(): PlatformServices {
  const storage = createMemoryStorage();
  const persistence = createStorageBackedPersistenceService(storage, ['local']);
  let presenceStatus: string | null = null;

  return {
    kind: 'steam',
    storage,
    persistence,
    auth: {
      async getSession() {
        // Placeholder adapter for non-Steam runtime.
        return {
          accountId: null,
          displayName: null,
          isAuthenticated: false,
        };
      },
    },
    presence: {
      async setStatus(status: string) {
        presenceStatus = status;
      },
      getStatus() {
        return presenceStatus;
      },
    },
    profile: {
      async getProfile(accountId: string) {
        const raw = storage.getItem(`profile.${accountId}`);
        if (!raw) {
          return {
            accountId,
            displayName: null,
            settings: {},
            updatedAt: null,
            source: 'default',
          };
        }
        try {
          const parsed = JSON.parse(raw) as {
            displayName: string | null;
            settings: Record<string, unknown>;
            updatedAt: string | null;
          };
          return {
            accountId,
            displayName: parsed.displayName ?? null,
            settings: parsed.settings ?? {},
            updatedAt: parsed.updatedAt ?? null,
            source: 'cache',
          };
        } catch {
          return {
            accountId,
            displayName: null,
            settings: {},
            updatedAt: null,
            source: 'default',
          };
        }
      },
      async saveProfile(accountId: string, payload: { displayName?: string | null; settings?: Record<string, unknown> }) {
        const value = {
          displayName: payload.displayName ?? null,
          settings: payload.settings ?? {},
          updatedAt: new Date().toISOString(),
        };
        storage.setItem(`profile.${accountId}`, JSON.stringify(value));
        return {
          accountId,
          displayName: value.displayName,
          settings: value.settings,
          updatedAt: value.updatedAt,
          source: 'cache',
        };
      },
    },
  };
}
