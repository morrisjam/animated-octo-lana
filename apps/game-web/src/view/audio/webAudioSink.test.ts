import { describe, expect, test, vi } from 'vitest';
import type { AudioRoute, AudioSampleLibrary } from './types';
import { WebAudioEventSink } from './webAudioSink';

class FakeAudioParam {
  value = 0;

  setValueAtTime(value: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeAudioNode {
  connections: FakeAudioNode[] = [];
  disconnected = false;

  connect(target: FakeAudioNode): FakeAudioNode {
    this.connections.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeStereoPannerNode extends FakeAudioNode {
  pan = new FakeAudioParam();
}

class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam();
  starts = 0;
  stops = 0;

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
  }
}

class FakeBufferSourceNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  playbackRate = new FakeAudioParam();
  onended: (() => void) | null = null;
  starts = 0;
  stops = 0;

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
    this.onended?.();
  }
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 2;
  destination = new FakeAudioNode();
  gains: FakeGainNode[] = [];
  panners: FakeStereoPannerNode[] = [];
  oscillators: FakeOscillatorNode[] = [];
  sources: FakeBufferSourceNode[] = [];
  decodedMarkers: number[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  createGain(): GainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node as unknown as GainNode;
  }

  createStereoPanner(): StereoPannerNode {
    const node = new FakeStereoPannerNode();
    this.panners.push(node);
    return node as unknown as StereoPannerNode;
  }

  createOscillator(): OscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node as unknown as OscillatorNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.sources.push(node);
    return node as unknown as AudioBufferSourceNode;
  }

  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    const marker = new Uint8Array(data)[0] ?? 0;
    this.decodedMarkers.push(marker);
    return Promise.resolve({ marker } as unknown as AudioBuffer);
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
}

const SAMPLE_LIBRARY: AudioSampleLibrary = {
  schemaVersion: 1,
  samples: [{
    id: 'combat_launch',
    maxConcurrent: 1,
    variants: [
      {
        id: 'light',
        sources: [
          { src: '/launch-light.ogg', mimeType: 'audio/ogg; codecs=opus' },
          { src: '/launch-light.mp3', mimeType: 'audio/mpeg' },
        ],
      },
      {
        id: 'heavy',
        sources: [{ src: '/launch-heavy.mp3', mimeType: 'audio/mpeg' }],
      },
    ],
  }],
};

const SAMPLE_ROUTE: AudioRoute = {
  bus: 'sfx',
  sample: { sampleId: 'combat_launch', gain: 0.6, playbackRate: 1.1 },
  cue: { waveform: 'triangle', frequencyHz: 380, durationSeconds: 0.12, gain: 0.026 },
};

function responseWithMarker(marker: number): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(Uint8Array.of(marker).buffer),
  } as Response;
}

function failedResponse(status: number): Response {
  return {
    ok: false,
    status,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as Response;
}

describe('WebAudio sampled playback', () => {
  test('stays dormant before a gesture and safely unlocks from the gesture listener', async () => {
    const context = new FakeAudioContext();
    const unlockTarget = new EventTarget();
    const contextFactory = vi.fn(() => context as unknown as AudioContext);
    const sink = new WebAudioEventSink({
      contextFactory,
      unlockTarget,
      isUserActivationActive: () => false,
    });

    sink.setBusVolume('sfx', 0.4);
    sink.play({ type: 'combat.launch' }, SAMPLE_ROUTE);
    expect(contextFactory).not.toHaveBeenCalled();
    expect(context.resumeCalls).toBe(0);

    unlockTarget.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();

    expect(contextFactory).toHaveBeenCalledTimes(1);
    expect(context.resumeCalls).toBe(1);
    expect(context.gains[2]?.gain.value).toBe(0.4);
    expect(sink.getDiagnostics().unlockSuccesses).toBe(1);
    sink.dispose();
  });

  test('preloads all variants, prefers supported formats, and caches fetch and decode work', async () => {
    const context = new FakeAudioContext();
    const fetcher = vi.fn(async (src: string) => {
      if (src.includes('heavy')) {
        return responseWithMarker(2);
      }
      return responseWithMarker(1);
    });
    const sink = new WebAudioEventSink({
      sampleLibrary: SAMPLE_LIBRARY,
      contextFactory: () => context as unknown as AudioContext,
      unlockTarget: null,
      fetcher,
      canPlayType: (mimeType) => mimeType === 'audio/mpeg' ? 'probably' : '',
    });

    const first = await sink.preload(['combat_launch']);
    const second = await sink.preload(['combat_launch']);

    expect(first).toEqual({
      requestedSampleIds: ['combat_launch'],
      loadedVariants: 2,
      failures: [],
    });
    expect(second.loadedVariants).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith('/launch-light.mp3');
    expect(context.decodedMarkers).toEqual([1, 2]);
    expect(context.resumeCalls).toBe(0);
    sink.dispose();
  });

  test('tries the next browser format when a preferred source cannot be loaded', async () => {
    const context = new FakeAudioContext();
    const fetcher = vi.fn(async (src: string) => (
      src.endsWith('.mp3') ? failedResponse(415) : responseWithMarker(7)
    ));
    const fallbackLibrary: AudioSampleLibrary = {
      schemaVersion: 1,
      samples: [{
        id: 'format_fallback',
        variants: [{
          id: 'default',
          sources: [
            { src: '/fallback.ogg', mimeType: 'audio/ogg; codecs=opus' },
            { src: '/preferred.mp3', mimeType: 'audio/mpeg' },
          ],
        }],
      }],
    };
    const sink = new WebAudioEventSink({
      sampleLibrary: fallbackLibrary,
      contextFactory: () => context as unknown as AudioContext,
      unlockTarget: null,
      fetcher,
      canPlayType: (mimeType) => mimeType === 'audio/mpeg' ? 'probably' : 'maybe',
    });

    const result = await sink.preload(['format_fallback']);

    expect(result.loadedVariants).toBe(1);
    expect(result.failures).toEqual([]);
    expect(fetcher.mock.calls.map(([src]) => src)).toEqual([
      '/preferred.mp3',
      '/fallback.ogg',
    ]);
    expect(context.decodedMarkers).toEqual([7]);
    sink.dispose();
  });

  test('uses the caller-selected variant and routes the sample through the requested bus', async () => {
    const context = new FakeAudioContext();
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Sample playback must not use random selection.');
    });
    const sink = new WebAudioEventSink({
      sampleLibrary: SAMPLE_LIBRARY,
      contextFactory: () => context as unknown as AudioContext,
      unlockTarget: null,
      fetcher: async (src) => responseWithMarker(src.includes('heavy') ? 2 : 1),
      canPlayType: () => 'probably',
    });

    await sink.preload(['combat_launch']);
    await sink.unlock();
    sink.play({
      type: 'combat.launch',
      sampleVariantId: 'heavy',
      pan: 0.25,
    }, SAMPLE_ROUTE);

    const source = context.sources[0];
    expect((source?.buffer as unknown as { marker: number }).marker).toBe(2);
    expect(source?.playbackRate.value).toBe(1.1);
    expect(context.gains[4]?.gain.value).toBe(0.6);
    expect(context.panners[0]?.pan.value).toBe(0.25);
    expect(context.panners[0]?.connections[0]).toBe(context.gains[2]);
    expect(sink.getDiagnostics().sampledPlays).toBe(1);
    random.mockRestore();
    sink.dispose();
  });

  test('enforces per-sample concurrency without replacing the active voice by default', async () => {
    const context = new FakeAudioContext();
    const sink = new WebAudioEventSink({
      sampleLibrary: SAMPLE_LIBRARY,
      contextFactory: () => context as unknown as AudioContext,
      unlockTarget: null,
      fetcher: async () => responseWithMarker(1),
    });

    await sink.preload(['combat_launch']);
    await sink.unlock();
    sink.play({ type: 'combat.launch', sampleVariantId: 'light' }, SAMPLE_ROUTE);
    sink.play({ type: 'combat.launch', sampleVariantId: 'light' }, SAMPLE_ROUTE);

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.stops).toBe(0);
    expect(sink.getDiagnostics().sampleConcurrencyDrops).toBe(1);
    sink.dispose();
  });

  test('plays the tone fallback while an unprepared sample loads for later events', async () => {
    const context = new FakeAudioContext();
    const sink = new WebAudioEventSink({
      sampleLibrary: SAMPLE_LIBRARY,
      contextFactory: () => context as unknown as AudioContext,
      unlockTarget: null,
      fetcher: async () => responseWithMarker(1),
    });

    await sink.unlock();
    sink.play({ type: 'combat.launch', sampleVariantId: 'light' }, SAMPLE_ROUTE);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.oscillators[0]?.starts).toBe(1);
    expect(sink.getDiagnostics().sampleFallbacks).toBe(1);
    expect(sink.getDiagnostics().tonePlays).toBe(1);

    await sink.preload(['combat_launch']);
    sink.play({ type: 'combat.launch', sampleVariantId: 'light' }, SAMPLE_ROUTE);
    expect(context.sources[0]?.starts).toBe(1);
    sink.dispose();
  });
});
