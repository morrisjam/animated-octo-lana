import { describe, expect, test } from 'vitest';
import { createConfiguredEntitlementService, parseEntitlementMode } from './entitlement';

describe('parseEntitlementMode', () => {
  test('returns known modes and falls back for invalid values', () => {
    expect(parseEntitlementMode('open', 'unavailable')).toBe('open');
    expect(parseEntitlementMode('require_auth', 'open')).toBe('require_auth');
    expect(parseEntitlementMode('force_denied', 'open')).toBe('force_denied');
    expect(parseEntitlementMode('nope', 'unavailable')).toBe('unavailable');
  });
});

describe('configured entitlement service', () => {
  test('grants access in open mode', async () => {
    const service = createConfiguredEntitlementService({
      mode: 'open',
      platformLabel: 'web',
    });
    await expect(service.checkAccess({ stage: 'startup' })).resolves.toMatchObject({
      allowed: true,
      status: 'granted',
    });
  });

  test('requires account id in require_auth mode', async () => {
    const service = createConfiguredEntitlementService({
      mode: 'require_auth',
      platformLabel: 'web',
    });
    await expect(service.checkAccess({ stage: 'startup', accountId: null })).resolves.toMatchObject({
      allowed: false,
      status: 'denied',
      code: 'web_account_required',
    });
    await expect(service.checkAccess({ stage: 'session', accountId: '1234' })).resolves.toMatchObject({
      allowed: true,
      status: 'granted',
      code: 'web_account_verified',
    });
  });

  test('returns denied and unavailable statuses safely', async () => {
    const denied = createConfiguredEntitlementService({
      mode: 'force_denied',
      platformLabel: 'steam',
      deniedMessage: 'Access denied by policy.',
    });
    await expect(denied.checkAccess({ stage: 'session', accountId: 'abc' })).resolves.toMatchObject({
      allowed: false,
      status: 'denied',
      message: 'Access denied by policy.',
    });

    const unavailable = createConfiguredEntitlementService({
      mode: 'unavailable',
      platformLabel: 'steam',
    });
    await expect(unavailable.checkAccess({ stage: 'session', accountId: 'abc' })).resolves.toMatchObject({
      allowed: false,
      status: 'unavailable',
      code: 'steam_provider_unavailable',
    });
  });
});
