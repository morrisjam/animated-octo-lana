# Audio Event Bus And Routing

## Goal
Route gameplay/view audio through typed events and named buses, without clip-path logic in gameplay code.

## Source files
- Audio event types: `apps/game-web/src/view/audio/types.ts`
- Event bus: `apps/game-web/src/view/audio/eventBus.ts`
- Router/system: `apps/game-web/src/view/audio/system.ts`
- Sample-library validation: `apps/game-web/src/view/audio/sampleLibrary.ts`
- Browser sample/tone sink: `apps/game-web/src/view/audio/webAudioSink.ts`
- Unit tests:
  - `apps/game-web/src/view/audio/system.test.ts`
  - `apps/game-web/src/view/audio/sampleLibrary.test.ts`
  - `apps/game-web/src/view/audio/webAudioSink.test.ts`

## Typed events currently routed
- Combat:
  - `combat.boost`
  - `combat.launch`
  - `combat.parry`
  - `combat.projectile`
  - `combat.dunk`
- Music:
  - `music.menu`
  - `music.match`
  - `music.neutral`
  - `music.launch`
  - `music.end`
- Voice:
  - `voice.round_start`
  - `voice.callout`

Combat events are emitted from VFX runtime callback wiring in `src/main.ts` when render combat events fire.

## Bus routing
- Supported buses:
  - `master`
  - `music`
  - `sfx`
  - `voice`
- WebAudio sink creates gain nodes per bus and routes event cues through the mapped bus.
- Bus volumes are clamped and adjustable via `setBusVolume`.

Both decoded samples and oscillator cues pass through the event pan node, then the
route's named bus, then the master bus. Setting a bus volume before WebAudio unlock
stores the value without creating an `AudioContext`.

## Sample library schema

Sample definitions use the explicit schema version `1`. A definition contains one
or more named variants, and each variant contains one or more browser source
formats. Keep the variant ID stable when replacing source files.

```ts
const sampleLibrary: AudioSampleLibrary = {
  schemaVersion: 1,
  samples: [{
    id: 'combat_launch',
    maxConcurrent: 3,
    overflowPolicy: 'drop-new',
    variants: [{
      id: 'light',
      sources: [
        { src: '/audio/combat/launch-light.opus.ogg', mimeType: 'audio/ogg; codecs=opus' },
        { src: '/audio/combat/launch-light.mp3', mimeType: 'audio/mpeg' },
      ],
    }],
  }],
};
```

The library rejects unsupported schema versions, duplicate sample or variant IDs,
empty source lists, invalid concurrency values, and non-audio MIME types. The
browser's `canPlayType` result determines source preference; remaining sources are
still attempted in order if the preferred source cannot be fetched or decoded.

No sample assets ship with this implementation. Add licensed or commissioned
files only after their provenance and runtime budgets are recorded.

## Sample routes and tone fallbacks

A route may contain a sample reference, a tone cue, or both. When both are present,
the tone remains an immediate fallback while a sample is not preloaded, missing,
or unavailable.

```ts
const routeTable: AudioRouteTable = {
  'combat.launch': {
    bus: 'sfx',
    sample: {
      sampleId: 'combat_launch',
      defaultVariantId: 'light',
      gain: 0.8,
      playbackRate: 1,
    },
    cue: {
      waveform: 'triangle',
      frequencyHz: 380,
      durationSeconds: 0.12,
      gain: 0.026,
    },
  },
};
```

An event-level `cueOverride` deliberately forces oscillator playback and preserves
the existing voice-callout behavior.

## Deterministic variants

Variant choice never calls `Math.random`. The emitter supplies the exact stable ID:

```ts
audioSystem.emit({
  type: 'combat.launch',
  playerId: 1,
  sampleVariantId: 'heavy',
});
```

Callers that derive variation from simulation state must derive and store the
variant ID themselves. Replays and rollback code must not depend on audio playback
state. If no event or route variant ID is supplied, the first declared variant is
selected deterministically.

## Preload and caching

Preload anticipated samples before entering the relevant screen or match:

```ts
const result = await audioSystem.preloadSamples([
  'combat_launch',
  'combat_parry',
]);
```

Omitting IDs preloads the complete library. The result reports requested sample
IDs, successfully decoded variant count, and per-variant failures. Fetch promises,
decoded source buffers, and resolved variants are cached, so repeated and
concurrent preload requests reuse work. Preload may create a suspended context for
decoding, but it never calls `resume` or starts playback.

If an event reaches an unprepared sample route, the sink starts loading that
variant for later events and plays the route's tone fallback immediately.

## Concurrency

- `maxConcurrent` defaults to four active voices per sample.
- `maxConcurrentSamples` defaults to 32 active sampled voices globally.
- `drop-new` is the default overflow policy and leaves current voices untouched.
- `steal-oldest` deterministically stops the oldest active voice for that sample.
- The global limit always drops the new voice rather than stopping an unrelated cue.

## Safe browser unlock

The sink does not create or resume an `AudioContext` merely because volume is set
or an event is emitted before interaction. It listens for pointer, keyboard, and
touch gestures and safely resumes the context from those handlers. Listeners remain
active so a browser-suspended context can resume after tab or device lifecycle
changes.

Hosts may also call `audioSystem.unlock()` directly from a trusted user-gesture
handler. Playback events are not queued across an inactive autoplay boundary, so a
stale combat cue cannot fire after the player eventually interacts.

## Adaptive music state
- Music state controller lives in `apps/game-web/src/view/audio/musicState.ts`.
- States: `menu`, `neutral`, `launch`, `end`.
- Main loop resolves state from app phase and render snapshot, then applies deterministic state-change triggers.
- Music bus gain transitions use configurable fade duration to avoid abrupt transitions.

## Missing route diagnostics
- Router tracks emitted/routed/missing counts.
- Missing route or missing cue handling policy:
  - `warn` (default): log diagnostic warning.
  - `throw`: fail immediately with explicit error for dev strictness.
- Main web runtime uses strict `throw` behavior when debug tools are enabled.

Diagnostics also expose sampled plays, tone plays, sample fallbacks, concurrency
drops, load failures, and successful/attempted unlock counts.
