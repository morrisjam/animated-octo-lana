import type { PlatformServices, PlatformStorageService } from './types';

const GUEST_ACCOUNT_KEY = 'gravity_well.guest_account_id';
const PROFILE_CACHE_KEY_PREFIX = 'gravity_well.profile.';
const profileApiBase = (import.meta.env.VITE_PROFILE_API_BASE as string | undefined)?.trim();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredProfilePayload {
  accountId: string;
  displayName: string | null;
  settings: Record<string, unknown>;
  updatedAt: string | null;
}

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

function createBrowserStorage(): PlatformStorageService {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createMemoryStorage();
  }
  return {
    getItem(key: string): string | null {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Ignore storage write failures in restricted environments.
      }
    },
    removeItem(key: string): void {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage removal failures in restricted environments.
      }
    },
  };
}

function createGuestAccountId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xFFFFFF).toString(36);
  return `guest_${timestamp}_${random}`;
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return UUID_REGEX.test(value);
}

function profileCacheKey(accountId: string): string {
  return `${PROFILE_CACHE_KEY_PREFIX}${accountId}`;
}

function readProfileCache(storage: PlatformStorageService, accountId: string): StoredProfilePayload | null {
  const raw = storage.getItem(profileCacheKey(accountId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredProfilePayload;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      accountId,
      displayName: parsed.displayName ?? null,
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return null;
  }
}

function writeProfileCache(storage: PlatformStorageService, payload: StoredProfilePayload): void {
  storage.setItem(profileCacheKey(payload.accountId), JSON.stringify(payload));
}

function defaultProfile(accountId: string): StoredProfilePayload {
  return {
    accountId,
    displayName: null,
    settings: {},
    updatedAt: null,
  };
}

export function createWebPlatformServices(): PlatformServices {
  const storage = createBrowserStorage();
  let presenceStatus: string | null = null;
  let guestAccountPromise: Promise<string> | null = null;

  async function ensureGuestAccountId(): Promise<string> {
    const stored = storage.getItem(GUEST_ACCOUNT_KEY);
    if (isUuid(stored) || !profileApiBase) {
      if (stored) {
        return stored;
      }
      const fallback = createGuestAccountId();
      storage.setItem(GUEST_ACCOUNT_KEY, fallback);
      return fallback;
    }

    if (!guestAccountPromise) {
      guestAccountPromise = (async () => {
        try {
          const response = await fetch(`${profileApiBase}/accounts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'active' }),
          });
          if (response.ok) {
            const payload = await response.json() as { id?: string };
            if (isUuid(payload.id)) {
              storage.setItem(GUEST_ACCOUNT_KEY, payload.id);
              return payload.id;
            }
          }
        } catch {
          // Fallback below keeps web prototype usable when API is unavailable.
        }

        const fallback = stored || createGuestAccountId();
        storage.setItem(GUEST_ACCOUNT_KEY, fallback);
        return fallback;
      })();
    }
    return guestAccountPromise;
  }

  return {
    kind: 'web',
    storage,
    auth: {
      async getSession() {
        const accountId = await ensureGuestAccountId();
        return {
          accountId,
          displayName: 'Guest',
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
        const cached = readProfileCache(storage, accountId);
        if (!profileApiBase) {
          if (cached) {
            return { ...cached, source: 'cache' as const };
          }
          return { ...defaultProfile(accountId), source: 'default' as const };
        }

        try {
          const response = await fetch(`${profileApiBase}/profile`, {
            method: 'GET',
            headers: {
              'x-account-id': accountId,
            },
          });
          if (!response.ok) {
            throw new Error(`Profile fetch failed: ${response.status}`);
          }
          const payload = await response.json() as {
            account_id: string;
            display_name: string | null;
            settings_json: Record<string, unknown>;
            updated_at: string | null;
          };
          const normalised: StoredProfilePayload = {
            accountId: payload.account_id,
            displayName: payload.display_name ?? null,
            settings: payload.settings_json && typeof payload.settings_json === 'object'
              ? payload.settings_json
              : {},
            updatedAt: payload.updated_at ?? null,
          };
          writeProfileCache(storage, normalised);
          return { ...normalised, source: 'remote' as const };
        } catch {
          if (cached) {
            return { ...cached, source: 'cache' as const };
          }
          return { ...defaultProfile(accountId), source: 'default' as const };
        }
      },
      async saveProfile(accountId: string, payload: { displayName?: string | null; settings?: Record<string, unknown> }) {
        const localPayload: StoredProfilePayload = {
          accountId,
          displayName: payload.displayName ?? null,
          settings: payload.settings ?? {},
          updatedAt: new Date().toISOString(),
        };

        if (!profileApiBase) {
          writeProfileCache(storage, localPayload);
          return { ...localPayload, source: 'cache' as const };
        }

        try {
          const response = await fetch(`${profileApiBase}/profile`, {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              'x-account-id': accountId,
            },
            body: JSON.stringify({
              displayName: payload.displayName ?? null,
              settings: payload.settings ?? {},
            }),
          });
          if (!response.ok) {
            throw new Error(`Profile save failed: ${response.status}`);
          }
          const saved = await response.json() as {
            account_id: string;
            display_name: string | null;
            settings_json: Record<string, unknown>;
            updated_at: string | null;
          };
          const normalised: StoredProfilePayload = {
            accountId: saved.account_id,
            displayName: saved.display_name ?? null,
            settings: saved.settings_json && typeof saved.settings_json === 'object'
              ? saved.settings_json
              : {},
            updatedAt: saved.updated_at ?? null,
          };
          writeProfileCache(storage, normalised);
          return { ...normalised, source: 'remote' as const };
        } catch {
          writeProfileCache(storage, localPayload);
          return { ...localPayload, source: 'cache' as const };
        }
      },
    },
  };
}
