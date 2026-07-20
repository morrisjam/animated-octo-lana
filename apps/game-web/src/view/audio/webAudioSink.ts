import {
  type AudioBusId,
  type AudioEvent,
  type AudioRoute,
  type AudioSampleDefinitionV1,
  type AudioSampleLibrary,
  type AudioSamplePreloadFailure,
  type AudioSamplePreloadResult,
  type AudioSampleVariantV1,
  type AudioSinkDiagnostics,
  type AudioToneCue,
} from './types';
import {
  createAudioSampleLibraryIndex,
  orderAudioSampleSources,
  selectAudioSampleVariant,
} from './sampleLibrary';

const DEFAULT_BUS_VOLUMES: Record<AudioBusId, number> = {
  master: 1,
  music: 0.7,
  sfx: 0.85,
  voice: 0.9,
};
const DEFAULT_SAMPLE_CONCURRENCY = 4;
const DEFAULT_GLOBAL_SAMPLE_CONCURRENCY = 32;
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

type AudioFetch = (src: string) => Promise<Response>;

export interface WebAudioEventSinkOptions {
  sampleLibrary?: AudioSampleLibrary;
  maxConcurrentSamples?: number;
  fetcher?: AudioFetch;
  contextFactory?: () => AudioContext | null;
  unlockTarget?: EventTarget | null;
  canPlayType?: (mimeType: string) => CanPlayTypeResult;
  isUserActivationActive?: () => boolean;
  logger?: Pick<Console, 'warn'>;
}

interface ActiveSampleVoice {
  id: number;
  sampleId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultContext(): AudioContext | null {
  const globalWindow = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = globalWindow.AudioContext ?? globalWindow.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }
  return new AudioContextCtor();
}

function createDefaultFormatProbe(): ((mimeType: string) => CanPlayTypeResult) | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const audio = document.createElement('audio');
  return (mimeType: string) => audio.canPlayType(mimeType);
}

function isDefaultUserActivationActive(): boolean {
  return Boolean(
    typeof navigator !== 'undefined'
    && navigator.userActivation?.isActive,
  );
}

export class WebAudioEventSink {
  private readonly definitions: ReadonlyMap<string, AudioSampleDefinitionV1>;
  private readonly maxConcurrentSamples: number;
  private readonly fetcher: AudioFetch | null;
  private readonly contextFactory: () => AudioContext | null;
  private readonly unlockTarget: EventTarget | null;
  private readonly canPlayType?: (mimeType: string) => CanPlayTypeResult;
  private readonly isUserActivationActive: () => boolean;
  private readonly logger: Pick<Console, 'warn'>;
  private readonly busVolumes = { ...DEFAULT_BUS_VOLUMES };
  private readonly fetchedSources = new Map<string, Promise<ArrayBuffer>>();
  private readonly decodedSources = new Map<string, Promise<AudioBuffer>>();
  private readonly variantLoads = new Map<string, Promise<AudioBuffer>>();
  private readonly decodedVariants = new Map<string, AudioBuffer>();
  private readonly warnedFailures = new Set<string>();
  private readonly activeVoices: ActiveSampleVoice[] = [];
  private readonly diagnostics: AudioSinkDiagnostics = {
    sampledPlays: 0,
    tonePlays: 0,
    sampleFallbacks: 0,
    sampleConcurrencyDrops: 0,
    sampleLoadFailures: 0,
    unlockAttempts: 0,
    unlockSuccesses: 0,
  };
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private busGains: Partial<Record<AudioBusId, GainNode>> = {};
  private unlockPromise: Promise<boolean> | null = null;
  private nextVoiceId = 1;
  private disposed = false;

  constructor(options: WebAudioEventSinkOptions = {}) {
    this.definitions = createAudioSampleLibraryIndex(options.sampleLibrary);
    this.maxConcurrentSamples = clamp(
      Math.floor(options.maxConcurrentSamples ?? DEFAULT_GLOBAL_SAMPLE_CONCURRENCY),
      1,
      128,
    );
    this.fetcher = options.fetcher
      ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.contextFactory = options.contextFactory ?? createDefaultContext;
    this.unlockTarget = options.unlockTarget
      ?? (typeof document !== 'undefined' ? document : null);
    this.canPlayType = options.canPlayType ?? createDefaultFormatProbe();
    this.isUserActivationActive = options.isUserActivationActive ?? isDefaultUserActivationActive;
    this.logger = options.logger ?? console;
    this.addUnlockListeners();
  }

  play(event: AudioEvent, route: AudioRoute): void {
    if (this.disposed) {
      return;
    }

    const context = this.context;
    if (!context || context.state !== 'running') {
      if (this.isUserActivationActive()) {
        void this.unlock().then((unlocked) => {
          if (unlocked) {
            this.play(event, route);
          }
        });
      }
      return;
    }

    if (event.cueOverride) {
      this.playTone(context, event, route.bus, event.cueOverride);
      return;
    }

    if (route.sample) {
      const definition = this.definitions.get(route.sample.sampleId);
      const variantId = event.sampleVariantId ?? route.sample.defaultVariantId;
      const variant = definition
        ? selectAudioSampleVariant(definition, variantId)
        : null;
      if (definition && variant) {
        const variantKey = this.toVariantKey(definition.id, variant.id);
        const buffer = this.decodedVariants.get(variantKey);
        if (buffer) {
          this.playSample(context, event, route, definition, buffer);
          return;
        }
        void this.loadVariant(context, definition, variant).catch((error: unknown) => {
          this.reportLoadFailure(definition.id, variant.id, error);
        });
      } else {
        const failureKey = `${route.sample.sampleId}:${variantId ?? '<default>'}`;
        this.warnOnce(
          failureKey,
          `[audio] Sample or variant "${failureKey}" is not defined; using its tone fallback.`,
        );
      }

      this.diagnostics.sampleFallbacks += 1;
      if (route.cue) {
        this.playTone(context, event, route.bus, route.cue);
      }
      return;
    }

    if (route.cue) {
      this.playTone(context, event, route.bus, route.cue);
    }
  }

  async preload(sampleIds?: readonly string[]): Promise<AudioSamplePreloadResult> {
    const requestedSampleIds = sampleIds
      ? [...new Set(sampleIds)]
      : [...this.definitions.keys()];
    const failures: AudioSamplePreloadFailure[] = [];
    const definitions: AudioSampleDefinitionV1[] = [];

    for (const sampleId of requestedSampleIds) {
      const definition = this.definitions.get(sampleId);
      if (!definition) {
        failures.push({
          sampleId,
          variantId: null,
          reason: `Sample "${sampleId}" is not defined.`,
        });
        continue;
      }
      definitions.push(definition);
    }

    if (definitions.length === 0) {
      return { requestedSampleIds, loadedVariants: 0, failures };
    }

    const context = this.ensureContext();
    if (!context) {
      for (const definition of definitions) {
        for (const variant of definition.variants) {
          failures.push({
            sampleId: definition.id,
            variantId: variant.id,
            reason: 'WebAudio is unavailable.',
          });
        }
      }
      return { requestedSampleIds, loadedVariants: 0, failures };
    }

    let loadedVariants = 0;
    await Promise.all(definitions.flatMap((definition) => (
      definition.variants.map(async (variant) => {
        try {
          await this.loadVariant(context, definition, variant);
          loadedVariants += 1;
        } catch (error) {
          this.reportLoadFailure(definition.id, variant.id, error);
          failures.push({
            sampleId: definition.id,
            variantId: variant.id,
            reason: toErrorMessage(error),
          });
        }
      })
    )));

    return { requestedSampleIds, loadedVariants, failures };
  }

  async unlock(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    const context = this.ensureContext();
    if (!context || context.state === 'closed') {
      return false;
    }
    if (context.state === 'running') {
      return true;
    }
    if (this.unlockPromise) {
      return this.unlockPromise;
    }

    this.diagnostics.unlockAttempts += 1;
    this.unlockPromise = context.resume()
      .then(() => {
        const running = context.state === 'running';
        if (running) {
          this.diagnostics.unlockSuccesses += 1;
        }
        return running;
      })
      .catch(() => false)
      .finally(() => {
        this.unlockPromise = null;
      });
    return this.unlockPromise;
  }

  setBusVolume(bus: AudioBusId, volume: number): void {
    const clamped = clamp(volume, 0, 1);
    this.busVolumes[bus] = clamped;
    const context = this.context;
    if (!context) {
      return;
    }
    if (bus === 'master') {
      this.masterGain?.gain.setValueAtTime(clamped, context.currentTime);
      return;
    }
    this.busGains[bus]?.gain.setValueAtTime(clamped, context.currentTime);
  }

  getDiagnostics(): AudioSinkDiagnostics {
    return { ...this.diagnostics };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.removeUnlockListeners();
    for (const voice of [...this.activeVoices]) {
      this.stopVoice(voice);
    }
    if (this.context) {
      void this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.masterGain = null;
    this.busGains = {};
    this.decodedVariants.clear();
    this.variantLoads.clear();
    this.decodedSources.clear();
    this.fetchedSources.clear();
  }

  private readonly handleUnlockGesture = (): void => {
    void this.unlock();
  };

  private addUnlockListeners(): void {
    for (const eventType of UNLOCK_EVENTS) {
      this.unlockTarget?.addEventListener(eventType, this.handleUnlockGesture, {
        capture: true,
        passive: true,
      });
    }
  }

  private removeUnlockListeners(): void {
    for (const eventType of UNLOCK_EVENTS) {
      this.unlockTarget?.removeEventListener(eventType, this.handleUnlockGesture, {
        capture: true,
      });
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context && this.masterGain) {
      return this.context;
    }
    try {
      const context = this.contextFactory();
      if (!context) {
        return null;
      }
      const masterGain = context.createGain();
      masterGain.gain.value = this.busVolumes.master;
      masterGain.connect(context.destination);

      const busGains: Partial<Record<AudioBusId, GainNode>> = {};
      for (const bus of ['music', 'sfx', 'voice'] as const) {
        const gain = context.createGain();
        gain.gain.value = this.busVolumes[bus];
        gain.connect(masterGain);
        busGains[bus] = gain;
      }

      this.context = context;
      this.masterGain = masterGain;
      this.busGains = busGains;
    } catch {
      this.context = null;
      this.masterGain = null;
      this.busGains = {};
    }
    return this.context;
  }

  private playTone(
    context: AudioContext,
    event: AudioEvent,
    bus: AudioBusId,
    cue: AudioToneCue,
  ): void {
    const oscillator = context.createOscillator();
    oscillator.type = cue.waveform;
    oscillator.frequency.value = cue.frequencyHz;

    const gain = context.createGain();
    const now = context.currentTime;
    const duration = Math.max(0.03, cue.durationSeconds);
    const peakGain = Math.max(0.0002, cue.gain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + Math.min(0.02, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const stereoPanner = context.createStereoPanner();
    stereoPanner.pan.value = clamp(event.pan ?? 0, -1, 1);
    oscillator.connect(gain);
    gain.connect(stereoPanner);
    stereoPanner.connect(this.getBusTarget(context, bus));
    oscillator.start(now);
    oscillator.stop(now + duration);
    this.diagnostics.tonePlays += 1;
  }

  private playSample(
    context: AudioContext,
    event: AudioEvent,
    route: AudioRoute,
    definition: AudioSampleDefinitionV1,
    buffer: AudioBuffer,
  ): void {
    const sampleLimit = definition.maxConcurrent ?? DEFAULT_SAMPLE_CONCURRENCY;
    const activeForSample = this.activeVoices.filter((voice) => voice.sampleId === definition.id);
    if (activeForSample.length >= sampleLimit) {
      if (definition.overflowPolicy === 'steal-oldest') {
        const oldest = activeForSample[0];
        if (oldest) {
          this.stopVoice(oldest);
        }
      } else {
        this.diagnostics.sampleConcurrencyDrops += 1;
        return;
      }
    }
    if (this.activeVoices.length >= this.maxConcurrentSamples) {
      this.diagnostics.sampleConcurrencyDrops += 1;
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = clamp(route.sample?.playbackRate ?? 1, 0.25, 4);
    const gain = context.createGain();
    gain.gain.value = clamp(route.sample?.gain ?? 1, 0, 4);
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(event.pan ?? 0, -1, 1);
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.getBusTarget(context, route.bus));

    const voice: ActiveSampleVoice = {
      id: this.nextVoiceId,
      sampleId: definition.id,
      source,
      gain,
      panner,
    };
    this.nextVoiceId += 1;
    source.onended = () => this.releaseVoice(voice.id);
    this.activeVoices.push(voice);
    source.start(context.currentTime);
    this.diagnostics.sampledPlays += 1;
  }

  private stopVoice(voice: ActiveSampleVoice): void {
    this.releaseVoice(voice.id);
    try {
      voice.source.stop();
    } catch {
      // A source may already have ended between selection and cleanup.
    }
  }

  private releaseVoice(voiceId: number): void {
    const index = this.activeVoices.findIndex((voice) => voice.id === voiceId);
    if (index < 0) {
      return;
    }
    const [voice] = this.activeVoices.splice(index, 1);
    voice?.source.disconnect();
    voice?.gain.disconnect();
    voice?.panner.disconnect();
  }

  private getBusTarget(context: AudioContext, bus: AudioBusId): AudioNode {
    if (bus === 'master') {
      return this.masterGain ?? context.destination;
    }
    return this.busGains[bus] ?? this.masterGain ?? context.destination;
  }

  private loadVariant(
    context: AudioContext,
    definition: AudioSampleDefinitionV1,
    variant: AudioSampleVariantV1,
  ): Promise<AudioBuffer> {
    const variantKey = this.toVariantKey(definition.id, variant.id);
    const loaded = this.decodedVariants.get(variantKey);
    if (loaded) {
      return Promise.resolve(loaded);
    }
    const loading = this.variantLoads.get(variantKey);
    if (loading) {
      return loading;
    }

    const promise = this.decodeFirstSupportedSource(context, variant)
      .then((buffer) => {
        if (!this.disposed) {
          this.decodedVariants.set(variantKey, buffer);
        }
        return buffer;
      })
      .catch((error: unknown) => {
        this.variantLoads.delete(variantKey);
        throw error;
      });
    this.variantLoads.set(variantKey, promise);
    return promise;
  }

  private async decodeFirstSupportedSource(
    context: AudioContext,
    variant: AudioSampleVariantV1,
  ): Promise<AudioBuffer> {
    let lastError: unknown = new Error('No sample sources were provided.');
    for (const source of orderAudioSampleSources(variant.sources, this.canPlayType)) {
      try {
        return await this.decodeSource(context, source.src);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private decodeSource(context: AudioContext, src: string): Promise<AudioBuffer> {
    const cached = this.decodedSources.get(src);
    if (cached) {
      return cached;
    }

    const promise = this.fetchSource(src)
      .then((data) => context.decodeAudioData(data.slice(0)))
      .catch((error: unknown) => {
        this.decodedSources.delete(src);
        throw error;
      });
    this.decodedSources.set(src, promise);
    return promise;
  }

  private fetchSource(src: string): Promise<ArrayBuffer> {
    const cached = this.fetchedSources.get(src);
    if (cached) {
      return cached;
    }
    if (!this.fetcher) {
      return Promise.reject(new Error('Fetch is unavailable.'));
    }

    const promise = this.fetcher(src)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch "${src}" (${response.status}).`);
        }
        return response.arrayBuffer();
      })
      .catch((error: unknown) => {
        this.fetchedSources.delete(src);
        throw error;
      });
    this.fetchedSources.set(src, promise);
    return promise;
  }

  private reportLoadFailure(sampleId: string, variantId: string, error: unknown): void {
    this.diagnostics.sampleLoadFailures += 1;
    const failureKey = this.toVariantKey(sampleId, variantId);
    this.warnOnce(
      failureKey,
      `[audio] Failed to preload sample "${sampleId}" variant "${variantId}": ${toErrorMessage(error)}`,
    );
  }

  private warnOnce(key: string, message: string): void {
    if (this.warnedFailures.has(key)) {
      return;
    }
    this.warnedFailures.add(key);
    this.logger.warn(message);
  }

  private toVariantKey(sampleId: string, variantId: string): string {
    return `${sampleId}\u0000${variantId}`;
  }
}
