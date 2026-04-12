import type {
  PlatformAuthSession,
  PlatformServices,
  PlatformStorageService,
  WebAuthSigninRequest,
  WebAuthSignupRequest,
} from './types';
import { createConfiguredEntitlementService, parseEntitlementMode } from './entitlement';
import { createStorageBackedPersistenceService } from './persistence';

const GUEST_ACCOUNT_KEY = 'gravity_well.guest_account_id';
const AUTH_ACCOUNT_KEY = 'gravity_well.auth_account_id';
const AUTH_DISPLAY_NAME_KEY = 'gravity_well.auth_display_name';
const PROFILE_CACHE_KEY_PREFIX = 'gravity_well.profile.';
const profileApiBase = (
  (import.meta.env.VITE_PROFILE_API_BASE as string | undefined)?.trim()
  || (import.meta.env.VITE_MATCHMAKING_API_BASE as string | undefined)?.trim()
);
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

function normaliseDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as {
      error?: string;
      message?: string;
      recovery?: string;
    };
    const message = payload.error ?? payload.message ?? `Request failed (${response.status})`;
    if (payload.recovery) {
      return `${message} ${payload.recovery}`;
    }
    return message;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export function createWebPlatformServices(): PlatformServices {
  const storage = createBrowserStorage();
  const entitlementMode = parseEntitlementMode(import.meta.env.VITE_ENTITLEMENT_MODE as string | undefined, 'open');
  const entitlement = createConfiguredEntitlementService({
    mode: entitlementMode,
    platformLabel: 'web',
    deniedMessage: String(import.meta.env.VITE_ENTITLEMENT_DENY_MESSAGE ?? '').trim() || undefined,
    unavailableMessage: 'Entitlement service is unavailable. Please retry later or contact support.',
  });
  const persistence = createStorageBackedPersistenceService(storage, ['local']);
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

  function getAuthenticatedSession(): PlatformAuthSession | null {
    const accountId = storage.getItem(AUTH_ACCOUNT_KEY);
    if (!isUuid(accountId)) {
      return null;
    }
    return {
      accountId,
      displayName: normaliseDisplayName(storage.getItem(AUTH_DISPLAY_NAME_KEY)),
      isAuthenticated: true,
    };
  }

  function setAuthenticatedSession(accountId: string, displayName: string | null): void {
    storage.setItem(AUTH_ACCOUNT_KEY, accountId);
    if (displayName) {
      storage.setItem(AUTH_DISPLAY_NAME_KEY, displayName);
    } else {
      storage.removeItem(AUTH_DISPLAY_NAME_KEY);
    }
  }

  function clearAuthenticatedSession(): void {
    storage.removeItem(AUTH_ACCOUNT_KEY);
    storage.removeItem(AUTH_DISPLAY_NAME_KEY);
  }

  async function resolveSession(): Promise<PlatformAuthSession> {
    const authenticated = getAuthenticatedSession();
    if (authenticated) {
      return authenticated;
    }
    const accountId = await ensureGuestAccountId();
    return {
      accountId,
      displayName: 'Guest',
      isAuthenticated: false,
    };
  }

  return {
    kind: 'web',
    storage,
    entitlement,
    persistence,
    auth: {
      async getSession() {
        return await resolveSession();
      },
      async signUp(request: WebAuthSignupRequest) {
        if (!profileApiBase) {
          throw new Error('Web auth is unavailable until VITE_PROFILE_API_BASE is configured.');
        }
        const email = String(request.email ?? '').trim();
        const password = String(request.password ?? '');
        const displayName = normaliseDisplayName(request.displayName);
        if (!email) {
          throw new Error('Email is required.');
        }
        if (!password) {
          throw new Error('Password is required.');
        }

        const currentSession = await resolveSession();
        const upgradeAccountId = request.upgradeCurrentGuest && !currentSession.isAuthenticated && isUuid(currentSession.accountId)
          ? currentSession.accountId
          : null;
        const headers: Record<string, string> = {
          'content-type': 'application/json',
        };
        if (upgradeAccountId) {
          headers['x-account-id'] = upgradeAccountId;
        }
        const response = await fetch(`${profileApiBase}/auth/web/signup`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            email,
            password,
            displayName,
            upgradeAccountId,
          }),
        });
        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }
        const payload = await response.json() as { accountId?: string };
        if (!isUuid(payload.accountId)) {
          throw new Error('Web signup did not return a valid account id.');
        }
        setAuthenticatedSession(payload.accountId, displayName);
        return {
          accountId: payload.accountId,
          displayName,
          isAuthenticated: true,
        };
      },
      async signIn(request: WebAuthSigninRequest) {
        if (!profileApiBase) {
          throw new Error('Web auth is unavailable until VITE_PROFILE_API_BASE is configured.');
        }
        const email = String(request.email ?? '').trim();
        const password = String(request.password ?? '');
        if (!email) {
          throw new Error('Email is required.');
        }
        if (!password) {
          throw new Error('Password is required.');
        }
        const response = await fetch(`${profileApiBase}/auth/web/signin`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email,
            password,
          }),
        });
        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }
        const payload = await response.json() as {
          accountId?: string;
          displayName?: string | null;
          isAuthenticated?: boolean;
        };
        if (!isUuid(payload.accountId) || !payload.isAuthenticated) {
          throw new Error('Web sign-in response was invalid.');
        }
        const displayName = normaliseDisplayName(payload.displayName);
        setAuthenticatedSession(payload.accountId, displayName);
        return {
          accountId: payload.accountId,
          displayName,
          isAuthenticated: true,
        };
      },
      async signOut() {
        clearAuthenticatedSession();
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
