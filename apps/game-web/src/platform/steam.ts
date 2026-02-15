import type { PlatformServices, PlatformStorageService } from './types';
import { createConfiguredEntitlementService, parseEntitlementMode } from './entitlement';
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
  const bypass = (import.meta.env.VITE_STEAM_ENTITLEMENT_BYPASS as string | undefined)?.trim().toLowerCase();
  const entitlementMode = bypass === 'true'
    ? 'open'
    : parseEntitlementMode(import.meta.env.VITE_STEAM_ENTITLEMENT_MODE as string | undefined, 'unavailable');
  const entitlement = createConfiguredEntitlementService({
    mode: entitlementMode,
    platformLabel: 'steam',
    deniedMessage: String(import.meta.env.VITE_STEAM_ENTITLEMENT_DENY_MESSAGE ?? '').trim() || undefined,
    unavailableMessage: 'Steam entitlement verification is unavailable in this runtime.',
  });
  const persistence = createStorageBackedPersistenceService(storage, ['local']);
  let presenceStatus: string | null = null;

  return {
    kind: 'steam',
    storage,
    entitlement,
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
