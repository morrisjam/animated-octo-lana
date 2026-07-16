import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BALANCE_PROFILE_ID } from '../../../game-web/src/sim/balanceProfiles';
import {
  ROLLBACK_PROBE_BALANCE_PROFILE_ID,
  ROLLBACK_PROBE_RULESET_VERSION,
  createRollbackRankedQueueJoinBody,
  createRollbackProbeServerEnvironment,
} from './rollbackProbeContract';

test('builds the complete ranked matchmaking contract used by rollback probes', () => {
  assert.equal(ROLLBACK_PROBE_RULESET_VERSION, 'rollback-schema-compat.v1');
  assert.equal(ROLLBACK_PROBE_BALANCE_PROFILE_ID, DEFAULT_BALANCE_PROFILE_ID);
  assert.deepEqual(createRollbackRankedQueueJoinBody(' rollback-compat-before '), {
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
    buildVersion: 'rollback-compat-before',
    rulesetVersion: ROLLBACK_PROBE_RULESET_VERSION,
    balanceProfileId: ROLLBACK_PROBE_BALANCE_PROFILE_ID,
    platform: 'web',
    characterId: 'vanguard',
  });
});

test('rejects an empty rollback probe build version', () => {
  assert.throws(
    () => createRollbackRankedQueueJoinBody('  '),
    /requires a build version/,
  );
});

test('configures the rollback API to accept the probe ruleset', () => {
  assert.deepEqual(createRollbackProbeServerEnvironment(), {
    RANKED_SUPPORTED_RULESET_VERSIONS: ROLLBACK_PROBE_RULESET_VERSION,
  });
});
