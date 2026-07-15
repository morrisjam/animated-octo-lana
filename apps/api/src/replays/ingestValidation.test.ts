import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchSessionView } from '../matchmaking/queueService';
import type { ReplayPayload } from './payload';
import {
  digestRankedMatchProof,
  encodeRankedInputFrame,
  RANKED_MATCH_PROOF_SCHEMA_VERSION,
  RANKED_SIMULATOR_VERSION,
  type RankedMatchProof,
} from '../../../game-web/src/sim/rankedProof';
import type { FrameInput, PlayerFrameInput } from '../../../game-web/src/sim/types';
import {
  compareReplayArchiveIdentity,
  DEFAULT_REPLAY_INGEST_BODY_LIMIT_BYTES,
  deriveCanonicalReplayResult,
  type CanonicalReplayBindingInput,
  type ReplayArchiveIdentity,
  resolveReplayIngestBodyLimitBytes,
  validateCanonicalReplayBinding,
  validateRankedReplayProofBinding,
  validateRankedReplaySettlement,
} from './ingestValidation';

const P1_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const P2_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';

test('uses a bounded replay-specific request body limit', () => {
  assert.equal(resolveReplayIngestBodyLimitBytes(undefined), DEFAULT_REPLAY_INGEST_BODY_LIMIT_BYTES);
  assert.equal(resolveReplayIngestBodyLimitBytes('16777216'), 16 * 1024 * 1024);
  assert.throws(() => resolveReplayIngestBodyLimitBytes('1024'), /1048576/);
  assert.throws(() => resolveReplayIngestBodyLimitBytes('unbounded'), /1048576/);
});

function createPayload(): ReplayPayload {
  return {
    header: {
      payloadVersion: 1,
      rulesetVersion: 'alpha-rules',
      simBuildHash: 'alpha-build',
      loadout: { P1: 'vanguard', P2: 'duelist' },
      onlineMatch: {
        schemaVersion: 'gw.online-match-replay.v1',
        sessionId: MATCH_ID,
        matchId: MATCH_ID,
        balanceProfileId: 'default',
        tuningFingerprint: 'fnv1a32:12345678',
        characterRegistryFingerprint: 'registry:test',
        characterPackageVersions: { P1: '1.0.0', P2: '1.0.0' },
        stage: { id: 'wormhole' },
      },
    },
    inputTimeline: [{}, {}],
    rounds: [
      { round: 1, epoch: 0, startFrame: 0, endFrame: 0, winner: 'P1' },
      { round: 2, epoch: 1, startFrame: 1, endFrame: 1, winner: 'P1' },
    ],
  };
}

function createSession(): MatchSessionView {
  return {
    sessionId: MATCH_ID,
    queueType: 'ranked',
    region: 'eu-west',
    buildVersion: 'alpha-build',
    rulesetVersion: 'alpha-rules',
    balanceProfileId: 'default',
    status: 'resolved',
    resolvedReason: 'completed',
    createdAt: '2026-07-14T12:00:00.000Z',
    expiresAt: '2026-07-14T13:00:00.000Z',
    reconnectGraceSeconds: 20,
    transportAttempt: {
      attemptId: '44444444-4444-4444-8444-444444444444',
      generation: 1,
      createdAt: '2026-07-14T12:00:00.000Z',
    },
    participants: [
      {
        accountId: P1_ACCOUNT_ID,
        queueTicketId: '55555555-5555-4555-8555-555555555555',
        side: 'P1',
        selectedCharacterId: 'vanguard',
        connectionStatus: 'connected',
        lastHeartbeatAt: '2026-07-14T12:01:00.000Z',
      },
      {
        accountId: P2_ACCOUNT_ID,
        queueTicketId: '66666666-6666-4666-8666-666666666666',
        side: 'P2',
        selectedCharacterId: 'duelist',
        connectionStatus: 'connected',
        lastHeartbeatAt: '2026-07-14T12:01:00.000Z',
      },
    ],
  };
}

function createBinding(): CanonicalReplayBindingInput {
  return {
    accountId: P1_ACCOUNT_ID,
    matchId: MATCH_ID,
    queueType: 'ranked',
    matchType: 'ranked',
    region: 'eu-west',
    outcome: 'p1_win',
    winnerAccountId: P1_ACCOUNT_ID,
    participants: [
      { accountId: P1_ACCOUNT_ID, side: 'P1', characterId: 'vanguard', result: 'win' },
      { accountId: P2_ACCOUNT_ID, side: 'P2', characterId: 'duelist', result: 'loss' },
    ],
    payload: createPayload(),
    session: createSession(),
  };
}

test('binds a completed canonical replay to its matchmaking handoff', () => {
  const result = validateCanonicalReplayBinding(createBinding());
  assert.deepEqual(result, {
    ok: true,
    value: {
      outcome: 'p1_win',
      winnerSide: 'P1',
      roundCount: 2,
      frameCount: 2,
    },
  });
});

test('rejects unfinished loops and participant metadata that disagree with the replay', () => {
  const unfinished = createPayload();
  unfinished.rounds = [
    { round: 1, epoch: 0, startFrame: 0, endFrame: 0, winner: 'P1' },
    { round: 2, epoch: 1, startFrame: 1, endFrame: 1, winner: 'P2' },
  ];
  assert.equal(deriveCanonicalReplayResult(unfinished).ok, false);

  const mismatched = createBinding();
  mismatched.participants[0].characterId = 'duelist';
  const result = validateCanonicalReplayBinding(mismatched);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /matchmaking handoff/);
  }
});

test('requires ranked replay dimensions and outcome to match the verified proof', () => {
  const binding = createBinding();
  const replayResult = deriveCanonicalReplayResult(binding.payload);
  assert.equal(replayResult.ok, true);
  if (!replayResult.ok) {
    throw new Error(replayResult.error);
  }
  const settlement = {
    matchId: MATCH_ID,
    sessionId: MATCH_ID,
    outcome: 'p1_win',
    winnerAccountId: P1_ACCOUNT_ID,
    settlementSource: 'player_consensus',
    p1AccountId: P1_ACCOUNT_ID,
    p2AccountId: P2_ACCOUNT_ID,
    proofRoundCount: 2,
    proofFrameCount: 2,
    proofDerivedOutcome: 'p1_win',
  };
  assert.equal(validateRankedReplaySettlement(binding, replayResult.value, settlement).ok, true);
  assert.equal(validateRankedReplaySettlement(
    binding,
    replayResult.value,
    { ...settlement, proofFrameCount: 3 },
  ).ok, false);
});

function createPlayerInput(overrides: Partial<PlayerFrameInput> = {}): PlayerFrameInput {
  return {
    moveX: 0,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch: false,
    dunk: false,
    parry: false,
    breakLaunch: false,
    ...overrides,
  };
}

async function createProofBoundFixture(): Promise<{
  payload: ReplayPayload;
  proof: RankedMatchProof;
  proofDigest: string;
}> {
  const payload = createPayload();
  payload.header.seed = 1234;
  payload.header.fixedDt = 1 / 60;
  payload.inputTimeline = [
    { p1: createPlayerInput({ moveX: 0.25 }), p2: createPlayerInput({ parry: true }) },
    { p1: createPlayerInput({ launch: true }), p2: createPlayerInput({ moveY: -0.5 }) },
  ];
  payload.rounds = [
    { round: 1, epoch: 0, startFrame: 0, endFrame: 0, finalChecksum: 101, winner: 'P1' },
    { round: 2, epoch: 1, startFrame: 1, endFrame: 1, finalChecksum: 202, winner: 'P1' },
  ];
  const identity = payload.header.onlineMatch;
  if (!identity || !payload.header.loadout) {
    throw new Error('Fixture requires canonical identity and loadout.');
  }
  const proof: RankedMatchProof = {
    schemaVersion: RANKED_MATCH_PROOF_SCHEMA_VERSION,
    simulatorVersion: RANKED_SIMULATOR_VERSION,
    sessionId: identity.sessionId,
    matchId: identity.matchId,
    buildVersion: payload.header.simBuildHash,
    rulesetVersion: payload.header.rulesetVersion,
    balanceProfileId: identity.balanceProfileId,
    tuningFingerprint: identity.tuningFingerprint,
    characterRegistryFingerprint: identity.characterRegistryFingerprint,
    seed: payload.header.seed,
    fixedDt: payload.header.fixedDt,
    loadout: {
      P1: payload.header.loadout.P1 as RankedMatchProof['loadout']['P1'],
      P2: payload.header.loadout.P2 as RankedMatchProof['loadout']['P2'],
    },
    rounds: payload.rounds.map((round, index) => ({
      epoch: round.epoch as number,
      winner: round.winner as 'P1',
      finalChecksum: round.finalChecksum as number,
      inputs: [encodeRankedInputFrame(payload.inputTimeline[index] as FrameInput)],
    })),
    claimedOutcome: 'p1_win',
  };
  return { payload, proof, proofDigest: await digestRankedMatchProof(proof) };
}

test('binds every canonical ranked replay input and deterministic setting to the settled proof', async () => {
  const fixture = await createProofBoundFixture();
  const replayResult = deriveCanonicalReplayResult(fixture.payload);
  assert.equal(replayResult.ok, true);
  if (!replayResult.ok) {
    throw new Error(replayResult.error);
  }
  assert.equal((await validateRankedReplayProofBinding(
    fixture.payload,
    replayResult.value,
    { proofDigest: fixture.proofDigest, proofPayload: fixture.proof },
  )).ok, true);

  const differentReplay = structuredClone(fixture.payload);
  const firstFrame = differentReplay.inputTimeline[0] as FrameInput;
  firstFrame.p1.moveX = -0.25;
  const mismatch = await validateRankedReplayProofBinding(
    differentReplay,
    replayResult.value,
    { proofDigest: fixture.proofDigest, proofPayload: fixture.proof },
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.match(mismatch.error, /input 0/);
  }
});

test('rejects ranked replay configuration drift and a proof payload with the wrong digest', async () => {
  const fixture = await createProofBoundFixture();
  const replayResult = deriveCanonicalReplayResult(fixture.payload);
  assert.equal(replayResult.ok, true);
  if (!replayResult.ok) {
    throw new Error(replayResult.error);
  }

  const differentConfiguration = structuredClone(fixture.payload);
  differentConfiguration.header.seed = 9999;
  const configMismatch = await validateRankedReplayProofBinding(
    differentConfiguration,
    replayResult.value,
    { proofDigest: fixture.proofDigest, proofPayload: fixture.proof },
  );
  assert.equal(configMismatch.ok, false);
  if (!configMismatch.ok) {
    assert.match(configMismatch.error, /deterministic configuration/);
  }

  const digestMismatch = await validateRankedReplayProofBinding(
    fixture.payload,
    replayResult.value,
    { proofDigest: '0'.repeat(64), proofPayload: fixture.proof },
  );
  assert.equal(digestMismatch.ok, false);
  if (!digestMismatch.ok) {
    assert.match(digestMismatch.error, /proof digest/);
  }
});

test('accepts idempotent peer metadata only when canonical identity is unchanged', () => {
  const binding = createBinding();
  const identity: ReplayArchiveIdentity = {
    queueType: binding.queueType,
    matchType: binding.matchType,
    region: binding.region,
    patchVersion: 'alpha-build',
    rulesetVersion: binding.payload.header.rulesetVersion,
    simBuildHash: binding.payload.header.simBuildHash,
    outcome: binding.outcome,
    winnerAccountId: binding.winnerAccountId,
    payloadDigest: 'abc123',
    participants: binding.participants,
  };
  assert.equal(compareReplayArchiveIdentity(identity, structuredClone(identity)).ok, true);
  assert.equal(compareReplayArchiveIdentity(
    identity,
    { ...structuredClone(identity), payloadDigest: 'different' },
  ).ok, false);
});
