# Render Performance Foundations

## Scope

These modules define performance policies and measurements used by the current renderer:

- `apps/game-web/src/view/performance/tiers.ts`
- `apps/game-web/src/view/performance/adaptiveResolution.ts`
- `apps/game-web/src/view/performance/samples.ts`

`browserRuntime.ts` connects the Balanced policy to `main.ts` and `scene.ts` through a lazy-loaded
adapter. Simulation timing remains fixed; only render pixel ratio is adaptive.

## Performance Tiers

Three validated defaults provide a stable starting point:

| Tier | Initial pixel ratio | Adaptive bounds | Particle density | Background | Expensive effects |
| --- | ---: | ---: | ---: | --- | --- |
| Performance | 0.75 | 0.50-1.00 | 50% | Reduced | Bloom and distortion off |
| Balanced | 1.00 | 0.625-1.25 | 75% | Standard | Bloom and distortion on |
| Quality | 1.25 | 0.75-1.50 | 100% | Enhanced | Bloom and distortion on |

All default tiers target responsive 60 FPS rendering. `createPerformanceTierCatalog` accepts project-specific overrides and rejects invalid ranges, unstable hysteresis thresholds, and unsupported visual budgets. `resolvePerformanceTier` safely falls back to Balanced for unknown persisted values and returns a defensive copy.

## Adaptive Resolution

`AdaptiveResolutionController` is a deterministic state machine. It does not read clocks, browser globals, or renderer state itself. The caller supplies frame duration and a monotonic timestamp.

The controller provides:

- Hard global and tier-specific pixel-ratio bounds
- Separate upshift and downshift steps
- Fixed-size frame-time evaluation windows
- A threshold gap so borderline performance cannot oscillate between scales
- Different sustained-window requirements for degradation and recovery
- A cooldown after each scale change
- Ignoring of malformed samples
- Callbacks only when pixel ratio or reduced-motion state actually changes

Default policies downshift after two persistently slow windows. They require four or five persistently fast windows before increasing resolution. Samples collected during cooldown do not build another change streak.

`createAdaptiveResolutionConfig` also clamps a tier to the current device-pixel-ratio ceiling. Integration should call `renderer.setPixelRatio` only from `onPixelRatioChange`, not once per frame.

Reduced motion is deliberately independent from resolution selection. `setReducedMotion` publishes a typed hook so the stage, particles, camera and transitions can adopt their own accessible motion policies without altering simulation or frame timing.

## Performance Samples

`PerformanceSampleBuffer` stores safe, relative-time aggregates rather than per-frame history. The default capacity is 120 samples and the hard configurable maximum is 600.

Each sample can contain:

- Elapsed time since the local measurement session began
- Mean and p95 frame time
- FPS
- Active pixel ratio
- Draw calls, triangles, geometries, and texture counts

Samples contain no absolute timestamp, account data, hardware name, URL, or arbitrary metadata. Snapshots are defensive copies and can be passed directly into the crash-bundle builder.

## Runtime Status And Next Work

- Balanced adaptive resolution is enabled by default and bounded by device pixel ratio.
- Mean/p95 frame time and renderer counters are sampled once per second into the bounded buffer.
- Background gaps are rejected, and adaptation is disabled while the platform is suspended.
- Reduced-motion preference is exposed on the document for presentation systems and diagnostics.

Graphics-tier selection, tier-specific particle/background budgets, and minimum-hardware frame
pacing evidence remain open. Those are visual-settings and hardware-QA tasks rather than renderer
architecture blockers.

## Verification

The deterministic tests use synthetic frame windows and timestamps; no GPU or wall clock is required:

```text
npx vitest run src/view/performance/tiers.test.ts src/view/performance/adaptiveResolution.test.ts src/view/performance/samples.test.ts
```
