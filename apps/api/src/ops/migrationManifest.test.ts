import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMigrationFileManifest } from './migrationManifest';

test('loads the exact ordered migration manifest shipped with the API', async () => {
  const manifest = await loadMigrationFileManifest();

  assert.equal(manifest.length, 32);
  assert.equal(manifest[0]?.filename, '001_identity_and_profile.sql');
  assert.equal(manifest.at(-1)?.filename, '032_steam_ticket_exchange_replay_guard.sql');
  assert.equal(manifest.every(({ checksum }) => /^[0-9a-f]{64}$/.test(checksum)), true);
});
