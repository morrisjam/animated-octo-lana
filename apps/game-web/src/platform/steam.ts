import type { PlatformServices, PlatformStorageService } from './types';
import { createConfiguredEntitlementService, parseEntitlementMode } from './entitlement';
import { createBrowserPlatformLifecycleAdapter } from './lifecycle';
import {
  createStorageBackedPersistenceService,
  PLATFORM_PERSISTENCE_KEYS,
} from './persistence';
import {
  parseSteamWebApiTicketLease,
  readSteamRuntimeBridge,
  validateSteamWebApiIdentity,
  type SteamRuntimeBridge,
} from './steamRuntimeBridge';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SteamPlatformOptions {
  authApiBase?: string | null;
  devTicket?: string | null;
  fetchImpl?: typeof fetch;
  runtimeBridge?: SteamRuntimeBridge | null;
  steamWebApiIdentity?: string | null;
  allowDevTicket?: boolean;
  getRuntimeSteamTicket?: () => string | null;
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
    setItemChecked(key: string, value: string): void {
      store.set(key, value);
    },
    removeItemChecked(key: string): void {
      store.delete(key);
    },
    listKeys(): string[] {
      return [...store.keys()];
    },
  };
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return UUID_REGEX.test(value);
}

function normaliseString(value: unknown): string | null {
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
    const message = normaliseString(payload.error) ?? normaliseString(payload.message) ?? `Request failed (${response.status})`;
    const recovery = normaliseString(payload.recovery);
    return recovery ? `${message} ${recovery}` : message;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export function createSteamPlatformServices(options?: SteamPlatformOptions): PlatformServices {
  const storage = createMemoryStorage();
  const lifecycleAdapter = createBrowserPlatformLifecycleAdapter();
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
  const authApiBase = (
    options?.authApiBase
    ?? (import.meta.env.VITE_PROFILE_API_BASE as string | undefined)
    ?? ''
  ).trim();
  const devTicket = (
    options?.devTicket
    ?? (import.meta.env.VITE_STEAM_DEV_TICKET as string | undefined)
    ?? ''
  ).trim();
  const steamWebApiIdentityRaw = (
    options?.steamWebApiIdentity
    ?? (import.meta.env.VITE_STEAM_WEB_API_IDENTITY as string | undefined)
    ?? ''
  ).trim();
  const allowDevTicket = options?.allowDevTicket ?? import.meta.env.DEV;
  const fetchImpl: typeof fetch | null = options?.fetchImpl
    ?? (typeof fetch === 'function' ? fetch.bind(globalThis) as typeof fetch : null);
  const runtimeBridge = options?.runtimeBridge === undefined
    ? readSteamRuntimeBridge()
    : options.runtimeBridge;
  const getRuntimeSteamTicket = options?.getRuntimeSteamTicket ?? (() => null);
  const persistence = createStorageBackedPersistenceService(storage, {
    supportedScopes: ['local'],
    legacySourceResolver(key, userId) {
      if (key === PLATFORM_PERSISTENCE_KEYS.settings) {
        return [{ key: 'gravity_well.settings.v1' }];
      }
      if (key === PLATFORM_PERSISTENCE_KEYS.profile) {
        return [{ key: `profile.${userId}` }];
      }
      return [];
    },
  });
  let presenceStatus: string | null = null;
  let cachedSession: { accountId: string; accessToken: string; accessTokenExpiresAt: string } | null = null;
  let authAttempted = false;
  let authFailureMessage: string | null = null;

  function unauthenticatedSession(): { accountId: string | null; displayName: string | null; isAuthenticated: boolean } {
    return {
      accountId: null,
      displayName: authFailureMessage,
      isAuthenticated: false,
    };
  }

  function getAccessToken(): string | null {
    if (!cachedSession) {
      return null;
    }
    const expiresAt = Date.parse(cachedSession.accessTokenExpiresAt);
    return Number.isFinite(expiresAt) && expiresAt > Date.now() + 5_000
      ? cachedSession.accessToken
      : null;
  }

  async function exchangeSteamTicket(ticket: string): Promise<{
    accountId: string;
    displayName: string | null;
    isAuthenticated: boolean;
    accessToken: string;
    accessTokenExpiresAt: string;
  }> {
    if (!fetchImpl) {
      throw new Error('Steam sign-in unavailable: runtime fetch API was not found.');
    }

    const response = await fetchImpl(`${authApiBase}/auth/steam/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        steamTicket: ticket,
      }),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const payload = await response.json() as {
      accountId?: string;
      isAuthenticated?: boolean;
      accessToken?: string;
      accessTokenExpiresAt?: string;
    };
    if (
      !payload.isAuthenticated
      || !isUuid(payload.accountId)
      || !payload.accessToken
      || !payload.accessTokenExpiresAt
    ) {
      throw new Error('Steam sign-in failed: invalid account response.');
    }
    return {
      accountId: payload.accountId,
      displayName: null,
      isAuthenticated: true,
      accessToken: payload.accessToken,
      accessTokenExpiresAt: payload.accessTokenExpiresAt,
    };
  }

  return {
    kind: 'steam',
    storage,
    entitlement,
    persistence,
    lifecycle: lifecycleAdapter.service,
    lifecycleHooks: lifecycleAdapter.hooks,
    auth: {
      getAccessToken,
      async getSession() {
        if (cachedSession && getAccessToken()) {
          return {
            accountId: cachedSession.accountId,
            displayName: null,
            isAuthenticated: true,
          };
        }
        if (cachedSession) {
          cachedSession = null;
          authAttempted = false;
        }
        if (authAttempted) {
          return unauthenticatedSession();
        }
        authAttempted = true;

        if (!authApiBase) {
          authFailureMessage = 'Steam sign-in unavailable: set VITE_PROFILE_API_BASE.';
          return unauthenticatedSession();
        }

        let ticket = '';
        let cancelTicket: (() => Promise<void>) | null = null;
        try {
          if (runtimeBridge) {
            const identity = validateSteamWebApiIdentity(steamWebApiIdentityRaw);
            const lease = parseSteamWebApiTicketLease(
              await runtimeBridge.requestWebApiTicket(identity),
              identity,
            );
            ticket = lease.ticket;
            cancelTicket = async () => {
              await runtimeBridge.cancelWebApiTicket(lease.ticketId);
            };
          } else if (allowDevTicket) {
            ticket = normaliseString(getRuntimeSteamTicket()) ?? normaliseString(devTicket) ?? '';
            if (!ticket) {
              throw new Error('native Steam ticket bridge was not found and no development ticket is configured.');
            }
          } else {
            throw new Error('native Steam ticket bridge was not found. Launch the packaged client through Steam.');
          }

          const session = await exchangeSteamTicket(ticket);
          cachedSession = {
            accountId: session.accountId,
            accessToken: session.accessToken,
            accessTokenExpiresAt: session.accessTokenExpiresAt,
          };
          authFailureMessage = null;
          return session;
        } catch (error) {
          authFailureMessage = error instanceof Error
            ? `Steam sign-in failed: ${error.message}`
            : 'Steam sign-in failed. Retry sign-in and submit a fresh ticket.';
          return unauthenticatedSession();
        } finally {
          if (cancelTicket) {
            try {
              await cancelTicket();
            } catch {
              // The API session is already independent of the one-use Steam ticket.
            }
          }
        }
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
    dispose() {
      lifecycleAdapter.dispose();
    },
  };
}
