import { describe, expect, test } from 'vitest';
import { createSteamPlatformServices } from './steam';
import { createWebPlatformServices } from './web';

describe('platform entitlement adapters', () => {
  test('web defaults to granted open access', async () => {
    const platform = createWebPlatformServices();
    await expect(platform.entitlement.checkAccess({ stage: 'startup' })).resolves.toMatchObject({
      allowed: true,
      status: 'granted',
      code: 'web_open_access',
    });
  });

  test('steam fails safely when entitlement provider is unavailable', async () => {
    const platform = createSteamPlatformServices();
    await expect(platform.entitlement.checkAccess({ stage: 'startup', accountId: null })).resolves.toMatchObject({
      allowed: false,
      status: 'unavailable',
      code: 'steam_provider_unavailable',
    });
  });
});
