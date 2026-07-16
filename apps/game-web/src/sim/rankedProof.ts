import { resolveBalanceProfile } from './balanceProfiles';
import { computeStateChecksum } from './checksum';
import {
  CHARACTER_BY_ID,
  CHARACTER_REGISTRY_FINGERPRINT,
  type CharacterId,
} from './characters';
import { createInitialState, step } from './sim';
import { fingerprintGameTuning } from './tuning';
import type { FrameInput, PlayerFrameInput, PlayerId } from './types';

export const RANKED_MATCH_PROOF_SCHEMA_VERSION = 1;
export const RANKED_SIMULATOR_VERSION = 'gw.ranked-sim.v1';
export const RANKED_FIXED_DT = 1 / 60;
export const RANKED_ROUNDS_TO_WIN = 2;
export const RANKED_MAX_ROUNDS = 3;
export const RANKED_MAX_FRAMES_PER_ROUND = 60 * 180;
export const RANKED_MAX_TOTAL_FRAMES = RANKED_MAX_FRAMES_PER_ROUND * RANKED_MAX_ROUNDS;

const ACTION_BOOST = 1 << 0;
const ACTION_SUPER_BOOST = 1 << 1;
const ACTION_SPECIAL = 1 << 2;
const ACTION_LAUNCH = 1 << 3;
const ACTION_DUNK = 1 << 4;
const ACTION_PARRY = 1 << 5;
const ACTION_BREAK_LAUNCH = 1 << 6;
const MAX_ACTION_MASK = (1 << 7) - 1;

export type RankedMatchOutcome = 'p1_win' | 'p2_win';
export type RankedCompactInputFrame = [number, number, number, number, number, number];

export interface RankedMatchProofRound {
  epoch: number;
  winner: PlayerId;
  finalChecksum: number;
  inputs: RankedCompactInputFrame[];
}

export interface RankedMatchProof {
  schemaVersion: number;
  simulatorVersion: string;
  sessionId: string;
  matchId: string;
  buildVersion: string;
  rulesetVersion: string;
  balanceProfileId: string;
  tuningFingerprint: string;
  characterRegistryFingerprint: string;
  seed: number;
  fixedDt: number;
  loadout: Record<PlayerId, CharacterId>;
  rounds: RankedMatchProofRound[];
  claimedOutcome: RankedMatchOutcome;
}

export interface RankedMatchProofExpectation {
  sessionId: string;
  matchId: string;
  buildVersion: string;
  rulesetVersion: string;
  balanceProfileId: string;
  seed: number;
  loadout: Record<PlayerId, CharacterId>;
}

export type RankedMatchProofErrorCode =
  | 'invalid_payload'
  | 'unsupported_schema'
  | 'unsupported_simulator'
  | 'session_mismatch'
  | 'match_mismatch'
  | 'build_mismatch'
  | 'ruleset_mismatch'
  | 'unsupported_balance_profile'
  | 'tuning_mismatch'
  | 'character_registry_mismatch'
  | 'loadout_mismatch'
  | 'invalid_seed'
  | 'invalid_fixed_dt'
  | 'invalid_rounds'
  | 'invalid_input'
  | 'frame_budget_exceeded'
  | 'round_did_not_finish'
  | 'round_continued_after_finish'
  | 'round_winner_mismatch'
  | 'checksum_mismatch'
  | 'match_outcome_mismatch';

export interface RankedMatchProofFailure {
  ok: false;
  code: RankedMatchProofErrorCode;
  message: string;
}

export interface RankedMatchProofVerification {
  ok: true;
  proof: RankedMatchProof;
  proofDigest: string;
  derivedOutcome: RankedMatchOutcome;
  winnerSide: PlayerId;
  roundWins: Record<PlayerId, number>;
  roundCount: number;
  frameCount: number;
}

export type RankedMatchProofVerificationResult = RankedMatchProofVerification | RankedMatchProofFailure;

export interface RankedMatchProofRecorderOptions {
  sessionId: string;
  matchId: string;
  buildVersion: string;
  rulesetVersion: string;
  balanceProfileId: string;
  seed: number;
  loadout: Record<PlayerId, CharacterId>;
}

interface PendingRound {
  epoch: number;
  frames: Map<number, Partial<Record<PlayerId, PlayerFrameInput>>>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clonePlayerInput(input: PlayerFrameInput): PlayerFrameInput {
  return {
    moveX: input.moveX,
    moveY: input.moveY,
    boost: input.boost,
    superBoost: input.superBoost,
    special: input.special,
    launch: input.launch,
    dunk: input.dunk,
    parry: input.parry,
    breakLaunch: input.breakLaunch,
  };
}

function playerInputsEqual(first: PlayerFrameInput, second: PlayerFrameInput): boolean {
  return first.moveX === second.moveX
    && first.moveY === second.moveY
    && first.boost === second.boost
    && first.superBoost === second.superBoost
    && first.special === second.special
    && first.launch === second.launch
    && first.dunk === second.dunk
    && first.parry === second.parry
    && first.breakLaunch === second.breakLaunch;
}

function encodeActions(input: PlayerFrameInput): number {
  return (input.boost ? ACTION_BOOST : 0)
    | (input.superBoost ? ACTION_SUPER_BOOST : 0)
    | (input.special ? ACTION_SPECIAL : 0)
    | (input.launch ? ACTION_LAUNCH : 0)
    | (input.dunk ? ACTION_DUNK : 0)
    | (input.parry ? ACTION_PARRY : 0)
    | (input.breakLaunch ? ACTION_BREAK_LAUNCH : 0);
}

function decodePlayerInput(moveX: number, moveY: number, actions: number): PlayerFrameInput {
  return {
    moveX,
    moveY,
    boost: (actions & ACTION_BOOST) !== 0,
    superBoost: (actions & ACTION_SUPER_BOOST) !== 0,
    special: (actions & ACTION_SPECIAL) !== 0,
    launch: (actions & ACTION_LAUNCH) !== 0,
    dunk: (actions & ACTION_DUNK) !== 0,
    parry: (actions & ACTION_PARRY) !== 0,
    breakLaunch: (actions & ACTION_BREAK_LAUNCH) !== 0,
  };
}

export function encodeRankedInputFrame(input: FrameInput): RankedCompactInputFrame {
  return [
    input.p1.moveX,
    input.p1.moveY,
    encodeActions(input.p1),
    input.p2.moveX,
    input.p2.moveY,
    encodeActions(input.p2),
  ];
}

export function decodeRankedInputFrame(input: RankedCompactInputFrame): FrameInput {
  return {
    p1: decodePlayerInput(input[0], input[1], input[2]),
    p2: decodePlayerInput(input[3], input[4], input[5]),
  };
}

function parseCompactInputFrame(raw: unknown): RankedCompactInputFrame | null {
  if (!Array.isArray(raw) || raw.length !== 6) {
    return null;
  }
  if (!raw.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  const values = raw as number[];
  const [p1X, p1Y, p1Actions, p2X, p2Y, p2Actions] = values;
  if (
    p1X < -1 || p1X > 1
    || p1Y < -1 || p1Y > 1
    || p2X < -1 || p2X > 1
    || p2Y < -1 || p2Y > 1
    || !Number.isInteger(p1Actions)
    || !Number.isInteger(p2Actions)
    || p1Actions < 0
    || p2Actions < 0
    || p1Actions > MAX_ACTION_MASK
    || p2Actions > MAX_ACTION_MASK
  ) {
    return null;
  }
  return [p1X, p1Y, p1Actions, p2X, p2Y, p2Actions];
}

function parsePlayerId(value: unknown): PlayerId | null {
  return value === 'P1' || value === 'P2' ? value : null;
}

function parseCharacterId(value: unknown): CharacterId | null {
  if (typeof value !== 'string' || !CHARACTER_BY_ID[value]) {
    return null;
  }
  return value;
}

function parseOutcome(value: unknown): RankedMatchOutcome | null {
  return value === 'p1_win' || value === 'p2_win' ? value : null;
}

function fail(code: RankedMatchProofErrorCode, message: string): RankedMatchProofFailure {
  return { ok: false, code, message };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function digestRankedMatchProof(proof: RankedMatchProof): Promise<string> {
  return await sha256Hex(canonicalJson(proof));
}

export function getRankedTuningFingerprint(balanceProfileId: string): string | null {
  const profile = resolveBalanceProfile(balanceProfileId);
  if (profile.id !== balanceProfileId) {
    return null;
  }
  return fingerprintGameTuning(profile.tuning);
}

export function rankedSeedFromSessionId(sessionId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function parseProof(raw: unknown): RankedMatchProof | RankedMatchProofFailure {
  if (!isObjectRecord(raw)) {
    return fail('invalid_payload', 'Ranked match proof must be a JSON object.');
  }
  if (raw.schemaVersion !== RANKED_MATCH_PROOF_SCHEMA_VERSION) {
    return fail('unsupported_schema', `Ranked proof schema ${String(raw.schemaVersion)} is unsupported.`);
  }
  if (raw.simulatorVersion !== RANKED_SIMULATOR_VERSION) {
    return fail('unsupported_simulator', `Ranked simulator ${String(raw.simulatorVersion)} is unsupported.`);
  }
  const requiredStrings = [
    'sessionId',
    'matchId',
    'buildVersion',
    'rulesetVersion',
    'balanceProfileId',
    'tuningFingerprint',
    'characterRegistryFingerprint',
  ] as const;
  for (const key of requiredStrings) {
    if (typeof raw[key] !== 'string' || raw[key].trim().length === 0) {
      return fail('invalid_payload', `Ranked proof ${key} is required.`);
    }
  }
  if (typeof raw.seed !== 'number' || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 0xffffffff) {
    return fail('invalid_seed', 'Ranked proof seed must be an unsigned 32-bit integer.');
  }
  const seed = raw.seed;
  if (typeof raw.fixedDt !== 'number' || !Number.isFinite(raw.fixedDt) || Math.abs(raw.fixedDt - RANKED_FIXED_DT) > Number.EPSILON) {
    return fail('invalid_fixed_dt', `Ranked proof fixedDt must be exactly ${RANKED_FIXED_DT}.`);
  }
  const fixedDt = raw.fixedDt;
  if (!isObjectRecord(raw.loadout)) {
    return fail('loadout_mismatch', 'Ranked proof loadout is required.');
  }
  const p1Character = parseCharacterId(raw.loadout.P1);
  const p2Character = parseCharacterId(raw.loadout.P2);
  if (!p1Character || !p2Character) {
    return fail('loadout_mismatch', 'Ranked proof loadout contains an unsupported character.');
  }
  const claimedOutcome = parseOutcome(raw.claimedOutcome);
  if (!claimedOutcome) {
    return fail('match_outcome_mismatch', 'Ranked proof claimedOutcome must be p1_win or p2_win.');
  }
  if (!Array.isArray(raw.rounds) || raw.rounds.length < RANKED_ROUNDS_TO_WIN || raw.rounds.length > RANKED_MAX_ROUNDS) {
    return fail('invalid_rounds', `Ranked proof must contain ${RANKED_ROUNDS_TO_WIN}-${RANKED_MAX_ROUNDS} rounds.`);
  }
  const rounds: RankedMatchProofRound[] = [];
  let totalFrames = 0;
  for (let index = 0; index < raw.rounds.length; index += 1) {
    const roundRaw = raw.rounds[index];
    if (!isObjectRecord(roundRaw) || roundRaw.epoch !== index) {
      return fail('invalid_rounds', `Ranked proof round ${index + 1} must use epoch ${index}.`);
    }
    const winner = parsePlayerId(roundRaw.winner);
    if (!winner) {
      return fail('invalid_rounds', `Ranked proof round ${index + 1} has an invalid winner.`);
    }
    if (
      typeof roundRaw.finalChecksum !== 'number'
      || !Number.isInteger(roundRaw.finalChecksum)
      || roundRaw.finalChecksum < 0
      || roundRaw.finalChecksum > 0xffffffff
    ) {
      return fail('invalid_rounds', `Ranked proof round ${index + 1} has an invalid final checksum.`);
    }
    const finalChecksum = roundRaw.finalChecksum;
    if (!Array.isArray(roundRaw.inputs) || roundRaw.inputs.length === 0) {
      return fail('invalid_rounds', `Ranked proof round ${index + 1} has no inputs.`);
    }
    if (roundRaw.inputs.length > RANKED_MAX_FRAMES_PER_ROUND) {
      return fail('frame_budget_exceeded', `Ranked proof round ${index + 1} exceeds the frame budget.`);
    }
    const inputs: RankedCompactInputFrame[] = [];
    for (let frame = 0; frame < roundRaw.inputs.length; frame += 1) {
      const parsed = parseCompactInputFrame(roundRaw.inputs[frame]);
      if (!parsed) {
        return fail('invalid_input', `Ranked proof round ${index + 1}, frame ${frame} is invalid.`);
      }
      inputs.push(parsed);
    }
    totalFrames += inputs.length;
    if (totalFrames > RANKED_MAX_TOTAL_FRAMES) {
      return fail('frame_budget_exceeded', 'Ranked proof exceeds the total frame budget.');
    }
    rounds.push({ epoch: index, winner, finalChecksum, inputs });
  }

  return {
    schemaVersion: RANKED_MATCH_PROOF_SCHEMA_VERSION,
    simulatorVersion: RANKED_SIMULATOR_VERSION,
    sessionId: String(raw.sessionId).trim(),
    matchId: String(raw.matchId).trim(),
    buildVersion: String(raw.buildVersion).trim(),
    rulesetVersion: String(raw.rulesetVersion).trim(),
    balanceProfileId: String(raw.balanceProfileId).trim(),
    tuningFingerprint: String(raw.tuningFingerprint).trim(),
    characterRegistryFingerprint: String(raw.characterRegistryFingerprint).trim(),
    seed,
    fixedDt,
    loadout: { P1: p1Character, P2: p2Character },
    rounds,
    claimedOutcome,
  };
}

export async function verifyRankedMatchProof(
  rawProof: unknown,
  expectation: RankedMatchProofExpectation,
): Promise<RankedMatchProofVerificationResult> {
  const parsed = parseProof(rawProof);
  if ('ok' in parsed && parsed.ok === false) {
    return parsed;
  }
  const proof = parsed as RankedMatchProof;
  if (proof.sessionId !== expectation.sessionId) {
    return fail('session_mismatch', 'Ranked proof sessionId does not match the matchmaking session.');
  }
  if (proof.matchId !== expectation.matchId) {
    return fail('match_mismatch', 'Ranked proof matchId does not match the submitted match.');
  }
  if (proof.buildVersion !== expectation.buildVersion) {
    return fail('build_mismatch', 'Ranked proof buildVersion does not match the matchmaking session.');
  }
  if (proof.rulesetVersion !== expectation.rulesetVersion) {
    return fail('ruleset_mismatch', 'Ranked proof rulesetVersion does not match the matchmaking session.');
  }
  if (proof.balanceProfileId !== expectation.balanceProfileId) {
    return fail('unsupported_balance_profile', 'Ranked proof balance profile does not match the matchmaking session.');
  }
  if (proof.seed !== (expectation.seed >>> 0)) {
    return fail('invalid_seed', 'Ranked proof seed does not match the matchmaking session.');
  }
  if (
    proof.loadout.P1 !== expectation.loadout.P1
    || proof.loadout.P2 !== expectation.loadout.P2
  ) {
    return fail('loadout_mismatch', 'Ranked proof loadout does not match the matchmaking session.');
  }
  if (proof.characterRegistryFingerprint !== CHARACTER_REGISTRY_FINGERPRINT) {
    return fail('character_registry_mismatch', 'Ranked proof character registry is unsupported by this verifier.');
  }
  const profile = resolveBalanceProfile(proof.balanceProfileId);
  if (profile.id !== proof.balanceProfileId) {
    return fail('unsupported_balance_profile', `Balance profile ${proof.balanceProfileId} is unsupported.`);
  }
  const expectedTuningFingerprint = fingerprintGameTuning(profile.tuning);
  if (proof.tuningFingerprint !== expectedTuningFingerprint) {
    return fail('tuning_mismatch', 'Ranked proof tuning fingerprint does not match the selected profile.');
  }

  const roundWins: Record<PlayerId, number> = { P1: 0, P2: 0 };
  let totalFrames = 0;
  for (let roundIndex = 0; roundIndex < proof.rounds.length; roundIndex += 1) {
    const round = proof.rounds[roundIndex];
    const state = createInitialState({
      seed: proof.seed,
      loadout: proof.loadout,
      rules: { allowDunkWin: true },
    });
    state.tuning = { ...profile.tuning };
    let firstWinnerFrame: number | null = null;
    for (let frame = 0; frame < round.inputs.length; frame += 1) {
      step(state, decodeRankedInputFrame(round.inputs[frame]), proof.fixedDt);
      if (state.winner && firstWinnerFrame === null) {
        firstWinnerFrame = frame;
      }
    }
    totalFrames += round.inputs.length;
    if (!state.winner || firstWinnerFrame === null) {
      return fail('round_did_not_finish', `Ranked proof round ${roundIndex + 1} did not produce a winner.`);
    }
    if (firstWinnerFrame !== round.inputs.length - 1) {
      return fail('round_continued_after_finish', `Ranked proof round ${roundIndex + 1} continued after its winning frame.`);
    }
    if (state.winner !== round.winner) {
      return fail('round_winner_mismatch', `Ranked proof round ${roundIndex + 1} winner does not match replayed state.`);
    }
    const checksum = computeStateChecksum(state);
    if (checksum !== round.finalChecksum) {
      return fail('checksum_mismatch', `Ranked proof round ${roundIndex + 1} final checksum does not match replayed state.`);
    }
    roundWins[state.winner] += 1;
    if (roundWins[state.winner] >= RANKED_ROUNDS_TO_WIN && roundIndex !== proof.rounds.length - 1) {
      return fail('invalid_rounds', 'Ranked proof contains rounds after the match was already won.');
    }
  }

  const winnerSide = roundWins.P1 >= RANKED_ROUNDS_TO_WIN
    ? 'P1'
    : roundWins.P2 >= RANKED_ROUNDS_TO_WIN
      ? 'P2'
      : null;
  if (!winnerSide) {
    return fail('match_outcome_mismatch', 'Ranked proof does not contain enough round wins to settle the match.');
  }
  const derivedOutcome: RankedMatchOutcome = winnerSide === 'P1' ? 'p1_win' : 'p2_win';
  if (proof.claimedOutcome !== derivedOutcome) {
    return fail('match_outcome_mismatch', 'Ranked proof claimed outcome does not match the replayed match.');
  }

  return {
    ok: true,
    proof,
    proofDigest: await digestRankedMatchProof(proof),
    derivedOutcome,
    winnerSide,
    roundWins,
    roundCount: proof.rounds.length,
    frameCount: totalFrames,
  };
}

export class RankedMatchProofRecorder {
  private readonly options: RankedMatchProofRecorderOptions;

  private pendingRound: PendingRound | null = null;

  private readonly rounds: RankedMatchProofRound[] = [];

  public constructor(options: RankedMatchProofRecorderOptions) {
    this.options = {
      ...options,
      loadout: { ...options.loadout },
    };
  }

  public startRound(epoch: number): void {
    if (!Number.isInteger(epoch) || epoch !== this.rounds.length) {
      throw new Error(`Ranked proof epoch ${epoch} is invalid; expected ${this.rounds.length}.`);
    }
    if (this.pendingRound) {
      throw new Error(`Ranked proof epoch ${this.pendingRound.epoch} has not been finalized.`);
    }
    this.pendingRound = { epoch, frames: new Map() };
  }

  public recordInput(epoch: number, frame: number, playerId: PlayerId, input: PlayerFrameInput): void {
    const round = this.pendingRound;
    if (!round || round.epoch !== epoch) {
      throw new Error(`Ranked proof input targets inactive epoch ${epoch}.`);
    }
    if (!Number.isInteger(frame) || frame < 0 || frame >= RANKED_MAX_FRAMES_PER_ROUND) {
      throw new Error(`Ranked proof frame ${frame} is outside the allowed range.`);
    }
    const players = round.frames.get(frame) ?? {};
    const existing = players[playerId];
    if (existing && !playerInputsEqual(existing, input)) {
      throw new Error(`Ranked proof input changed for epoch ${epoch}, frame ${frame}, ${playerId}.`);
    }
    players[playerId] = clonePlayerInput(input);
    round.frames.set(frame, players);
  }

  public finalizeRound(
    epoch: number,
    finalFrame: number,
    winner: PlayerId,
    finalChecksum: number,
  ): RankedMatchProofRound {
    const round = this.pendingRound;
    if (!round || round.epoch !== epoch) {
      throw new Error(`Ranked proof cannot finalize inactive epoch ${epoch}.`);
    }
    if (!Number.isInteger(finalFrame) || finalFrame < 0 || finalFrame >= RANKED_MAX_FRAMES_PER_ROUND) {
      throw new Error(`Ranked proof final frame ${finalFrame} is outside the allowed range.`);
    }
    const inputs: RankedCompactInputFrame[] = [];
    for (let frame = 0; frame <= finalFrame; frame += 1) {
      const players = round.frames.get(frame);
      if (!players?.P1 || !players.P2) {
        throw new Error(`Ranked proof is missing authoritative input at epoch ${epoch}, frame ${frame}.`);
      }
      inputs.push(encodeRankedInputFrame({ p1: players.P1, p2: players.P2 }));
    }
    const finalized: RankedMatchProofRound = {
      epoch,
      winner,
      finalChecksum: finalChecksum >>> 0,
      inputs,
    };
    this.rounds.push(finalized);
    this.pendingRound = null;
    return finalized;
  }

  public buildProof(claimedOutcome: RankedMatchOutcome): RankedMatchProof {
    if (this.pendingRound) {
      throw new Error(`Ranked proof epoch ${this.pendingRound.epoch} has not been finalized.`);
    }
    const tuningFingerprint = getRankedTuningFingerprint(this.options.balanceProfileId);
    if (!tuningFingerprint) {
      throw new Error(`Unsupported ranked balance profile ${this.options.balanceProfileId}.`);
    }
    return {
      schemaVersion: RANKED_MATCH_PROOF_SCHEMA_VERSION,
      simulatorVersion: RANKED_SIMULATOR_VERSION,
      sessionId: this.options.sessionId,
      matchId: this.options.matchId,
      buildVersion: this.options.buildVersion,
      rulesetVersion: this.options.rulesetVersion,
      balanceProfileId: this.options.balanceProfileId,
      tuningFingerprint,
      characterRegistryFingerprint: CHARACTER_REGISTRY_FINGERPRINT,
      seed: this.options.seed >>> 0,
      fixedDt: RANKED_FIXED_DT,
      loadout: { ...this.options.loadout },
      rounds: this.rounds.map((round) => ({
        ...round,
        inputs: round.inputs.map((input) => [...input] as RankedCompactInputFrame),
      })),
      claimedOutcome,
    };
  }
}
