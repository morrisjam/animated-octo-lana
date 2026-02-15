import { describe, expect, test } from 'vitest';
import { createSteamPlatformServices } from './steam';
import type { PlatformServices } from './types';
import { createWebPlatformServices } from './web';

const platformFactories: Array<{ name: string; create: () => PlatformServices }> = [
  { name: 'web', create: createWebPlatformServices },
  { name: 'steam', create: createSteamPlatformServices },
];

for (const factory of platformFactories) {
  describe(`${factory.name} persistence adapter`, () => {
    test('round-trips local JSON payloads', () => {
      const platform = factory.create();
      const writeResult = platform.persistence.writeJson('test.settings', {
        mode: 'training',
        lastSeed: 42,
      });
      expect(writeResult).toEqual({ ok: true, status: 'ok' });

      const readResult = platform.persistence.readJson<{ mode: string; lastSeed: number }>('test.settings');
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) {
        return;
      }
      expect(readResult.value.mode).toBe('training');
      expect(readResult.value.lastSeed).toBe(42);
    });

    test('returns not_found for missing values and removes persisted keys', () => {
      const platform = factory.create();
      expect(platform.persistence.readJson('test.missing')).toMatchObject({
        ok: false,
        status: 'not_found',
      });

      expect(platform.persistence.writeJson('test.remove', { keep: false })).toEqual({
        ok: true,
        status: 'ok',
      });
      expect(platform.persistence.remove('test.remove')).toEqual({
        ok: true,
        status: 'ok',
      });
      expect(platform.persistence.readJson('test.remove')).toMatchObject({
        ok: false,
        status: 'not_found',
      });
    });

    test('handles invalid stored JSON and unsupported scopes safely', () => {
      const platform = factory.create();
      platform.storage.setItem('test.invalid', '{not-valid-json');

      expect(platform.persistence.readJson('test.invalid')).toMatchObject({
        ok: false,
        status: 'invalid_data',
      });

      expect(platform.persistence.isScopeSupported('cloud')).toBe(false);
      expect(platform.persistence.writeJson('test.cloud', { enabled: true }, { scope: 'cloud' })).toMatchObject({
        ok: false,
        status: 'unsupported',
      });
      expect(platform.persistence.readJson('test.cloud', { scope: 'cloud' })).toMatchObject({
        ok: false,
        status: 'unsupported',
      });
      expect(platform.persistence.remove('test.cloud', { scope: 'cloud' })).toMatchObject({
        ok: false,
        status: 'unsupported',
      });
    });
  });
}
