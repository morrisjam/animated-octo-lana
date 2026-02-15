import * as THREE from 'three';
import { createAudioEventBus } from './eventBus';
import type {
  AudioBusId,
  AudioDiagnostics,
  AudioEvent,
  AudioRoute,
  AudioRouteTable,
  AudioToneCue,
} from './types';

const DEFAULT_ROUTE_TABLE: AudioRouteTable = {
  'combat.boost': {
    bus: 'sfx',
    cue: { waveform: 'sawtooth', frequencyHz: 260, durationSeconds: 0.09, gain: 0.018 },
  },
  'combat.launch': {
    bus: 'sfx',
    cue: { waveform: 'triangle', frequencyHz: 380, durationSeconds: 0.12, gain: 0.026 },
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
};

type MissingEventPolicy = 'warn' | 'throw';

interface AudioEventSink {
  play(event: AudioEvent, route: AudioRoute): void;
  setBusVolume(bus: AudioBusId, volume: number): void;
  dispose(): void;
}

class WebAudioEventSink implements AudioEventSink {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private busGains: Partial<Record<AudioBusId, GainNode>> = {};

  play(event: AudioEvent, route: AudioRoute): void {
    const cue = event.cueOverride ?? route.cue;
    if (!cue) {
      return;
    }

    const context = this.ensureContext();
    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }

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

    oscillator.connect(gain);
    const targetBus = route.bus === 'master' ? this.masterGain : this.busGains[route.bus];
    const pan = event.pan ?? 0;
    if ('createStereoPanner' in context) {
      const stereoPanner = context.createStereoPanner();
      stereoPanner.pan.value = THREE.MathUtils.clamp(pan, -1, 1);
      gain.connect(stereoPanner);
      stereoPanner.connect(targetBus ?? context.destination);
    } else {
      gain.connect(targetBus ?? context.destination);
    }
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  setBusVolume(bus: AudioBusId, volume: number): void {
    const context = this.ensureContext();
    if (!context) {
      return;
    }
    const clamped = THREE.MathUtils.clamp(volume, 0, 1);
    if (bus === 'master') {
      this.masterGain?.gain.setValueAtTime(clamped, context.currentTime);
      return;
    }
    this.busGains[bus]?.gain.setValueAtTime(clamped, context.currentTime);
  }

  dispose(): void {
    if (!this.context) {
      return;
    }
    void this.context.close().catch(() => undefined);
    this.context = null;
    this.masterGain = null;
    this.busGains = {};
  }

  private ensureContext(): AudioContext | null {
    if (this.context && this.masterGain) {
      return this.context;
    }
    const globalWindow = globalThis as Window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = globalWindow.AudioContext ?? globalWindow.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    try {
      this.context = new AudioContextCtor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.context.destination);

      this.busGains.music = this.context.createGain();
      this.busGains.music.gain.value = 0.7;
      this.busGains.music.connect(this.masterGain);

      this.busGains.sfx = this.context.createGain();
      this.busGains.sfx.gain.value = 0.85;
      this.busGains.sfx.connect(this.masterGain);

      this.busGains.voice = this.context.createGain();
      this.busGains.voice.gain.value = 0.9;
      this.busGains.voice.connect(this.masterGain);
    } catch {
      this.context = null;
      this.masterGain = null;
      this.busGains = {};
    }

    return this.context;
  }
}

export interface AudioSystemOptions {
  routeTable?: AudioRouteTable;
  missingEventPolicy?: MissingEventPolicy;
  sink?: AudioEventSink;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export interface AudioSystem {
  emit(event: AudioEvent): void;
  setBusVolume(bus: AudioBusId, volume: number): void;
  getDiagnostics(): AudioDiagnostics;
  dispose(): void;
}

export function createAudioSystem(options?: AudioSystemOptions): AudioSystem {
  const eventBus = createAudioEventBus();
  const routeTable = options?.routeTable ?? DEFAULT_ROUTE_TABLE;
  const missingEventPolicy = options?.missingEventPolicy ?? 'warn';
  const logger = options?.logger ?? console;
  const sink = options?.sink ?? new WebAudioEventSink();

  const diagnostics: AudioDiagnostics = {
    emittedEvents: 0,
    routedEvents: 0,
    missingRoutes: 0,
    lastMissingType: null,
  };

  const unsubscribe = eventBus.subscribe((event) => {
    const route = routeTable[event.type];
    if (!route || (!route.cue && !event.cueOverride)) {
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
    setBusVolume(bus: AudioBusId, volume: number): void {
      sink.setBusVolume(bus, volume);
    },
    getDiagnostics(): AudioDiagnostics {
      return { ...diagnostics };
    },
    dispose(): void {
      unsubscribe();
      sink.dispose();
    },
  };
}
