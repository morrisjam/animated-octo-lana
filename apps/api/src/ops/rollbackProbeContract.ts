import { DEFAULT_BALANCE_PROFILE_ID } from '../../../game-web/src/sim/balanceProfiles';

export const ROLLBACK_PROBE_RULESET_VERSION = 'rollback-schema-compat.v1';
export const ROLLBACK_PROBE_BALANCE_PROFILE_ID = DEFAULT_BALANCE_PROFILE_ID;

export interface RollbackProbeServerEnvironment {
  RANKED_SUPPORTED_RULESET_VERSIONS: string;
}

export interface RollbackRankedQueueJoinBody {
  queueType: 'ranked';
  regionPreferences: string[];
  buildVersion: string;
  rulesetVersion: string;
  balanceProfileId: string;
  platform: 'web';
  characterId: 'vanguard';
}

export function createRollbackRankedQueueJoinBody(
  buildVersionInput: string,
): RollbackRankedQueueJoinBody {
  const buildVersion = buildVersionInput.trim();
  if (!buildVersion) {
    throw new Error('Rollback ranked queue probe requires a build version.');
  }
  return {
    queueType: 'ranked',
    regionPreferences: ['eu-west'],
    buildVersion,
    rulesetVersion: ROLLBACK_PROBE_RULESET_VERSION,
    balanceProfileId: ROLLBACK_PROBE_BALANCE_PROFILE_ID,
    platform: 'web',
    characterId: 'vanguard',
  };
}

export function createRollbackProbeServerEnvironment(): RollbackProbeServerEnvironment {
  return {
    RANKED_SUPPORTED_RULESET_VERSIONS: ROLLBACK_PROBE_RULESET_VERSION,
  };
}
