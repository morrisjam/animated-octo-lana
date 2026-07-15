import { fingerprintDeterministicValue } from '../sim/fingerprint';
import type {
  WebRtcDataChannelAdapter,
  WebRtcDataChannelEvent,
  WebRtcDataChannelEventListener,
} from './webRtcFrameTransport';

export const WEB_RTC_RECOVERY_PROTOCOL_VERSION = 2 as const;

export interface WebRtcRecoveryCheckpoint {
  transportAttemptId: string;
  roundEpoch: number;
  confirmedThrough: number;
  p1Rounds: number;
  p2Rounds: number;
  stateChecksum: number;
}

interface RecoveryCheckpointMessage {
  protocolVersion: typeof WEB_RTC_RECOVERY_PROTOCOL_VERSION;
  type: 'recovery-checkpoint';
  checkpoint: WebRtcRecoveryCheckpoint;
}

interface RecoveryReadyMessage {
  protocolVersion: typeof WEB_RTC_RECOVERY_PROTOCOL_VERSION;
  type: 'recovery-ready';
  checkpoint: WebRtcRecoveryCheckpoint;
  checkpointFingerprint: string;
}

export interface WebRtcRecoveryCheckpointOptions {
  timeoutMs?: number;
  resendIntervalMs?: number;
  resolveStateChecksum?(confirmedThrough: number): number | null;
  onCheckpointAgreed?(checkpoint: WebRtcRecoveryCheckpoint): Promise<void> | void;
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_RESEND_INTERVAL_MS = 100;
const FRAME_MESSAGE_TYPES = new Set(['frame-batch', 'frame-ack', 'frame-confirmation']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isFrameCursor(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= -1;
}

function parseCheckpoint(value: unknown): WebRtcRecoveryCheckpoint {
  if (!isRecord(value)) {
    throw new Error('Recovery checkpoint must be an object.');
  }
  const checkpoint: WebRtcRecoveryCheckpoint = {
    transportAttemptId: String(value.transportAttemptId ?? ''),
    roundEpoch: Number(value.roundEpoch),
    confirmedThrough: Number(value.confirmedThrough),
    p1Rounds: Number(value.p1Rounds),
    p2Rounds: Number(value.p2Rounds),
    stateChecksum: Number(value.stateChecksum),
  };
  if (checkpoint.transportAttemptId.length === 0) {
    throw new Error('Recovery checkpoint transport attempt is missing.');
  }
  if (!isNonNegativeInteger(checkpoint.roundEpoch)) {
    throw new Error('Recovery checkpoint epoch must be a non-negative integer.');
  }
  if (!isFrameCursor(checkpoint.confirmedThrough)) {
    throw new Error('Recovery checkpoint confirmation cursor is invalid.');
  }
  if (!isNonNegativeInteger(checkpoint.p1Rounds) || !isNonNegativeInteger(checkpoint.p2Rounds)) {
    throw new Error('Recovery checkpoint score is invalid.');
  }
  if (!isNonNegativeInteger(checkpoint.stateChecksum) || checkpoint.stateChecksum > 0xFFFFFFFF) {
    throw new Error('Recovery checkpoint state checksum is invalid.');
  }
  return checkpoint;
}

function parseMessage(value: unknown): RecoveryCheckpointMessage | RecoveryReadyMessage {
  if (!isRecord(value) || value.protocolVersion !== WEB_RTC_RECOVERY_PROTOCOL_VERSION) {
    throw new Error('Recovery message protocol version is invalid.');
  }
  if (value.type === 'recovery-checkpoint') {
    return {
      protocolVersion: WEB_RTC_RECOVERY_PROTOCOL_VERSION,
      type: 'recovery-checkpoint',
      checkpoint: parseCheckpoint(value.checkpoint),
    };
  }
  if (value.type === 'recovery-ready' && typeof value.checkpointFingerprint === 'string') {
    return {
      protocolVersion: WEB_RTC_RECOVERY_PROTOCOL_VERSION,
      type: 'recovery-ready',
      checkpoint: parseCheckpoint(value.checkpoint),
      checkpointFingerprint: value.checkpointFingerprint,
    };
  }
  throw new Error('Recovery message type is invalid.');
}

function sendJson(channel: WebRtcDataChannelAdapter, value: unknown): void {
  if (channel.readyState !== 'open') {
    throw new Error(`Recovery channel is not open (state: ${channel.readyState}).`);
  }
  channel.send(JSON.stringify(value));
}

function assertSameTimeline(
  local: WebRtcRecoveryCheckpoint,
  remote: WebRtcRecoveryCheckpoint,
): void {
  if (
    local.transportAttemptId !== remote.transportAttemptId
    || local.roundEpoch !== remote.roundEpoch
    || local.p1Rounds !== remote.p1Rounds
    || local.p2Rounds !== remote.p2Rounds
  ) {
    throw new Error('Peer recovery checkpoint does not match the local match timeline.');
  }
}

function buildAgreement(
  local: WebRtcRecoveryCheckpoint,
  remote: WebRtcRecoveryCheckpoint,
  resolveStateChecksum: WebRtcRecoveryCheckpointOptions['resolveStateChecksum'],
): WebRtcRecoveryCheckpoint {
  assertSameTimeline(local, remote);
  const confirmedThrough = Math.min(local.confirmedThrough, remote.confirmedThrough);
  const stateChecksum = confirmedThrough === local.confirmedThrough
    ? local.stateChecksum
    : resolveStateChecksum?.(confirmedThrough) ?? null;
  if (stateChecksum === null) {
    throw new Error(
      `Mutually confirmed recovery frame ${confirmedThrough} is outside local rollback history.`,
    );
  }
  if (remote.confirmedThrough === confirmedThrough && remote.stateChecksum !== stateChecksum) {
    throw new Error('Peer recovery checkpoint state checksum does not match local rollback history.');
  }
  return parseCheckpoint({
    ...local,
    confirmedThrough,
    stateChecksum,
  });
}

function isGameplayFrameMessage(value: unknown): boolean {
  return isRecord(value)
    && typeof value.type === 'string'
    && FRAME_MESSAGE_TYPES.has(value.type);
}

export async function exchangeWebRtcRecoveryCheckpoint(
  channel: WebRtcDataChannelAdapter,
  checkpointInput: WebRtcRecoveryCheckpoint,
  options: WebRtcRecoveryCheckpointOptions = {},
): Promise<WebRtcRecoveryCheckpoint> {
  const checkpoint = parseCheckpoint(checkpointInput);
  const timeoutMs = Math.max(250, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const resendIntervalMs = Math.max(
    25,
    Math.floor(options.resendIntervalMs ?? DEFAULT_RESEND_INTERVAL_MS),
  );

  return await new Promise<WebRtcRecoveryCheckpoint>((resolve, reject) => {
    let agreement: WebRtcRecoveryCheckpoint | null = null;
    let agreementFingerprint: string | null = null;
    let remoteCheckpointFingerprint: string | null = null;
    let remoteReady: RecoveryReadyMessage | null = null;
    let readinessStarted = false;
    let localReady = false;
    let settled = false;
    let quietHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
      clearInterval(resendHandle);
      if (quietHandle !== null) {
        clearTimeout(quietHandle);
      }
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
      channel.removeEventListener('error', onError);
    };
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else if (agreement) {
        resolve(agreement);
      } else {
        reject(new Error('Recovery checkpoint agreement ended without a checkpoint.'));
      }
    };
    const sendCurrentState = (): void => {
      try {
        sendJson(channel, {
          protocolVersion: WEB_RTC_RECOVERY_PROTOCOL_VERSION,
          type: 'recovery-checkpoint',
          checkpoint,
        } satisfies RecoveryCheckpointMessage);
        if (localReady && agreement && agreementFingerprint) {
          sendJson(channel, {
            protocolVersion: WEB_RTC_RECOVERY_PROTOCOL_VERSION,
            type: 'recovery-ready',
            checkpoint: agreement,
            checkpointFingerprint: agreementFingerprint,
          } satisfies RecoveryReadyMessage);
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const evaluateReady = (): void => {
      if (!agreement || !agreementFingerprint || !remoteReady) {
        return;
      }
      if (
        remoteReady.checkpointFingerprint !== agreementFingerprint
        || fingerprintDeterministicValue(remoteReady.checkpoint) !== agreementFingerprint
      ) {
        finish(new Error('Peer recovery readiness references a different checkpoint.'));
        return;
      }
      if (localReady && quietHandle === null) {
        quietHandle = setTimeout(() => finish(), resendIntervalMs * 2);
      }
    };
    const startReadiness = (): void => {
      if (readinessStarted || !agreement) {
        return;
      }
      readinessStarted = true;
      Promise.resolve(options.onCheckpointAgreed?.(agreement))
        .then(() => {
          if (settled) {
            return;
          }
          localReady = true;
          sendCurrentState();
          evaluateReady();
        })
        .catch((error) => {
          finish(error instanceof Error ? error : new Error(String(error)));
        });
    };
    const onMessage: WebRtcDataChannelEventListener = (event: WebRtcDataChannelEvent): void => {
      try {
        if (typeof event.data !== 'string') {
          throw new Error('Recovery message must be a JSON string.');
        }
        const decoded = JSON.parse(event.data) as unknown;
        if (isGameplayFrameMessage(decoded)) {
          return;
        }
        const message = parseMessage(decoded);
        if (message.type === 'recovery-checkpoint') {
          const proposalFingerprint = fingerprintDeterministicValue(message.checkpoint);
          if (
            remoteCheckpointFingerprint !== null
            && remoteCheckpointFingerprint !== proposalFingerprint
          ) {
            throw new Error('Peer changed its recovery checkpoint proposal.');
          }
          remoteCheckpointFingerprint = proposalFingerprint;
          const nextAgreement = buildAgreement(
            checkpoint,
            message.checkpoint,
            options.resolveStateChecksum,
          );
          const nextFingerprint = fingerprintDeterministicValue(nextAgreement);
          if (agreementFingerprint !== null && agreementFingerprint !== nextFingerprint) {
            throw new Error('Peer recovery checkpoint agreement changed during exchange.');
          }
          agreement = nextAgreement;
          agreementFingerprint = nextFingerprint;
          startReadiness();
          evaluateReady();
          return;
        }
        remoteReady = message;
        evaluateReady();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onClose: WebRtcDataChannelEventListener = (): void => {
      finish(new Error('Recovery channel closed before checkpoint agreement.'));
    };
    const onError: WebRtcDataChannelEventListener = (): void => {
      finish(new Error('Recovery channel failed before checkpoint agreement.'));
    };
    const timeoutHandle = setTimeout(() => {
      finish(new Error(`Recovery checkpoint agreement timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const resendHandle = setInterval(sendCurrentState, resendIntervalMs);

    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);
    channel.addEventListener('error', onError);
    sendCurrentState();
  });
}
