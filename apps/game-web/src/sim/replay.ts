import type { CharacterId } from './characters';
import { computeStateChecksum } from './checksum';
import { createInitialState, nextDeterministicRandom, step } from './sim';
import type { FrameInput, PlayerFrameInput } from './types';

export const REPLAY_PAYLOAD_VERSION = 1;
const DEFAULT_FIXED_DT = 1 / 60;

export interface ReplayHeader {
  payloadVersion: number;
  rulesetVersion: string;
  simBuildHash: string;
  seed?: number;
  loadout?: {
    P1?: CharacterId;
    P2?: CharacterId;
  };
  fixedDt?: number;
  advanceRngPerFrame?: boolean;
}

export interface ReplayPayload {
  header: ReplayHeader;
  inputTimeline: Array<Partial<FrameInput>>;
  rounds?: ReplayRoundDescriptor[];
  expectedChecksums?: number[];
}

export interface ReplayRoundDescriptor {
  round?: number;
  label?: string;
  startFrame: number;
  endFrame?: number;
}

export interface ReplayResult {
  checksums: number[];
}

export interface ChecksumMismatch {
  frame: number;
  actual: number;
  expected: number;
}

export type ReplayValidationErrorCode =
  | 'invalid_payload'
  | 'missing_header'
  | 'unsupported_payload_version'
  | 'invalid_header'
  | 'missing_input_timeline';

export interface ReplayValidationError {
  code: ReplayValidationErrorCode;
  message: string;
}

export type ReplayValidationResult =
  | { ok: true; payload: ReplayPayload }
  | { ok: false; error: ReplayValidationError };

function normalisePlayerInput(input: Partial<PlayerFrameInput> | undefined): PlayerFrameInput {
  const legacyShotInput = input as Partial<PlayerFrameInput> & { shot?: boolean };
  return {
    moveX: Number.isFinite(input?.moveX) ? Number(input?.moveX) : 0,
    moveY: Number.isFinite(input?.moveY) ? Number(input?.moveY) : 0,
    boost: Boolean(input?.boost),
    superBoost: Boolean(input?.superBoost),
    special: Boolean(input?.special) || Boolean(legacyShotInput?.shot),
    launch: Boolean(input?.launch),
    dunk: Boolean(input?.dunk),
    parry: Boolean(input?.parry),
    breakLaunch: Boolean(input?.breakLaunch),
  };
}

function normaliseFrameInput(input: Partial<FrameInput> | undefined): FrameInput {
  return {
    p1: normalisePlayerInput(input?.p1),
    p2: normalisePlayerInput(input?.p2),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateHeader(header: unknown): ReplayValidationResult {
  if (!isObjectRecord(header)) {
    return {
      ok: false,
      error: {
        code: 'missing_header',
        message: 'Replay payload is missing a valid header object.',
      },
    };
  }

  const payloadVersion = Number(header.payloadVersion);
  if (!Number.isFinite(payloadVersion)) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header payloadVersion must be a number.',
      },
    };
  }
  if (payloadVersion !== REPLAY_PAYLOAD_VERSION) {
    return {
      ok: false,
      error: {
        code: 'unsupported_payload_version',
        message: `Replay payloadVersion ${payloadVersion} is unsupported. Expected ${REPLAY_PAYLOAD_VERSION}.`,
      },
    };
  }

  const rulesetVersion = String(header.rulesetVersion ?? '').trim();
  if (!rulesetVersion) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header rulesetVersion is required.',
      },
    };
  }

  const simBuildHash = String(header.simBuildHash ?? '').trim();
  if (!simBuildHash) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header simBuildHash is required.',
      },
    };
  }

  const fixedDtValue = header.fixedDt;
  if (fixedDtValue !== undefined && (!Number.isFinite(Number(fixedDtValue)) || Number(fixedDtValue) <= 0)) {
    return {
      ok: false,
      error: {
        code: 'invalid_header',
        message: 'Replay header fixedDt must be a positive number when provided.',
      },
    };
  }

  return {
    ok: true,
    payload: {
      header: {
        payloadVersion,
        rulesetVersion,
        simBuildHash,
        seed: Number.isFinite(Number(header.seed)) ? Number(header.seed) : undefined,
        loadout: isObjectRecord(header.loadout) ? {
          P1: typeof header.loadout.P1 === 'string' ? header.loadout.P1 as CharacterId : undefined,
          P2: typeof header.loadout.P2 === 'string' ? header.loadout.P2 as CharacterId : undefined,
        } : undefined,
        fixedDt: fixedDtValue !== undefined ? Number(fixedDtValue) : undefined,
        advanceRngPerFrame: Boolean(header.advanceRngPerFrame),
      },
      inputTimeline: [],
    },
  };
}

export function validateReplayPayload(rawPayload: unknown): ReplayValidationResult {
  if (!isObjectRecord(rawPayload)) {
    return {
      ok: false,
      error: {
        code: 'invalid_payload',
        message: 'Replay payload must be a JSON object.',
      },
    };
  }

  const headerValidation = validateHeader(rawPayload.header);
  if (!headerValidation.ok) {
    return headerValidation;
  }

  if (!Array.isArray(rawPayload.inputTimeline)) {
    return {
      ok: false,
      error: {
        code: 'missing_input_timeline',
        message: 'Replay payload must include inputTimeline array.',
      },
    };
  }

  const expectedChecksums = Array.isArray(rawPayload.expectedChecksums)
    ? rawPayload.expectedChecksums.map((value) => Number(value))
    : undefined;
  const rounds = Array.isArray(rawPayload.rounds)
    ? rawPayload.rounds
      .map((value) => {
        if (!isObjectRecord(value)) {
          return null;
        }
        const startFrame = Math.floor(Number(value.startFrame));
        if (!Number.isFinite(startFrame) || startFrame < 0) {
          return null;
        }
        const parsedEnd = value.endFrame === undefined ? undefined : Math.floor(Number(value.endFrame));
        const endFrame = parsedEnd !== undefined && Number.isFinite(parsedEnd) && parsedEnd >= startFrame
          ? parsedEnd
          : undefined;
        const parsedRound = value.round === undefined ? undefined : Math.floor(Number(value.round));
        const round = parsedRound !== undefined && Number.isFinite(parsedRound) && parsedRound > 0
          ? parsedRound
          : undefined;
        const label = typeof value.label === 'string' ? value.label.trim() : undefined;
        return {
          round,
          label: label && label.length > 0 ? label : undefined,
          startFrame,
          endFrame,
        } satisfies ReplayRoundDescriptor;
      })
      .filter((value): value is ReplayRoundDescriptor => value !== null)
    : undefined;

  return {
    ok: true,
    payload: {
      ...headerValidation.payload,
      inputTimeline: rawPayload.inputTimeline as Array<Partial<FrameInput>>,
      rounds,
      expectedChecksums,
    },
  };
}

export function runReplay(payload: ReplayPayload): ReplayResult {
  const fixedDt = Number.isFinite(payload.header.fixedDt) && (payload.header.fixedDt as number) > 0
    ? (payload.header.fixedDt as number)
    : DEFAULT_FIXED_DT;
  const state = createInitialState({
    seed: payload.header.seed,
    loadout: payload.header.loadout,
  });
  const checksums: number[] = [];

  for (let frame = 0; frame < payload.inputTimeline.length; frame += 1) {
    const frameInput = normaliseFrameInput(payload.inputTimeline[frame]);
    step(state, frameInput, fixedDt);
    if (payload.header.advanceRngPerFrame) {
      nextDeterministicRandom(state);
    }
    checksums.push(computeStateChecksum(state));
  }

  return { checksums };
}

export function estimateReplayPayloadBytes(payload: ReplayPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function findFirstChecksumMismatch(actual: number[], expected: number[]): ChecksumMismatch | null {
  const maxLength = Math.max(actual.length, expected.length);
  for (let frame = 0; frame < maxLength; frame += 1) {
    const actualValue = actual[frame];
    const expectedValue = expected[frame];
    if (actualValue !== expectedValue) {
      return {
        frame,
        actual: actualValue ?? -1,
        expected: expectedValue ?? -1,
      };
    }
  }
  return null;
}
