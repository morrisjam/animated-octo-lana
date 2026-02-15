import { describe, expect, test } from 'vitest';
import { createAudioSystem } from './system';
import type { AudioBusId, AudioEvent, AudioRoute } from './types';

class TestSink {
  played: Array<{ event: AudioEvent; route: AudioRoute }> = [];
  busVolumes: Array<{ bus: AudioBusId; volume: number }> = [];
  disposed = false;

  play(event: AudioEvent, route: AudioRoute): void {
    this.played.push({ event, route });
  }

  setBusVolume(bus: AudioBusId, volume: number): void {
    this.busVolumes.push({ bus, volume });
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

