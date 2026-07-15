import type { PlayerFrameInput } from '../sim/types';
import {
  OnlineFrameProtocolError,
  type OnlineFrameEnvelope,
  type OnlineFrameSubmission,
  type OnlineFrameTransport,
} from './onlineInputPump';
import { WEB_RTC_RECOVERY_PROTOCOL_VERSION } from './webRtcRecoveryCheckpoint';

export const WEB_RTC_FRAME_PROTOCOL_VERSION = 1 as const;

export type WebRtcFrameMessageType = 'frame-batch' | 'frame-ack' | 'frame-confirmation';

export type WebRtcDataChannelState = 'connecting' | 'open' | 'closing' | 'closed';

export interface WebRtcDataChannelEvent {
  data?: unknown;
}

export type WebRtcDataChannelEventListener = (event: WebRtcDataChannelEvent) => void;

/** The subset of RTCDataChannel used by the frame transport. */
export interface WebRtcDataChannelAdapter {
  readonly readyState: WebRtcDataChannelState | string;
  readonly ordered?: boolean;
  readonly maxPacketLifeTime?: number | null;
  readonly maxRetransmits?: number | null;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'message' | 'close' | 'error',
    listener: WebRtcDataChannelEventListener,
  ): void;
  removeEventListener(
    type: 'message' | 'close' | 'error',
    listener: WebRtcDataChannelEventListener,
  ): void;
}

interface WebRtcFrameMessageBase {
  protocolVersion: typeof WEB_RTC_FRAME_PROTOCOL_VERSION;
  type: WebRtcFrameMessageType;
  fromAccountId: string;
  toAccountId: string;
}

export interface WebRtcFrameBatchMessage extends WebRtcFrameMessageBase {
  type: 'frame-batch';
  batchId: string;
  frames: OnlineFrameSubmission[];
}

export interface WebRtcFrameAckMessage extends WebRtcFrameMessageBase {
  type: 'frame-ack';
  batchId: string;
  acceptedFrames: number;
}

export interface WebRtcFrameConfirmationMessage extends WebRtcFrameMessageBase {
  type: 'frame-confirmation';
  epoch: number;
  confirmedThrough: number;
}

export type WebRtcFrameProtocolMessage =
  | WebRtcFrameBatchMessage
  | WebRtcFrameAckMessage
  | WebRtcFrameConfirmationMessage;

export interface WebRtcFrameTimerApi {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WebRtcFrameTransportOptions {
  channel: WebRtcDataChannelAdapter;
  localAccountId: string;
  remoteAccountId: string;
  ackTimeoutMs?: number;
  maxFrameHistory?: number;
  maxBatchHistory?: number;
  maxFramesPerBatch?: number;
  maxMessageCharacters?: number;
  createBatchId?: () => string;
  now?: () => number;
  timers?: WebRtcFrameTimerApi;
  onProtocolError?: (error: OnlineFrameProtocolError) => void;
  recoverOnChannelFailure?: boolean;
  onRecoverableDisconnect?: (error: WebRtcFrameTransportClosedError) => void;
}

export interface PreparedWebRtcFrameChannel {
  activate(): void;
  discard(): void;
}

interface PendingBatch {
  acceptedFrames: number;
  timer: unknown;
  resolve: (result: { acceptedFrames: number }) => void;
  reject: (error: Error) => void;
}

interface ReceivedBatch {
  fingerprint: string;
  acceptedFrames: number;
}

interface RetiredOutboundBatch {
  acceptedFrames: number;
  status: 'acked' | 'timed-out' | 'send-failed';
}

interface StoredFrame {
  envelope: OnlineFrameEnvelope;
  fingerprint: string;
}

const DEFAULT_ACK_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_FRAME_HISTORY = 4_096;
const DEFAULT_MAX_BATCH_HISTORY = 512;
const DEFAULT_MAX_FRAMES_PER_BATCH = 256;
const DEFAULT_MAX_MESSAGE_CHARACTERS = 256 * 1024;
const MAX_BATCH_ID_CHARACTERS = 256;
const RECOVERY_CONTROL_MESSAGE_TYPES = new Set(['recovery-checkpoint', 'recovery-ready']);

const MESSAGE_BASE_KEYS = [
  'fromAccountId',
  'protocolVersion',
  'toAccountId',
  'type',
];
const INPUT_KEYS = [
  'boost',
  'breakLaunch',
  'dunk',
  'launch',
  'moveX',
  'moveY',
  'parry',
  'special',
  'superBoost',
];

function defaultTimers(): WebRtcFrameTimerApi {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecoveryControlMessage(value: Record<string, unknown>): boolean {
  return value.protocolVersion === WEB_RTC_RECOVERY_PROTOCOL_VERSION
    && typeof value.type === 'string'
    && RECOVERY_CONTROL_MESSAGE_TYPES.has(value.type);
}

function isSerializedGameplayFrameMessage(data: unknown): data is string {
  if (typeof data !== 'string') {
    return false;
  }
  try {
    const decoded = JSON.parse(data) as unknown;
    return isRecord(decoded)
      && (decoded.type === 'frame-batch'
        || decoded.type === 'frame-ack'
        || decoded.type === 'frame-confirmation');
  } catch {
    return false;
  }
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function assertExactKeys(
  record: Record<string, unknown>,
  expected: string[],
  description: string,
): void {
  if (!hasExactKeys(record, expected)) {
    throw new OnlineFrameProtocolError(`${description} has an invalid shape.`);
  }
}

function assertNonNegativeInteger(value: unknown, description: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new OnlineFrameProtocolError(`${description} must be a non-negative safe integer.`);
  }
}

function assertFrameCursor(value: unknown, description: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < -1) {
    throw new OnlineFrameProtocolError(`${description} must be a safe integer at least -1.`);
  }
}

function assertAccountId(value: unknown, description: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new OnlineFrameProtocolError(`${description} must be a non-empty string.`);
  }
}

function cloneInput(input: PlayerFrameInput): PlayerFrameInput {
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

function parseInput(value: unknown, description: string): PlayerFrameInput {
  if (!isRecord(value)) {
    throw new OnlineFrameProtocolError(`${description} must be an object.`);
  }
  assertExactKeys(value, INPUT_KEYS, description);
  if (
    typeof value.moveX !== 'number'
    || typeof value.moveY !== 'number'
    || !Number.isFinite(value.moveX)
    || !Number.isFinite(value.moveY)
  ) {
    throw new OnlineFrameProtocolError(`${description} movement values must be finite numbers.`);
  }
  if (Math.abs(value.moveX) > 1 || Math.abs(value.moveY) > 1) {
    throw new OnlineFrameProtocolError(`${description} movement values must be between -1 and 1.`);
  }
  const booleanKeys = [
    'boost',
    'superBoost',
    'special',
    'launch',
    'dunk',
    'parry',
    'breakLaunch',
  ] as const;
  for (const key of booleanKeys) {
    if (typeof value[key] !== 'boolean') {
      throw new OnlineFrameProtocolError(`${description}.${key} must be a boolean.`);
    }
  }
  return cloneInput(value as unknown as PlayerFrameInput);
}

function parseFrame(value: unknown, index: number): OnlineFrameSubmission {
  const description = `frame batch entry ${index}`;
  if (!isRecord(value)) {
    throw new OnlineFrameProtocolError(`${description} must be an object.`);
  }
  assertExactKeys(value, ['epoch', 'frame', 'input'], description);
  assertNonNegativeInteger(value.epoch, `${description}.epoch`);
  assertNonNegativeInteger(value.frame, `${description}.frame`);
  return {
    epoch: value.epoch,
    frame: value.frame,
    input: parseInput(value.input, `${description}.input`),
  };
}

function inputFingerprint(input: PlayerFrameInput): string {
  return JSON.stringify(cloneInput(input));
}

function frameKey(epoch: number, frame: number): string {
  return `${epoch}:${frame}`;
}

function positiveIntegerOption(value: number | undefined, fallback: number, name: string): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return candidate;
}

export class WebRtcFrameAckTimeoutError extends Error {
  public readonly batchId: string;

  public constructor(batchId: string, timeoutMs: number) {
    super(`Timed out waiting ${timeoutMs}ms for frame batch ACK ${batchId}.`);
    this.name = 'WebRtcFrameAckTimeoutError';
    this.batchId = batchId;
  }
}

export class WebRtcFrameTransportClosedError extends Error {
  public constructor(message = 'WebRTC frame transport is closed.') {
    super(message);
    this.name = 'WebRtcFrameTransportClosedError';
  }
}

export class WebRtcFrameTransport implements OnlineFrameTransport {
  private channel: WebRtcDataChannelAdapter;

  private readonly localAccountId: string;

  private readonly remoteAccountId: string;

  private readonly ackTimeoutMs: number;

  private readonly maxFrameHistory: number;

  private readonly maxBatchHistory: number;

  private readonly maxFramesPerBatch: number;

  private readonly maxMessageCharacters: number;

  private readonly createBatchIdOverride?: () => string;

  private readonly now: () => number;

  private readonly timers: WebRtcFrameTimerApi;

  private readonly onProtocolError?: (error: OnlineFrameProtocolError) => void;

  private readonly recoverOnChannelFailure: boolean;

  private readonly onRecoverableDisconnect?: (error: WebRtcFrameTransportClosedError) => void;

  private readonly pendingBatches = new Map<string, PendingBatch>();

  private readonly retiredOutboundBatches = new Map<string, RetiredOutboundBatch>();

  private readonly receivedBatches = new Map<string, ReceivedBatch>();

  private readonly receivedFrames = new Map<string, StoredFrame>();

  private readonly staleFrameThroughByEpoch = new Map<number, number>();

  private readonly peerConfirmedThroughByEpoch = new Map<number, number>();

  private readonly sentConfirmedThroughByEpoch = new Map<number, number>();

  private latestInboundFrameEpoch = -1;

  private latestInboundConfirmationEpoch = -1;

  private nextBatchSequence = 1;

  private closeReason: Error | null = null;

  private recoverableDisconnectReason: WebRtcFrameTransportClosedError | null = null;

  private readonly handleMessageEvent = (event: WebRtcDataChannelEvent): void => {
    if (this.closeReason) {
      return;
    }
    try {
      this.handleSerializedMessage(event.data);
    } catch (error) {
      const protocolError = error instanceof OnlineFrameProtocolError
        ? error
        : new OnlineFrameProtocolError(
          `Failed to process WebRTC frame message: ${error instanceof Error ? error.message : String(error)}`,
        );
      this.failProtocol(protocolError);
    }
  };

  private readonly handleCloseEvent = (): void => {
    const error = new WebRtcFrameTransportClosedError('RTCDataChannel closed.');
    if (this.recoverOnChannelFailure) {
      this.markRecoverableDisconnect(error, false);
      return;
    }
    this.terminate(error, false);
  };

  private readonly handleErrorEvent = (): void => {
    const error = new WebRtcFrameTransportClosedError('RTCDataChannel reported an error.');
    if (this.recoverOnChannelFailure) {
      this.markRecoverableDisconnect(error, true);
      return;
    }
    this.terminate(error, true);
  };

  public constructor(options: WebRtcFrameTransportOptions) {
    assertAccountId(options.localAccountId, 'localAccountId');
    assertAccountId(options.remoteAccountId, 'remoteAccountId');
    if (options.localAccountId === options.remoteAccountId) {
      throw new Error('localAccountId and remoteAccountId must be different.');
    }
    this.validateChannel(options.channel);

    this.channel = options.channel;
    this.localAccountId = options.localAccountId;
    this.remoteAccountId = options.remoteAccountId;
    this.ackTimeoutMs = positiveIntegerOption(
      options.ackTimeoutMs,
      DEFAULT_ACK_TIMEOUT_MS,
      'ackTimeoutMs',
    );
    this.maxFrameHistory = positiveIntegerOption(
      options.maxFrameHistory,
      DEFAULT_MAX_FRAME_HISTORY,
      'maxFrameHistory',
    );
    this.maxBatchHistory = positiveIntegerOption(
      options.maxBatchHistory,
      DEFAULT_MAX_BATCH_HISTORY,
      'maxBatchHistory',
    );
    this.maxFramesPerBatch = positiveIntegerOption(
      options.maxFramesPerBatch,
      DEFAULT_MAX_FRAMES_PER_BATCH,
      'maxFramesPerBatch',
    );
    this.maxMessageCharacters = positiveIntegerOption(
      options.maxMessageCharacters,
      DEFAULT_MAX_MESSAGE_CHARACTERS,
      'maxMessageCharacters',
    );
    this.createBatchIdOverride = options.createBatchId;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? defaultTimers();
    this.onProtocolError = options.onProtocolError;
    this.recoverOnChannelFailure = options.recoverOnChannelFailure ?? false;
    this.onRecoverableDisconnect = options.onRecoverableDisconnect;

    this.attachChannelListeners();
  }

  public submitFrames(frames: OnlineFrameSubmission[]): Promise<{ acceptedFrames: number }> {
    const unavailable = this.getUnavailableError();
    if (unavailable) {
      return Promise.reject(unavailable);
    }
    if (!Array.isArray(frames)) {
      return Promise.reject(new OnlineFrameProtocolError('submitFrames requires an array.'));
    }
    if (frames.length === 0) {
      return Promise.resolve({ acceptedFrames: 0 });
    }
    if (frames.length > this.maxFramesPerBatch) {
      return Promise.reject(new OnlineFrameProtocolError(
        `Frame batch has ${frames.length} entries; limit is ${this.maxFramesPerBatch}.`,
      ));
    }
    if (this.pendingBatches.size >= this.maxBatchHistory) {
      return Promise.reject(new OnlineFrameProtocolError('Too many frame batches are awaiting ACKs.'));
    }

    let parsedFrames: OnlineFrameSubmission[];
    try {
      const seen = new Set<string>();
      parsedFrames = frames.map((frame, index) => {
        const parsed = parseFrame(frame, index);
        const key = frameKey(parsed.epoch, parsed.frame);
        if (seen.has(key)) {
          throw new OnlineFrameProtocolError(`Frame batch repeats ${key}.`);
        }
        seen.add(key);
        return parsed;
      });
    } catch (error) {
      return Promise.reject(error);
    }

    let batchId: string;
    try {
      batchId = this.createUniqueBatchId();
    } catch (error) {
      return Promise.reject(error);
    }
    const message: WebRtcFrameBatchMessage = {
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-batch',
      fromAccountId: this.localAccountId,
      toAccountId: this.remoteAccountId,
      batchId,
      frames: parsedFrames,
    };

    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        const pending = this.pendingBatches.get(batchId);
        if (!pending) {
          return;
        }
        this.pendingBatches.delete(batchId);
        this.rememberRetiredOutboundBatch(batchId, pending.acceptedFrames, 'timed-out');
        pending.reject(new WebRtcFrameAckTimeoutError(batchId, this.ackTimeoutMs));
      }, this.ackTimeoutMs);
      this.pendingBatches.set(batchId, {
        acceptedFrames: parsedFrames.length,
        timer,
        resolve,
        reject,
      });

      try {
        this.sendMessage(message);
      } catch (error) {
        const pending = this.pendingBatches.get(batchId);
        if (pending) {
          this.pendingBatches.delete(batchId);
          this.timers.clearTimeout(pending.timer);
          this.rememberRetiredOutboundBatch(batchId, pending.acceptedFrames, 'send-failed');
          pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  }

  public pollFrames(
    epoch: number,
    sinceFrame: number,
  ): Promise<{ frames: OnlineFrameEnvelope[]; peerConfirmedThrough: number }> {
    const unavailable = this.getUnavailableError();
    if (unavailable) {
      return Promise.reject(unavailable);
    }
    try {
      assertNonNegativeInteger(epoch, 'pollFrames epoch');
      assertFrameCursor(sinceFrame, 'pollFrames sinceFrame');
    } catch (error) {
      return Promise.reject(error);
    }

    const frames = [...this.receivedFrames.values()]
      .map((stored) => stored.envelope)
      .filter((frame) => frame.epoch === epoch && frame.frame > sinceFrame)
      .sort((first, second) => first.frame - second.frame)
      .map((frame) => ({
        epoch: frame.epoch,
        frame: frame.frame,
        input: cloneInput(frame.input),
        accountId: frame.accountId,
        receivedAt: frame.receivedAt,
      }));
    return Promise.resolve({
      frames,
      peerConfirmedThrough: this.peerConfirmedThroughByEpoch.get(epoch) ?? -1,
    });
  }

  public confirmFrames(
    epoch: number,
    confirmedThrough: number,
  ): Promise<{ confirmedThrough: number }> {
    const unavailable = this.getUnavailableError();
    if (unavailable) {
      return Promise.reject(unavailable);
    }
    try {
      assertNonNegativeInteger(epoch, 'confirmFrames epoch');
      assertFrameCursor(confirmedThrough, 'confirmFrames confirmedThrough');
    } catch (error) {
      return Promise.reject(error);
    }

    const previous = this.sentConfirmedThroughByEpoch.get(epoch) ?? -1;
    if (confirmedThrough <= previous) {
      return Promise.resolve({ confirmedThrough: previous });
    }
    const message: WebRtcFrameConfirmationMessage = {
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-confirmation',
      fromAccountId: this.localAccountId,
      toAccountId: this.remoteAccountId,
      epoch,
      confirmedThrough,
    };
    try {
      this.sendMessage(message);
      this.sentConfirmedThroughByEpoch.set(epoch, confirmedThrough);
      this.trimNumericMap(this.sentConfirmedThroughByEpoch);
      return Promise.resolve({ confirmedThrough });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  public close(): void {
    this.terminate(new WebRtcFrameTransportClosedError(), true);
  }

  public suspendForRecovery(
    reason = new WebRtcFrameTransportClosedError('WebRTC channel recovery requested.'),
  ): void {
    if (!this.recoverOnChannelFailure) {
      this.terminate(reason, true);
      return;
    }
    this.markRecoverableDisconnect(reason, true);
  }

  public prepareReplacementChannel(channel: WebRtcDataChannelAdapter): PreparedWebRtcFrameChannel {
    if (!this.recoverOnChannelFailure) {
      throw new Error('WebRTC frame transport was not configured for channel recovery.');
    }
    if (this.closeReason) {
      throw this.closeReason;
    }
    this.validateChannel(channel);
    if (channel.readyState !== 'open') {
      throw new WebRtcFrameTransportClosedError(
        `Replacement RTCDataChannel is not open (state: ${channel.readyState}).`,
      );
    }

    const bufferedMessages: string[] = [];
    let replacementError: WebRtcFrameTransportClosedError | null = null;
    let staged = true;
    const onMessage: WebRtcDataChannelEventListener = (event) => {
      if (isSerializedGameplayFrameMessage(event.data)) {
        bufferedMessages.push(event.data);
      }
    };
    const onClose: WebRtcDataChannelEventListener = () => {
      replacementError = new WebRtcFrameTransportClosedError(
        'Replacement RTCDataChannel closed before recovery activation.',
      );
    };
    const onError: WebRtcDataChannelEventListener = () => {
      replacementError = new WebRtcFrameTransportClosedError(
        'Replacement RTCDataChannel failed before recovery activation.',
      );
    };
    const detach = (): void => {
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
      channel.removeEventListener('error', onError);
    };

    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);
    channel.addEventListener('error', onError);
    return {
      activate: () => {
        if (!staged) {
          throw new Error('Replacement RTCDataChannel is no longer staged.');
        }
        staged = false;
        detach();
        if (replacementError) {
          throw replacementError;
        }
        this.replaceChannel(channel);
        for (const data of bufferedMessages) {
          this.handleMessageEvent({ data });
          if (this.closeReason) {
            throw this.closeReason;
          }
        }
      },
      discard: () => {
        if (!staged) {
          return;
        }
        staged = false;
        detach();
        bufferedMessages.length = 0;
      },
    };
  }

  public replaceChannel(channel: WebRtcDataChannelAdapter): void {
    if (!this.recoverOnChannelFailure) {
      throw new Error('WebRTC frame transport was not configured for channel recovery.');
    }
    if (this.closeReason) {
      throw this.closeReason;
    }
    this.validateChannel(channel);
    if (channel.readyState !== 'open') {
      throw new WebRtcFrameTransportClosedError(
        `Replacement RTCDataChannel is not open (state: ${channel.readyState}).`,
      );
    }
    this.detachChannelListeners();
    this.channel = channel;
    this.recoverableDisconnectReason = null;
    this.sentConfirmedThroughByEpoch.clear();
    this.attachChannelListeners();
  }

  public isClosed(): boolean {
    return this.closeReason !== null;
  }

  public isRecovering(): boolean {
    return this.recoverableDisconnectReason !== null && this.closeReason === null;
  }

  public getCloseReason(): Error | null {
    return this.closeReason;
  }

  private getUnavailableError(): Error | null {
    if (this.closeReason) {
      return this.closeReason;
    }
    if (this.recoverableDisconnectReason) {
      return this.recoverableDisconnectReason;
    }
    if (this.channel.readyState !== 'open') {
      return new WebRtcFrameTransportClosedError(
        `RTCDataChannel is not open (state: ${this.channel.readyState}).`,
      );
    }
    return null;
  }

  private createUniqueBatchId(): string {
    const generated = this.createBatchIdOverride
      ? this.createBatchIdOverride()
      : `${this.localAccountId}:${this.nextBatchSequence++}`;
    if (typeof generated !== 'string' || generated.length === 0 || generated.length > MAX_BATCH_ID_CHARACTERS) {
      throw new OnlineFrameProtocolError('createBatchId must return a non-empty, bounded string.');
    }
    if (
      this.pendingBatches.has(generated)
      || this.retiredOutboundBatches.has(generated)
    ) {
      throw new OnlineFrameProtocolError(`Frame batch id ${generated} was reused.`);
    }
    return generated;
  }

  private sendMessage(message: WebRtcFrameProtocolMessage): void {
    const unavailable = this.getUnavailableError();
    if (unavailable) {
      throw unavailable;
    }
    const serialized = JSON.stringify(message);
    if (serialized.length > this.maxMessageCharacters) {
      throw new OnlineFrameProtocolError(
        `Serialized WebRTC frame message exceeds ${this.maxMessageCharacters} characters.`,
      );
    }
    this.channel.send(serialized);
  }

  private handleSerializedMessage(data: unknown): void {
    if (typeof data !== 'string') {
      throw new OnlineFrameProtocolError('WebRTC frame messages must be JSON strings.');
    }
    if (data.length > this.maxMessageCharacters) {
      throw new OnlineFrameProtocolError('WebRTC frame message exceeds the configured size limit.');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(data);
    } catch {
      throw new OnlineFrameProtocolError('WebRTC frame message is not valid JSON.');
    }
    if (!isRecord(decoded)) {
      throw new OnlineFrameProtocolError('WebRTC frame message must be an object.');
    }
    if (isRecoveryControlMessage(decoded)) {
      return;
    }
    this.validateMessageBase(decoded);
    switch (decoded.type) {
      case 'frame-batch':
        this.handleFrameBatch(this.parseFrameBatch(decoded));
        return;
      case 'frame-ack':
        this.handleFrameAck(this.parseFrameAck(decoded));
        return;
      case 'frame-confirmation':
        this.handleFrameConfirmation(this.parseFrameConfirmation(decoded));
        return;
      default:
        throw new OnlineFrameProtocolError(`Unknown WebRTC frame message type: ${String(decoded.type)}.`);
    }
  }

  private validateMessageBase(message: Record<string, unknown>): void {
    if (message.protocolVersion !== WEB_RTC_FRAME_PROTOCOL_VERSION) {
      throw new OnlineFrameProtocolError(
        `Unsupported WebRTC frame protocol version: ${String(message.protocolVersion)}.`,
      );
    }
    if (message.fromAccountId !== this.remoteAccountId || message.toAccountId !== this.localAccountId) {
      throw new OnlineFrameProtocolError('WebRTC frame message account routing does not match this peer.');
    }
    if (typeof message.type !== 'string') {
      throw new OnlineFrameProtocolError('WebRTC frame message type is missing.');
    }
  }

  private parseFrameBatch(message: Record<string, unknown>): WebRtcFrameBatchMessage {
    assertExactKeys(message, [...MESSAGE_BASE_KEYS, 'batchId', 'frames'], 'frame-batch message');
    if (
      typeof message.batchId !== 'string'
      || message.batchId.length === 0
      || message.batchId.length > MAX_BATCH_ID_CHARACTERS
    ) {
      throw new OnlineFrameProtocolError('frame-batch batchId is invalid.');
    }
    if (!Array.isArray(message.frames) || message.frames.length === 0) {
      throw new OnlineFrameProtocolError('frame-batch frames must be a non-empty array.');
    }
    if (message.frames.length > this.maxFramesPerBatch) {
      throw new OnlineFrameProtocolError('frame-batch exceeds the configured frame limit.');
    }
    const seen = new Set<string>();
    const frames = message.frames.map((frame, index) => {
      const parsed = parseFrame(frame, index);
      const key = frameKey(parsed.epoch, parsed.frame);
      if (seen.has(key)) {
        throw new OnlineFrameProtocolError(`frame-batch repeats ${key}.`);
      }
      seen.add(key);
      return parsed;
    });
    return {
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-batch',
      fromAccountId: this.remoteAccountId,
      toAccountId: this.localAccountId,
      batchId: message.batchId,
      frames,
    };
  }

  private parseFrameAck(message: Record<string, unknown>): WebRtcFrameAckMessage {
    assertExactKeys(
      message,
      [...MESSAGE_BASE_KEYS, 'acceptedFrames', 'batchId'],
      'frame-ack message',
    );
    if (
      typeof message.batchId !== 'string'
      || message.batchId.length === 0
      || message.batchId.length > MAX_BATCH_ID_CHARACTERS
    ) {
      throw new OnlineFrameProtocolError('frame-ack batchId is invalid.');
    }
    assertNonNegativeInteger(message.acceptedFrames, 'frame-ack acceptedFrames');
    return {
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-ack',
      fromAccountId: this.remoteAccountId,
      toAccountId: this.localAccountId,
      batchId: message.batchId,
      acceptedFrames: message.acceptedFrames,
    };
  }

  private parseFrameConfirmation(message: Record<string, unknown>): WebRtcFrameConfirmationMessage {
    assertExactKeys(
      message,
      [...MESSAGE_BASE_KEYS, 'confirmedThrough', 'epoch'],
      'frame-confirmation message',
    );
    assertNonNegativeInteger(message.epoch, 'frame-confirmation epoch');
    assertFrameCursor(message.confirmedThrough, 'frame-confirmation confirmedThrough');
    return {
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-confirmation',
      fromAccountId: this.remoteAccountId,
      toAccountId: this.localAccountId,
      epoch: message.epoch,
      confirmedThrough: message.confirmedThrough,
    };
  }

  private handleFrameBatch(message: WebRtcFrameBatchMessage): void {
    const fingerprint = JSON.stringify(message.frames);
    const existingBatch = this.receivedBatches.get(message.batchId);
    if (existingBatch) {
      if (existingBatch.fingerprint !== fingerprint) {
        throw new OnlineFrameProtocolError(
          `Frame batch ${message.batchId} changed after its first receipt.`,
        );
      }
      for (const frame of message.frames) {
        if (!this.receivedFrames.has(frameKey(frame.epoch, frame.frame))) {
          throw new OnlineFrameProtocolError(
            `Frame batch ${message.batchId} is older than retained frame history.`,
          );
        }
      }
      this.sendAck(message.batchId, existingBatch.acceptedFrames);
      return;
    }

    for (const frame of message.frames) {
      if (frame.epoch < this.latestInboundFrameEpoch) {
        throw new OnlineFrameProtocolError(
          `Received stale frame epoch ${frame.epoch}; latest is ${this.latestInboundFrameEpoch}.`,
        );
      }
      const key = frameKey(frame.epoch, frame.frame);
      const existingFrame = this.receivedFrames.get(key);
      const fingerprintForFrame = inputFingerprint(frame.input);
      if (existingFrame && existingFrame.fingerprint !== fingerprintForFrame) {
        throw new OnlineFrameProtocolError(`Remote frame ${key} changed after its first receipt.`);
      }
      if (!existingFrame && frame.frame <= (this.staleFrameThroughByEpoch.get(frame.epoch) ?? -1)) {
        throw new OnlineFrameProtocolError(`Remote frame ${key} is older than retained history.`);
      }
    }

    const receivedAt = this.receivedAtNow();
    for (const frame of message.frames) {
      const key = frameKey(frame.epoch, frame.frame);
      if (!this.receivedFrames.has(key)) {
        this.receivedFrames.set(key, {
          fingerprint: inputFingerprint(frame.input),
          envelope: {
            epoch: frame.epoch,
            frame: frame.frame,
            input: cloneInput(frame.input),
            accountId: this.remoteAccountId,
            receivedAt,
          },
        });
      }
      this.latestInboundFrameEpoch = Math.max(this.latestInboundFrameEpoch, frame.epoch);
    }
    this.receivedBatches.set(message.batchId, {
      fingerprint,
      acceptedFrames: message.frames.length,
    });
    this.pruneReceivedHistory();
    this.sendAck(message.batchId, message.frames.length);
  }

  private handleFrameAck(message: WebRtcFrameAckMessage): void {
    const pending = this.pendingBatches.get(message.batchId);
    if (!pending) {
      const retired = this.retiredOutboundBatches.get(message.batchId);
      if (retired && retired.acceptedFrames === message.acceptedFrames) {
        return;
      }
      if (retired) {
        throw new OnlineFrameProtocolError(
          `Retired frame ACK ${message.batchId} accepted ${message.acceptedFrames}/${retired.acceptedFrames} frames.`,
        );
      }
      throw new OnlineFrameProtocolError(`Received unknown frame ACK ${message.batchId}.`);
    }
    if (message.acceptedFrames !== pending.acceptedFrames) {
      throw new OnlineFrameProtocolError(
        `Frame ACK ${message.batchId} accepted ${message.acceptedFrames}/${pending.acceptedFrames} frames.`,
      );
    }
    this.pendingBatches.delete(message.batchId);
    this.timers.clearTimeout(pending.timer);
    this.rememberRetiredOutboundBatch(message.batchId, pending.acceptedFrames, 'acked');
    pending.resolve({ acceptedFrames: message.acceptedFrames });
  }

  private handleFrameConfirmation(message: WebRtcFrameConfirmationMessage): void {
    if (message.epoch < this.latestInboundConfirmationEpoch) {
      throw new OnlineFrameProtocolError(
        `Received stale confirmation epoch ${message.epoch}; latest is ${this.latestInboundConfirmationEpoch}.`,
      );
    }
    const previous = this.peerConfirmedThroughByEpoch.get(message.epoch) ?? -1;
    if (message.confirmedThrough < previous) {
      throw new OnlineFrameProtocolError(
        `Confirmation for epoch ${message.epoch} regressed from ${previous} to ${message.confirmedThrough}.`,
      );
    }
    this.latestInboundConfirmationEpoch = Math.max(
      this.latestInboundConfirmationEpoch,
      message.epoch,
    );
    this.peerConfirmedThroughByEpoch.set(message.epoch, message.confirmedThrough);
    this.trimNumericMap(this.peerConfirmedThroughByEpoch);
  }

  private sendAck(batchId: string, acceptedFrames: number): void {
    this.sendMessage({
      protocolVersion: WEB_RTC_FRAME_PROTOCOL_VERSION,
      type: 'frame-ack',
      fromAccountId: this.localAccountId,
      toAccountId: this.remoteAccountId,
      batchId,
      acceptedFrames,
    });
  }

  private receivedAtNow(): string {
    const timestamp = this.now();
    if (!Number.isFinite(timestamp)) {
      throw new OnlineFrameProtocolError('now() returned a non-finite timestamp.');
    }
    try {
      return new Date(timestamp).toISOString();
    } catch {
      throw new OnlineFrameProtocolError('now() returned an invalid timestamp.');
    }
  }

  private pruneReceivedHistory(): void {
    while (this.receivedFrames.size > this.maxFrameHistory) {
      const oldest = this.receivedFrames.entries().next().value as [string, StoredFrame] | undefined;
      if (!oldest) {
        break;
      }
      this.receivedFrames.delete(oldest[0]);
      const { epoch, frame } = oldest[1].envelope;
      this.staleFrameThroughByEpoch.set(
        epoch,
        Math.max(this.staleFrameThroughByEpoch.get(epoch) ?? -1, frame),
      );
      this.trimNumericMap(this.staleFrameThroughByEpoch);
    }
    while (this.receivedBatches.size > this.maxBatchHistory) {
      const oldestBatchId = this.receivedBatches.keys().next().value as string | undefined;
      if (oldestBatchId === undefined) {
        break;
      }
      this.receivedBatches.delete(oldestBatchId);
    }
  }

  private rememberRetiredOutboundBatch(
    batchId: string,
    acceptedFrames: number,
    status: RetiredOutboundBatch['status'],
  ): void {
    this.retiredOutboundBatches.set(batchId, { acceptedFrames, status });
    while (this.retiredOutboundBatches.size > this.maxBatchHistory) {
      const oldest = this.retiredOutboundBatches.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.retiredOutboundBatches.delete(oldest);
    }
  }

  private trimNumericMap(map: Map<number, number>): void {
    while (map.size > this.maxBatchHistory) {
      const oldest = map.keys().next().value as number | undefined;
      if (oldest === undefined) {
        break;
      }
      map.delete(oldest);
    }
  }

  private failProtocol(error: OnlineFrameProtocolError): void {
    try {
      this.onProtocolError?.(error);
    } catch {
      // Observer failures must not prevent fail-closed cleanup.
    }
    this.terminate(error, true);
  }

  private validateChannel(channel: WebRtcDataChannelAdapter): void {
    if (channel.ordered === false) {
      throw new Error('WebRTC frame transport requires an ordered RTCDataChannel.');
    }
    if (channel.maxPacketLifeTime != null || channel.maxRetransmits != null) {
      throw new Error('WebRTC frame transport requires a reliable RTCDataChannel.');
    }
  }

  private attachChannelListeners(): void {
    this.channel.addEventListener('message', this.handleMessageEvent);
    this.channel.addEventListener('close', this.handleCloseEvent);
    this.channel.addEventListener('error', this.handleErrorEvent);
  }

  private detachChannelListeners(): void {
    this.channel.removeEventListener('message', this.handleMessageEvent);
    this.channel.removeEventListener('close', this.handleCloseEvent);
    this.channel.removeEventListener('error', this.handleErrorEvent);
  }

  private rejectPendingBatches(reason: Error): void {
    for (const [batchId, pending] of this.pendingBatches) {
      this.timers.clearTimeout(pending.timer);
      this.rememberRetiredOutboundBatch(batchId, pending.acceptedFrames, 'send-failed');
      pending.reject(reason);
    }
    this.pendingBatches.clear();
  }

  private markRecoverableDisconnect(
    reason: WebRtcFrameTransportClosedError,
    closeChannel: boolean,
  ): void {
    if (this.closeReason || this.recoverableDisconnectReason) {
      return;
    }
    this.recoverableDisconnectReason = reason;
    this.detachChannelListeners();
    try {
      this.onRecoverableDisconnect?.(reason);
    } catch {
      // Recovery observers cannot weaken transport cleanup.
    }
    this.rejectPendingBatches(reason);
    if (closeChannel && this.channel.readyState !== 'closed') {
      try {
        this.channel.close();
      } catch {
        // The replacement path owns terminal handling from this point.
      }
    }
  }

  private terminate(reason: Error, closeChannel: boolean): void {
    if (this.closeReason) {
      return;
    }
    this.closeReason = reason;
    this.recoverableDisconnectReason = null;
    this.detachChannelListeners();
    this.rejectPendingBatches(reason);

    if (closeChannel && this.channel.readyState !== 'closed') {
      try {
        this.channel.close();
      } catch {
        // Local state is already terminal even if the adapter cannot close cleanly.
      }
    }
  }
}
