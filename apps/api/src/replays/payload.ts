export const REPLAY_PAYLOAD_VERSION = 1;

export interface ReplayPayloadHeader {
  payloadVersion: number;
  rulesetVersion: string;
  simBuildHash: string;
  seed?: number;
  fixedDt?: number;
  advanceRngPerFrame?: boolean;
}

export interface ReplayPayload {
  header: ReplayPayloadHeader;
  inputTimeline: unknown[];
  expectedChecksums?: number[];
}

export type ReplayPayloadValidationErrorCode =
  | 'invalid_payload'
  | 'missing_header'
  | 'unsupported_payload_version'
  | 'invalid_header'
  | 'missing_input_timeline';

export interface ReplayPayloadValidationResult {
  ok: boolean;
  payload?: ReplayPayload;
  errorCode?: ReplayPayloadValidationErrorCode;
  errorMessage?: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateReplayPayloadForArchive(rawPayload: unknown): ReplayPayloadValidationResult {
  if (!isObjectRecord(rawPayload)) {
    return {
      ok: false,
      errorCode: 'invalid_payload',
      errorMessage: 'Replay payload must be a JSON object.',
    };
  }

  if (!isObjectRecord(rawPayload.header)) {
    return {
      ok: false,
      errorCode: 'missing_header',
      errorMessage: 'Replay payload is missing a valid header object.',
    };
  }

  const payloadVersion = Number(rawPayload.header.payloadVersion);
  if (!Number.isFinite(payloadVersion)) {
    return {
      ok: false,
      errorCode: 'invalid_header',
      errorMessage: 'Replay header payloadVersion must be a number.',
    };
  }
  if (payloadVersion !== REPLAY_PAYLOAD_VERSION) {
    return {
      ok: false,
      errorCode: 'unsupported_payload_version',
      errorMessage: `Replay payloadVersion ${payloadVersion} is unsupported. Expected ${REPLAY_PAYLOAD_VERSION}.`,
    };
  }

  const rulesetVersion = String(rawPayload.header.rulesetVersion ?? '').trim();
  if (!rulesetVersion) {
    return {
      ok: false,
      errorCode: 'invalid_header',
      errorMessage: 'Replay header rulesetVersion is required.',
    };
  }

  const simBuildHash = String(rawPayload.header.simBuildHash ?? '').trim();
  if (!simBuildHash) {
    return {
      ok: false,
      errorCode: 'invalid_header',
      errorMessage: 'Replay header simBuildHash is required.',
    };
  }

  if (!Array.isArray(rawPayload.inputTimeline)) {
    return {
      ok: false,
      errorCode: 'missing_input_timeline',
      errorMessage: 'Replay payload must include inputTimeline array.',
    };
  }

  return {
    ok: true,
    payload: {
      header: {
        payloadVersion,
        rulesetVersion,
        simBuildHash,
        seed: Number.isFinite(Number(rawPayload.header.seed)) ? Number(rawPayload.header.seed) : undefined,
        fixedDt: Number.isFinite(Number(rawPayload.header.fixedDt)) ? Number(rawPayload.header.fixedDt) : undefined,
        advanceRngPerFrame: Boolean(rawPayload.header.advanceRngPerFrame),
      },
      inputTimeline: rawPayload.inputTimeline,
      expectedChecksums: Array.isArray(rawPayload.expectedChecksums)
        ? rawPayload.expectedChecksums.map((value) => Number(value))
        : undefined,
    },
  };
}
