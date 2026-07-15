import { describe, expect, test, vi } from 'vitest';
import { createSteamPlatformServices } from './steam';
import {
  STEAM_RUNTIME_BRIDGE_SCHEMA,
  STEAM_WEB_API_TICKET_SCHEMA,
  type SteamRuntimeBridge,
} from './steamRuntimeBridge';

const STEAM_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const STEAM_TICKET_ID = '22222222-2222-4222-8222-222222222222';
const STEAM_TICKET = '00112233445566778899aabbccddeeff';
const STEAM_IDENTITY = 'gravity-well-api';
const DEV_STEAM_TICKET = 'dev-steam:76561198012345678';

function createRuntimeBridge(ticket = STEAM_TICKET): SteamRuntimeBridge & {
  requestWebApiTicket: ReturnType<typeof vi.fn>;
  cancelWebApiTicket: ReturnType<typeof vi.fn>;
} {
  return {
    schemaVersion: STEAM_RUNTIME_BRIDGE_SCHEMA,
    requestWebApiTicket: vi.fn(async (identity: string) => ({
      schemaVersion: STEAM_WEB_API_TICKET_SCHEMA as typeof STEAM_WEB_API_TICKET_SCHEMA,
      ticketId: STEAM_TICKET_ID,
      ticket,
      identity,
    })),
    cancelWebApiTicket: vi.fn(async () => true),
  };
}

function createSuccessfulFetch() {
  return vi.fn(async () => ({
    ok: true,
    async json() {
      return {
        accountId: STEAM_ACCOUNT_ID,
        isAuthenticated: true,
        accessToken: 'signed-steam-session-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      };
    },
  })) as unknown as typeof fetch;
}

describe('steam auth adapter', () => {
  test('acquires a native web ticket, exchanges it once, cancels it, and caches the API session', async () => {
    const fetchMock = createSuccessfulFetch();
    const runtimeBridge = createRuntimeBridge();
    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      fetchImpl: fetchMock,
      runtimeBridge,
      steamWebApiIdentity: STEAM_IDENTITY,
      allowDevTicket: false,
    });

    const firstSession = await platform.auth.getSession();
    const secondSession = await platform.auth.getSession();

    expect(firstSession.isAuthenticated).toBe(true);
    expect(firstSession.accountId).toBe(STEAM_ACCOUNT_ID);
    expect(secondSession.accountId).toBe(STEAM_ACCOUNT_ID);
    expect(platform.auth.getAccessToken?.()).toBe('signed-steam-session-token');
    expect(runtimeBridge.requestWebApiTicket).toHaveBeenCalledOnce();
    expect(runtimeBridge.requestWebApiTicket).toHaveBeenCalledWith(STEAM_IDENTITY);
    expect(runtimeBridge.cancelWebApiTicket).toHaveBeenCalledOnce();
    expect(runtimeBridge.cancelWebApiTicket).toHaveBeenCalledWith(STEAM_TICKET_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.gravitywell.space/auth/steam/exchange',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ steamTicket: STEAM_TICKET }),
      }),
    );
  });

  test('cancels the native ticket when the server rejects the exchange', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      async json() {
        return {
          error: 'steamTicket is invalid.',
          recovery: 'Retry Steam sign-in and submit a fresh ticket.',
        };
      },
    })) as unknown as typeof fetch;
    const runtimeBridge = createRuntimeBridge();
    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      fetchImpl: fetchMock,
      runtimeBridge,
      steamWebApiIdentity: STEAM_IDENTITY,
      allowDevTicket: false,
    });

    const session = await platform.auth.getSession();

    expect(session.isAuthenticated).toBe(false);
    expect(session.accountId).toBeNull();
    expect(session.displayName).toContain('Retry Steam sign-in and submit a fresh ticket.');
    expect(runtimeBridge.cancelWebApiTicket).toHaveBeenCalledWith(STEAM_TICKET_ID);
  });

  test('rejects malformed native ticket responses before contacting the API', async () => {
    const fetchMock = createSuccessfulFetch();
    const runtimeBridge = createRuntimeBridge('not-hex');
    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      fetchImpl: fetchMock,
      runtimeBridge,
      steamWebApiIdentity: STEAM_IDENTITY,
      allowDevTicket: false,
    });

    const session = await platform.auth.getSession();

    expect(session.isAuthenticated).toBe(false);
    expect(session.displayName).toContain('invalid Web API ticket');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fails closed when the native Steam bridge is unavailable', async () => {
    const fetchMock = createSuccessfulFetch();
    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      fetchImpl: fetchMock,
      runtimeBridge: null,
      allowDevTicket: false,
    });

    const session = await platform.auth.getSession();

    expect(session.isAuthenticated).toBe(false);
    expect(session.displayName).toContain('native Steam ticket bridge was not found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('allows explicit development tickets only in the development path', async () => {
    const fetchMock = createSuccessfulFetch();
    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      devTicket: DEV_STEAM_TICKET,
      fetchImpl: fetchMock,
      runtimeBridge: null,
      allowDevTicket: true,
    });

    const session = await platform.auth.getSession();

    expect(session.isAuthenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.gravitywell.space/auth/steam/exchange',
      expect.objectContaining({
        body: JSON.stringify({ steamTicket: DEV_STEAM_TICKET }),
      }),
    );
  });

  test('does not request a Steam ticket when the API base is missing', async () => {
    const runtimeBridge = createRuntimeBridge();
    const platform = createSteamPlatformServices({
      authApiBase: '',
      fetchImpl: vi.fn() as unknown as typeof fetch,
      runtimeBridge,
      steamWebApiIdentity: STEAM_IDENTITY,
      allowDevTicket: false,
    });

    const session = await platform.auth.getSession();

    expect(session.isAuthenticated).toBe(false);
    expect(session.displayName).toContain('VITE_PROFILE_API_BASE');
    expect(runtimeBridge.requestWebApiTicket).not.toHaveBeenCalled();
  });
});
