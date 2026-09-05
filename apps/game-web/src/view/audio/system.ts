import { createAudioEventBus } from './eventBus';
import type {
  AudioBusId,
  AudioDiagnostics,
  AudioEvent,
  AudioEventType,
  AudioRoute,
  AudioRouteTable,
  AudioSampleLibrary,
  AudioSamplePreloadResult,
  AudioSinkDiagnostics,
} from './types';
import type { WebAudioEventSinkOptions } from './webAudioSink';

const DEFAULT_ROUTE_TABLE: Record<AudioEventType, AudioRoute> = {
  'combat.boost': {
    bus: 'sfx',
    cue: { waveform: 'sawtooth', frequencyHz: 260, durationSeconds: 0.09, gain: 0.018 },
  },
  'combat.launch': {
    bus: 'sfx',
    cue: { waveform: 'triangle', frequencyHz: 380, durationSeconds: 0.12, gain: 0.026 },
  },
  'combat.super_boost': {
    bus: 'sfx',
    cue: { waveform: 'sawtooth', frequencyHz: 310, durationSeconds: 0.14, gain: 0.02 },
  },
  'combat.clash': {
    bus: 'sfx',
    cue: { waveform: 'square', frequencyHz: 180, durationSeconds: 0.08, gain: 0.018 },
  },
  'combat.special': {
    bus: 'sfx',
    cue: { waveform: 'sine', frequencyHz: 660, durationSeconds: 0.16, gain: 0.022 },
  },
  'combat.break': {
    bus: 'sfx',
    cue: { waveform: 'triangle', frequencyHz: 740, durationSeconds: 0.07, gain: 0.022 },
  },
  'combat.parry': {
    bus: 'sfx',
    cue: { waveform: 'triangle', frequencyHz: 530, durationSeconds: 0.1, gain: 0.02 },
  },
  'combat.projectile': {
    bus: 'sfx',
    cue: { waveform: 'sine', frequencyHz: 450, durationSeconds: 0.09, gain: 0.018 },
  },
  'combat.dunk': {
    bus: 'sfx',
    cue: { waveform: 'triangle', frequencyHz: 240, durationSeconds: 0.12, gain: 0.028 },
  },
  'music.menu': {
    bus: 'music',
    cue: { waveform: 'sine', frequencyHz: 148, durationSeconds: 0.18, gain: 0.012 },
  },
  'music.match': {
    bus: 'music',
    cue: { waveform: 'square', frequencyHz: 196, durationSeconds: 0.16, gain: 0.012 },
  },
  'music.neutral': {
    bus: 'music',
    cue: { waveform: 'triangle', frequencyHz: 188, durationSeconds: 0.15, gain: 0.011 },
  },
  'music.launch': {
    bus: 'music',
    cue: { waveform: 'sawtooth', frequencyHz: 228, durationSeconds: 0.14, gain: 0.013 },
  },
  'music.end': {
    bus: 'music',
    cue: { waveform: 'sine', frequencyHz: 164, durationSeconds: 0.2, gain: 0.012 },
  },
  'voice.round_start': {
    bus: 'voice',
    cue: { waveform: 'triangle', frequencyHz: 320, durationSeconds: 0.15, gain: 0.014 },
  },
  'voice.callout': {
    bus: 'voice',
    cue: { waveform: 'triangle', frequencyHz: 300, durationSeconds: 0.14, gain: 0.013 },
  },
};

type MissingEventPolicy = 'warn' | 'throw';

export interface AudioEventSink {
  play(event: AudioEvent, route: AudioRoute): void;
  setBusVolume(bus: AudioBusId, volume: number): void;
  preload?(sampleIds?: readonly string[]): Promise<AudioSamplePreloadResult>;
  unlock?(): Promise<boolean>;
  getDiagnostics?(): AudioSinkDiagnostics;
  dispose(): void;
}

export interface AudioSystemOptions {
  routeTable?: AudioRouteTable;
  sampleLibrary?: AudioSampleLibrary;
  maxConcurrentSamples?: number;
  webAudioSinkOptions?: Omit<
    WebAudioEventSinkOptions,
    'sampleLibrary' | 'maxConcurrentSamples' | 'logger'
  >;
  missingEventPolicy?: MissingEventPolicy;
  sink?: AudioEventSink;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export interface AudioSystem {
  emit(event: AudioEvent): void;
  preloadSamples(sampleIds?: readonly string[]): Promise<AudioSamplePreloadResult>;
  unlock(): Promise<boolean>;
  setBusVolume(bus: AudioBusId, volume: number): void;
  getDiagnostics(): AudioDiagnostics;
  dispose(): void;
}

const EMPTY_SINK_DIAGNOSTICS: AudioSinkDiagnostics = {
  sampledPlays: 0,
  tonePlays: 0,
  sampleFallbacks: 0,
  sampleConcurrencyDrops: 0,
  sampleLoadFailures: 0,
  unlockAttempts: 0,
  unlockSuccesses: 0,
};

class DeferredWebAudioEventSink implements AudioEventSink {
  private readonly busVolumes: Record<AudioBusId, number> = {
    master: 1,
    music: 1,
    sfx: 1,
    voice: 1,
  };
  private sink: AudioEventSink | null = null;
  private sinkPromise: Promise<AudioEventSink | null> | null = null;
  private disposed = false;

  constructor(
    private readonly options: WebAudioEventSinkOptions,
    private readonly logger: Pick<Console, 'warn'>,
  ) {}

  play(event: AudioEvent, route: AudioRoute): void {
    void this.getSink().then((sink) => sink?.play(event, route));
  }

  setBusVolume(bus: AudioBusId, volume: number): void {
    this.busVolumes[bus] = volume;
    this.sink?.setBusVolume(bus, volume);
  }

  async preload(sampleIds?: readonly string[]): Promise<AudioSamplePreloadResult> {
    const sink = await this.getSink();
    if (sink?.preload) {
      return sink.preload(sampleIds);
    }
    const requestedSampleIds = sampleIds ? [...new Set(sampleIds)] : [];
    return {
      requestedSampleIds,
      loadedVariants: 0,
      failures: requestedSampleIds.map((sampleId) => ({
        sampleId,
        variantId: null,
        reason: 'WebAudio could not be loaded.',
      })),
    };
  }

  async unlock(): Promise<boolean> {
    const sink = await this.getSink();
    return sink?.unlock?.() ?? false;
  }

  getDiagnostics(): AudioSinkDiagnostics {
    return this.sink?.getDiagnostics?.() ?? { ...EMPTY_SINK_DIAGNOSTICS };
  }

  dispose(): void {
    this.disposed = true;
    this.sink?.dispose();
    this.sink = null;
  }

  private getSink(): Promise<AudioEventSink | null> {
    if (this.disposed) {
      return Promise.resolve(null);
    }
    if (this.sink) {
      return Promise.resolve(this.sink);
    }
    if (!this.sinkPromise) {
      this.sinkPromise = import('./webAudioSink')
        .then(({ WebAudioEventSink }) => {
          if (this.disposed) {
            return null;
          }
          const sink = new WebAudioEventSink(this.options);
          for (const [bus, volume] of Object.entries(this.busVolumes)) {
            sink.setBusVolume(bus as AudioBusId, volume);
          }
          this.sink = sink;
          return sink;
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `[audio] WebAudio module failed to load: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        });
    }
    return this.sinkPromise;
  }
}

export function createAudioSystem(options?: AudioSystemOptions): AudioSystem {
  const eventBus = createAudioEventBus();
  const routeTable = options?.routeTable ?? DEFAULT_ROUTE_TABLE;
  const missingEventPolicy = options?.missingEventPolicy ?? 'warn';
  const logger = options?.logger ?? console;
  const sink = options?.sink ?? new DeferredWebAudioEventSink(
    {
      ...options?.webAudioSinkOptions,
      sampleLibrary: options?.sampleLibrary,
      maxConcurrentSamples: options?.maxConcurrentSamples,
      logger,
    },
    logger,
  );

  const diagnostics: AudioDiagnostics = {
    emittedEvents: 0,
    routedEvents: 0,
    missingRoutes: 0,
    lastMissingType: null,
    sampledPlays: 0,
    tonePlays: 0,
    sampleFallbacks: 0,
    sampleConcurrencyDrops: 0,
    sampleLoadFailures: 0,
    unlockAttempts: 0,
    unlockSuccesses: 0,
  };

  const unsubscribe = eventBus.subscribe((event) => {
    const route = routeTable[event.type];
    if (!route || (!route.cue && !route.sample && !event.cueOverride)) {
      diagnostics.missingRoutes += 1;
      diagnostics.lastMissingType = event.type;
      const message = `[audio] Missing route or cue for event "${event.type}".`;
      if (missingEventPolicy === 'throw') {
        throw new Error(message);
      }
      logger.warn(message);
      return;
    }
    sink.play(event, route);
    diagnostics.routedEvents += 1;
  });

  return {
    emit(event: AudioEvent): void {
      diagnostics.emittedEvents += 1;
      eventBus.emit(event);
    },
    preloadSamples(sampleIds?: readonly string[]): Promise<AudioSamplePreloadResult> {
      if (sink.preload) {
        return sink.preload(sampleIds);
      }
      const requestedSampleIds = sampleIds ? [...new Set(sampleIds)] : [];
      return Promise.resolve({
        requestedSampleIds,
        loadedVariants: 0,
        failures: requestedSampleIds.map((sampleId) => ({
          sampleId,
          variantId: null,
          reason: 'The configured audio sink does not support sample preloading.',
        })),
      });
    },
    unlock(): Promise<boolean> {
      return sink.unlock?.() ?? Promise.resolve(false);
    },
    setBusVolume(bus: AudioBusId, volume: number): void {
      sink.setBusVolume(bus, volume);
    },
    getDiagnostics(): AudioDiagnostics {
      return {
        ...diagnostics,
        ...sink.getDiagnostics?.(),
      };
    },
    dispose(): void {
      unsubscribe();
      sink.dispose();
    },
  };
}
