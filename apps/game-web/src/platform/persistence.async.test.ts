import { describe, expect, test } from 'vitest';
import {
  createStorageBackedPersistenceService,
  PLATFORM_PERSISTENCE_ENVELOPE_SCHEMA,
  PLATFORM_PERSISTENCE_KEYS,
  PLATFORM_PERSISTENCE_WRITE_INTENT_SCHEMA,
} from './persistence';
import { createSteamPlatformServices } from './steam';
import type { PlatformServices, PlatformStorageService } from './types';
import { createWebPlatformServices } from './web';

function createTestStorage(): PlatformStorageService {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    setItemChecked(key, value) {
      values.set(key, value);
    },
    removeItemChecked(key) {
      values.delete(key);
    },
    listKeys() {
      return [...values.keys()];
    },
  };
}

const platformFactories: Array<{
  name: string;
  create: () => PlatformServices;
  profileLegacyKey: (userId: string) => string;
}> = [
  {
    name: 'web',
    create: createWebPlatformServices,
    profileLegacyKey: (userId) => `gravity_well.profile.${userId}`,
  },
  {
    name: 'steam',
    create: createSteamPlatformServices,
    profileLegacyKey: (userId) => `profile.${userId}`,
  },
];

for (const factory of platformFactories) {
  describe(`${factory.name} asynchronous persistence adapter`, () => {
    test('isolates users and reports revision conflicts', async () => {
      const platform = factory.create();
      const first = await platform.persistence.write(
        'controls',
        { boost: 'Space' },
        { userId: 'user-a', expectedRevision: null },
      );
      expect(first.ok).toBe(true);
      if (!first.ok) {
        return;
      }
      expect(first.metadata.atomicity).toBe('recoverable_replace');
      expect(first.metadata.writeIntent).toBe('atomic_replace');

      const userA = await platform.persistence.read<{ boost: string }>('controls', { userId: 'user-a' });
      expect(userA).toMatchObject({ ok: true, value: { boost: 'Space' } });
      const userB = await platform.persistence.read('controls', { userId: 'user-b' });
      expect(userB).toMatchObject({
        ok: false,
        status: 'not_found',
        error: { code: 'not_found', userId: 'user-b' },
      });

      const conflict = await platform.persistence.write(
        'controls',
        { boost: 'Shift' },
        { userId: 'user-a', expectedRevision: 'stale-revision' },
      );
      expect(conflict).toMatchObject({
        ok: false,
        status: 'conflict',
        error: {
          code: 'revision_conflict',
          expectedRevision: 'stale-revision',
          actualRevision: first.metadata.revision,
          retryable: true,
        },
      });
      platform.dispose?.();
    });

    test('copies legacy settings and profile data into the user namespace', async () => {
      const platform = factory.create();
      const userId = 'migration-user';
      platform.storage.setItem('gravity_well.settings.v1', JSON.stringify({ volume: 0.5 }));
      platform.storage.setItem(
        factory.profileLegacyKey(userId),
        JSON.stringify({ displayName: 'Pilot', settings: { reducedMotion: true } }),
      );

      const settings = await platform.persistence.read<{ volume: number }>(
        PLATFORM_PERSISTENCE_KEYS.settings,
        { userId },
      );
      expect(settings).toMatchObject({
        ok: true,
        value: { volume: 0.5 },
        metadata: {
          migration: {
            sourceKey: 'gravity_well.settings.v1',
            status: 'copied',
            legacyRetained: true,
          },
        },
      });
      expect(platform.storage.getItem('gravity_well.settings.v1')).not.toBeNull();

      const profile = await platform.persistence.read<{ displayName: string }>(
        PLATFORM_PERSISTENCE_KEYS.profile,
        { userId },
      );
      expect(profile).toMatchObject({
        ok: true,
        value: { displayName: 'Pilot' },
        metadata: { migration: { status: 'copied', legacyRetained: true } },
      });
      platform.dispose?.();
    });
  });
}

describe('storage-backed asynchronous persistence', () => {
  test('rejects writes that exceed an adapter quota with actionable metadata', async () => {
    const storage = createTestStorage();
    const persistence = createStorageBackedPersistenceService(storage, {
      quotaProvider: async () => ({ usedBytes: 0, limitBytes: 128 }),
    });

    const result = await persistence.write('large-save', { value: 'x'.repeat(512) }, { userId: 'user-a' });
    expect(result).toMatchObject({
      ok: false,
      status: 'quota_exceeded',
      error: {
        code: 'quota_exceeded',
        operation: 'write',
        retryable: false,
        quota: { limitBytes: 128 },
      },
    });
  });

  test('recovers a complete pending replace intent before reading', async () => {
    const storage = createTestStorage();
    const persistence = createStorageBackedPersistenceService(storage);
    const initial = await persistence.write('settings', { volume: 0.25 }, { userId: 'user-a' });
    expect(initial.ok).toBe(true);
    if (!initial.ok) {
      return;
    }
    const storageKey = initial.metadata.storageKey;
    storage.removeItem(storageKey);
    const envelope = JSON.stringify({
      schemaVersion: PLATFORM_PERSISTENCE_ENVELOPE_SCHEMA,
      key: 'settings',
      userId: 'user-a',
      scope: 'local',
      revision: 'recovered-revision',
      updatedAt: '2026-07-20T12:00:00.000Z',
      value: { volume: 0.75 },
    });
    const intentKey = storage.listKeys?.().find((key) => key.includes('.intent.'));
    expect(intentKey).toBeUndefined();
    const encodedStorageKey = [...new TextEncoder().encode(storageKey)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const pendingIntentKey = `gravity_well.persistence.v2.intent.${encodedStorageKey}`;
    storage.setItem(pendingIntentKey, JSON.stringify({
      schemaVersion: PLATFORM_PERSISTENCE_WRITE_INTENT_SCHEMA,
      targetKey: storageKey,
      envelope,
    }));

    const recovered = await persistence.read<{ volume: number }>('settings', { userId: 'user-a' });
    expect(recovered).toMatchObject({
      ok: true,
      value: { volume: 0.75 },
      metadata: { revision: 'recovered-revision' },
    });
    expect(storage.getItem(pendingIntentKey)).toBeNull();
  });

  test('uses collision-safe namespaces for punctuated users and keys', async () => {
    const persistence = createStorageBackedPersistenceService(createTestStorage());
    await persistence.write('b.c', { owner: 'a' }, { userId: 'a' });
    await persistence.write('c', { owner: 'a.b' }, { userId: 'a.b' });

    await expect(persistence.read('b.c', { userId: 'a' })).resolves.toMatchObject({
      ok: true,
      value: { owner: 'a' },
    });
    await expect(persistence.read('c', { userId: 'a.b' })).resolves.toMatchObject({
      ok: true,
      value: { owner: 'a.b' },
    });
  });

  test('serialises competing create operations so one receives a conflict', async () => {
    const persistence = createStorageBackedPersistenceService(createTestStorage());
    const [first, second] = await Promise.all([
      persistence.write('profile', { slot: 1 }, { userId: 'user-a', expectedRevision: null }),
      persistence.write('profile', { slot: 2 }, { userId: 'user-a', expectedRevision: null }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['conflict', 'ok']);
  });

  test('reports user-scoped quota usage and supports revision-checked delete', async () => {
    const persistence = createStorageBackedPersistenceService(createTestStorage());
    const write = await persistence.write('profile', { ready: true }, { userId: 'user-a' });
    expect(write.ok).toBe(true);
    if (!write.ok) {
      return;
    }

    const quota = await persistence.getQuota({ userId: 'user-a' });
    expect(quota).toMatchObject({
      ok: true,
      quota: { source: 'estimated', userId: 'user-a' },
    });
    if (quota.ok) {
      expect(quota.quota.userUsedBytes).toBeGreaterThan(0);
    }

    const conflict = await persistence.delete('profile', {
      userId: 'user-a',
      expectedRevision: 'stale',
    });
    expect(conflict).toMatchObject({ ok: false, status: 'conflict' });
    const removed = await persistence.delete('profile', {
      userId: 'user-a',
      expectedRevision: write.metadata.revision,
    });
    expect(removed).toMatchObject({ ok: true, status: 'ok' });
    await expect(persistence.read('profile', { userId: 'user-a' })).resolves.toMatchObject({
      ok: false,
      status: 'not_found',
    });
  });
});
