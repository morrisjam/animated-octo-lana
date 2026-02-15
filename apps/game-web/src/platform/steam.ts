import type { PlatformServices, PlatformStorageService } from './types';
import { createConfiguredEntitlementService, parseEntitlementMode } from './entitlement';
import { createStorageBackedPersistenceService } from './persistence';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SteamPlatformOptions {
  authApiBase?: string | null;
  devTicket?: string | null;
  fetchImpl?: typeof fetch;
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

function readRuntimeSteamTicketDefault(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const runtime = window as unknown as { __GW_STEAM_TICKET__?: unknown };
  return normaliseString(runtime.__GW_STEAM_TICKET__);
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
  const fetchImpl: typeof fetch | null = options?.fetchImpl
    ?? (typeof fetch === 'function' ? fetch.bind(globalThis) as typeof fetch : null);
  const getRuntimeSteamTicket = options?.getRuntimeSteamTicket ?? readRuntimeSteamTicketDefault;
  const persistence = createStorageBackedPersistenceService(storage, ['local']);
  let presenceStatus: string | null = null;
  let cachedSession: { accountId: string } | null = null;
  let authAttempted = false;
  let authFailureMessage: string | null = null;

  function unauthenticatedSession(): { accountId: string | null; displayName: string | null; isAuthenticated: boolean } {
    return {
      accountId: null,
      displayName: authFailureMessage,
      isAuthenticated: false,
    };
  }

  async function exchangeSteamTicket(ticket: string): Promise<{ accountId: string; displayName: string | null; isAuthenticated: boolean }> {
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
    };
    if (!payload.isAuthenticated || !isUuid(payload.accountId)) {
      throw new Error('Steam sign-in failed: invalid account response.');
    }
    return {
      accountId: payload.accountId,
      displayName: null,
      isAuthenticated: true,
    };
  }

  return {
    kind: 'steam',
    storage,
    entitlement,
    persistence,
    auth: {
      async getSession() {
        if (cachedSession) {
          return {
            accountId: cachedSession.accountId,
            displayName: null,
            isAuthenticated: true,
          };
        }
        if (authAttempted) {
          return unauthenticatedSession();
        }
        authAttempted = true;

        if (!authApiBase) {
          authFailureMessage = 'Steam sign-in unavailable: set VITE_PROFILE_API_BASE.';
          return unauthenticatedSession();
        }

        const runtimeTicket = normaliseString(getRuntimeSteamTicket());
        const ticket = runtimeTicket ?? normaliseString(devTicket);
        if (!ticket) {
          authFailureMessage = 'Steam sign-in unavailable: no Steam ticket found. Set VITE_STEAM_DEV_TICKET for dev.';
          return unauthenticatedSession();
        }

        try {
          const session = await exchangeSteamTicket(ticket);
          cachedSession = { accountId: session.accountId };
          authFailureMessage = null;
          return session;
        } catch (error) {
          authFailureMessage = error instanceof Error
            ? `Steam sign-in failed: ${error.message}`
            : 'Steam sign-in failed. Retry sign-in and submit a fresh ticket.';
          return unauthenticatedSession();
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
  };
}
