import { describe, expect, test } from 'vitest';
import { createAudioSystem } from './system';
import type {
  AudioBusId,
  AudioEvent,
  AudioRoute,
  AudioSamplePreloadResult,
} from './types';

class TestSink {
  played: Array<{ event: AudioEvent; route: AudioRoute }> = [];
  busVolumes: Array<{ bus: AudioBusId; volume: number }> = [];
  preloadRequests: Array<readonly string[] | undefined> = [];
  unlockCalls = 0;
  disposed = false;

  play(event: AudioEvent, route: AudioRoute): void {
    this.played.push({ event, route });
  }

  setBusVolume(bus: AudioBusId, volume: number): void {
    this.busVolumes.push({ bus, volume });
  }

  preload(sampleIds?: readonly string[]): Promise<AudioSamplePreloadResult> {
    this.preloadRequests.push(sampleIds);
    return Promise.resolve({
      requestedSampleIds: sampleIds ? [...sampleIds] : [],
      loadedVariants: sampleIds?.length ?? 0,
      failures: [],
    });
  }

  unlock(): Promise<boolean> {
    this.unlockCalls += 1;
    return Promise.resolve(true);
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe('audio event bus and routing', () => {
  test('routes typed combat events through SFX bus', () => {
    const sink = new TestSink();
    const system = createAudioSystem({ sink });

    system.emit({ type: 'combat.launch', pan: 0.2 });
    const diagnostics = system.getDiagnostics();

    expect(sink.played).toHaveLength(1);
    expect(sink.played[0]?.route.bus).toBe('sfx');
    expect(diagnostics.emittedEvents).toBe(1);
    expect(diagnostics.routedEvents).toBe(1);
    expect(diagnostics.missingRoutes).toBe(0);
  });

  test('supports cue overrides without changing route bindings', () => {
    const sink = new TestSink();
    const system = createAudioSystem({ sink });

    system.emit({
      type: 'combat.projectile',
      cueOverride: {
        waveform: 'square',
        frequencyHz: 999,
        durationSeconds: 0.05,
        gain: 0.01,
      },
    });

    expect(sink.played).toHaveLength(1);
    expect(sink.played[0]?.route.bus).toBe('sfx');
    expect(sink.played[0]?.event.cueOverride?.frequencyHz).toBe(999);
  });

  test('accepts sampled routes without requiring a tone cue', () => {
    const sink = new TestSink();
    const system = createAudioSystem({
      sink,
      routeTable: {
        'combat.launch': {
          bus: 'sfx',
          sample: { sampleId: 'combat_launch' },
        },
      },
      missingEventPolicy: 'throw',
    });

    system.emit({ type: 'combat.launch', sampleVariantId: 'heavy' });

    expect(sink.played).toHaveLength(1);
    expect(sink.played[0]?.event.sampleVariantId).toBe('heavy');
  });

  test('forwards explicit preload and unlock requests to the sink', async () => {
    const sink = new TestSink();
    const system = createAudioSystem({ sink });

    const result = await system.preloadSamples(['combat_launch']);
    const unlocked = await system.unlock();

    expect(result.loadedVariants).toBe(1);
    expect(sink.preloadRequests).toEqual([['combat_launch']]);
    expect(unlocked).toBe(true);
    expect(sink.unlockCalls).toBe(1);
  });

  test('fails with explicit diagnostics when missing routes are emitted in strict mode', () => {
    const sink = new TestSink();
    const system = createAudioSystem({
      sink,
      routeTable: {},
      missingEventPolicy: 'throw',
    });

    expect(() => system.emit({ type: 'combat.boost' })).toThrow('Missing route or cue');
    const diagnostics = system.getDiagnostics();
    expect(diagnostics.missingRoutes).toBe(1);
    expect(diagnostics.lastMissingType).toBe('combat.boost');
  });
});

