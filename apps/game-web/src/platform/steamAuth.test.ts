import { describe, expect, test, vi } from 'vitest';
import { createSteamPlatformServices } from './steam';

const STEAM_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const STEAM_TICKET = 'dev-steam:76561198012345678';

describe('steam auth adapter', () => {
  test('exchanges steam ticket and caches authenticated session', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          accountId: STEAM_ACCOUNT_ID,
          isAuthenticated: true,
        };
      },
    })) as unknown as typeof fetch;

    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      devTicket: STEAM_TICKET,
      fetchImpl: fetchMock,
    });

    const firstSession = await platform.auth.getSession();
    const secondSession = await platform.auth.getSession();

    expect(firstSession.isAuthenticated).toBe(true);
    expect(firstSession.accountId).toBe(STEAM_ACCOUNT_ID);
    expect(secondSession.accountId).toBe(STEAM_ACCOUNT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.gravitywell.space/auth/steam/exchange',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  test('returns unauthenticated session with clear recovery message when exchange fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      async json() {
        return {
          error: 'steamTicket is invalid.',
          recovery: 'Retry Steam sign-in and submit a fresh ticket.',
        };
      },
    })) as unknown as typeof fetch;

    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      devTicket: STEAM_TICKET,
      fetchImpl: fetchMock,
    });
    const session = await platform.auth.getSession();

    expect(session.isAuthenticated).toBe(false);
    expect(session.accountId).toBeNull();
    expect(session.displayName).toContain('Retry Steam sign-in and submit a fresh ticket.');
  });

  test('fails with clear message when steam ticket is unavailable', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      async json() {
        return {};
      },
    })) as unknown as typeof fetch;

    const platform = createSteamPlatformServices({
      authApiBase: 'https://api.gravitywell.space',
      devTicket: '',
      fetchImpl: fetchMock,
      getRuntimeSteamTicket: () => null,
    });
    const session = await platform.auth.getSession();

    expect(session.isAuthenticated).toBe(false);
    expect(session.displayName).toContain('VITE_STEAM_DEV_TICKET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fails with clear message when API base is missing', async () => {
    const platform = createSteamPlatformServices({
      authApiBase: '',
      devTicket: STEAM_TICKET,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const session = await platform.auth.getSession();
    expect(session.isAuthenticated).toBe(false);
    expect(session.displayName).toContain('VITE_PROFILE_API_BASE');
  });
});
