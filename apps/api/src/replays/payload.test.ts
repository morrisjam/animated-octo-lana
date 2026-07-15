import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeReplayCanonicalDigestForArchive,
  type ReplayPayload,
  validateReplayPayloadForArchive,
} from './payload';

const TUNING = {
  chainWindowSeconds: 1,
  playerMoveAccel: 2,
  playerVelocityDamping: 3,
  actionRecoveryControlMultiplier: 4,
  helplessVelocityDamping: 5,
  helplessReleaseSpeedRatio: 6,
  boostHoldSpeed: 7,
  superBoostHoldSpeed: 8,
  superBoostSteerLerp: 9,
  superBoostVelocityBlend: 10,
  superBoostWaveAmplitude: 11,
  superBoostFuelMultiplier: 12,
  launchBasePower: 13,
  launchChainBonus: 14,
  launchInputInfluence: 15,
  launchHelplessSeconds: 16,
  startupClashGraceSeconds: 17,
  launchClashSeparationPadding: 18,
  launchClashRecoilMultiplier: 19,
  closeRangeSeparationPadding: 20,
  closeRangeSeparationImpulse: 21,
  closeRangeCommitSeparationMultiplier: 22,
  defensiveResetDistance: 23,
  defensiveResetImpulse: 24,
  launchBreakResetMultiplier: 25,
  naturalRecoveryResetMultiplier: 26,
  dunkRecoveryDurationSeconds: 27,
  dunkRecoveryMoveSpeed: 28,
  dunkRecoveryFuelFraction: 29,
};

function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entryValue]) => (
    `${JSON.stringify(key)}:${canonicalJson(entryValue)}`
  )).join(',')}}`;
}

function fingerprint(value: unknown): string {
  const canonical = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function input(moveX: number) {
  return {
    moveX,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

function canonicalOnlinePayload(): ReplayPayload & Record<string, unknown> {
  const payload = {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'alpha-build',
      seed: 123,
      loadout: { P1: 'vanguard', P2: 'duelist' },
      fixedDt: 1 / 60,
      advanceRngPerFrame: false,
      rules: { allowDunkWin: true },
      balanceTuning: { ...TUNING },
      characterBalanceOverrides: {},
      onlineMatch: {
        schemaVersion: 'gw.online-match-replay.v1',
        sessionId: '11111111-1111-4111-8111-111111111111',
        matchId: '22222222-2222-4222-8222-222222222222',
        balanceProfileId: 'default',
        tuningFingerprint: fingerprint(TUNING),
        characterRegistryFingerprint: 'gw.character-registry.v1:test',
        characterPackageVersions: { P1: '1.2.3', P2: '4.5.6' },
        stage: {
          id: 'wormhole_depths_v2',
          version: '2',
          fingerprint: 'stage:test',
        },
      },
      releaseIdentity: {
        balancePatch: 'alpha.7',
        retainedByArchiveValidator: true,
      },
    },
    inputTimeline: [
      { p1: input(1), p2: input(-1) },
      { p1: input(0.5), p2: input(-0.5) },
      { p1: input(-1), p2: input(1) },
    ],
    rounds: [
      {
        round: 1,
        label: 'Round 1',
        epoch: 0,
        seed: 123,
        startFrame: 0,
        endFrame: 1,
        initialChecksum: 100,
        finalChecksum: 102,
      },
      {
        round: 2,
        label: 'Round 2',
        epoch: 1,
        seed: 123,
        startFrame: 2,
        endFrame: 2,
        initialChecksum: 100,
        finalChecksum: 103,
        winner: 'P1',
      },
    ],
    expectedChecksums: [101, 102, 103],
    archiveExtension: {
      correlationId: 'complete-field-preservation',
    },
  } as unknown as ReplayPayload & Record<string, unknown>;
  payload.integrity = {
    schemaVersion: 'gw.replay-integrity.v1',
    algorithm: 'SHA-256',
    digest: computeReplayCanonicalDigestForArchive(payload),
  };
  return payload;
}

test('validates replay payload with versioned header', () => {
  const validation = validateReplayPayloadForArchive({
    header: {
      payloadVersion: 1,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
      seed: 1,
    },
    inputTimeline: [{ p1: { moveX: 1 }, p2: { moveX: -1 } }],
  });

  assert.equal(validation.ok, true);
  if (!validation.ok) {
    throw new Error('Expected valid replay payload');
  }
  assert.equal(validation.payload.header.payloadVersion, 1);
  assert.deepEqual(validation.payload.inputTimeline, [
    { p1: { moveX: 1 }, p2: { moveX: -1 } },
  ]);
});

test('returns explicit unsupported version error', () => {
  const validation = validateReplayPayloadForArchive({
    header: {
      payloadVersion: 999,
      rulesetVersion: 'prototype-2026.02',
      simBuildHash: 'dev-local',
    },
    inputTimeline: [],
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.errorCode, 'unsupported_payload_version');
});

test('preserves the complete canonical online payload as a detached JSON value', () => {
  const rawPayload = canonicalOnlinePayload();
  const expectedPayload = structuredClone(rawPayload);
  const validation = validateReplayPayloadForArchive(rawPayload);

  assert.equal(validation.ok, true);
  if (!validation.ok) {
    throw new Error(validation.errorMessage);
  }
  assert.deepEqual(validation.payload, expectedPayload);
  assert.notEqual(validation.payload, rawPayload);
  assert.notEqual(validation.payload.header, rawPayload.header);

  rawPayload.header.onlineMatch!.stage.id = 'mutated-after-validation';
  (rawPayload.inputTimeline[0] as { p1: { moveX: number } }).p1.moveX = -1;
  assert.equal(validation.payload.header.onlineMatch!.stage.id, 'wormhole_depths_v2');
  assert.equal(
    (validation.payload.inputTimeline[0] as { p1: { moveX: number } }).p1.moveX,
    1,
  );
  assert.deepEqual(
    (validation.payload as ReplayPayload & { archiveExtension: unknown }).archiveExtension,
    { correlationId: 'complete-field-preservation' },
  );
});

test('rejects canonical metadata tampering instead of archiving a different identity', () => {
  const payload = canonicalOnlinePayload();
  payload.header.onlineMatch!.stage.id = 'different-stage';

  const validation = validateReplayPayloadForArchive(payload);
  assert.equal(validation.ok, false);
  assert.equal(validation.errorCode, 'invalid_integrity');
});

test('rejects incomplete round coverage and checksum evidence', () => {
  const gap = canonicalOnlinePayload();
  (gap.rounds![1] as { startFrame: number }).startFrame = 1;
  gap.integrity!.digest = computeReplayCanonicalDigestForArchive(gap);
  const gapValidation = validateReplayPayloadForArchive(gap);
  assert.equal(gapValidation.ok, false);
  assert.equal(gapValidation.errorCode, 'invalid_rounds');

  const missingChecksum = canonicalOnlinePayload();
  missingChecksum.expectedChecksums!.pop();
  missingChecksum.integrity!.digest = computeReplayCanonicalDigestForArchive(missingChecksum);
  const checksumValidation = validateReplayPayloadForArchive(missingChecksum);
  assert.equal(checksumValidation.ok, false);
  assert.equal(checksumValidation.errorCode, 'invalid_rounds');
});

test('rejects tuning/profile fingerprint drift and non-JSON values', () => {
  const tuningDrift = canonicalOnlinePayload();
  (tuningDrift.header as unknown as { balanceTuning: typeof TUNING })
    .balanceTuning.playerMoveAccel += 1;
  tuningDrift.integrity!.digest = computeReplayCanonicalDigestForArchive(tuningDrift);
  const tuningValidation = validateReplayPayloadForArchive(tuningDrift);
  assert.equal(tuningValidation.ok, false);
  assert.equal(tuningValidation.errorCode, 'invalid_online_identity');

  const nonJson = canonicalOnlinePayload();
  nonJson.expectedChecksums![0] = Number.NaN;
  const nonJsonValidation = validateReplayPayloadForArchive(nonJson);
  assert.equal(nonJsonValidation.ok, false);
  assert.equal(nonJsonValidation.errorCode, 'invalid_payload');
});
