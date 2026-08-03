# Well Hazard Experiment

The gravity well has always been presentation: the fight happens on top of a pit, but nothing falls in. This experiment makes the well a gameplay object — a second, spatial route to the finish — targeting the two documented gameplay-loop debts in `docs/BALANCE_LAB.md`: "Launches do not become finishes" and "Zero-fuel stall".

Status: experimental. Every knob defaults to `0` (off). The default simulation is bit-identical with the experiment merged — verified by `replay:check` and the unchanged `default`/`mobility_focus_v1`/`control_focus_v1` rows in `smoke/matchup-regression.expected.json`.

## Rules

- **Core capture.** A fighter who is helpless (launched) while inside `wellCoreRadius` is swallowed by the well. Resolution reuses `startDunkRecovery` with the launcher (`lastLaunchedBy`) as the attacker: at zero fuel this wins the round under `allowDunkWin`; otherwise the standard dunk recovery runs (fuel cost, chain resets, the existing sink-into-the-pit recovery arc). Fighters in control, stunned fighters, and recovering fighters are never captured — you can hover over the pit; you fall in only when you cannot fly.
- **Corona drain.** Fighters in control inside `wellCoronaRadius` lose `wellCoronaDrainPerSecond` fuel per second. It never touches velocity or steering — zones change stakes, not handling. Helpless and recovering fighters are not drained.
- **Well pull.** While helpless, a fighter is accelerated toward the arena centre at `wellHelplessPull` units/s². Gravity whispers while you are in control and owns you when you are not: launches bend into arcs toward the pit, and the defender's break decision becomes a read of their own trajectory.
- **Missing-fuel launch scaling.** Launch power is multiplied by `1 + launchMissingFuelPowerScale × missingFuelFraction`. Empty tanks fly further, so a low-fuel fighter near the well is in permanent checkmate threat — the intended answer to zero-fuel stalling.

## Knobs

All live in `GameTuning` (`src/sim/types.ts`), clamped in `sanitiseTuning` (`src/sim/tuning.ts`), and exposed in the pause menu under **Debug Tuning → Well hazard (experimental)**.

| Knob | Default | `well_hazard_v1` | Clamp |
|---|---|---|---|
| `wellCoreRadius` | 0 (off) | 12 | 0–40 |
| `wellCoronaRadius` | 0 (off) | 34 | 0–72 |
| `wellCoronaDrainPerSecond` | 0 | 6 | 0–60 |
| `wellHelplessPull` | 0 | 30 | 0–300 |
| `launchMissingFuelPowerScale` | 0 | 0.5 | 0–3 |

Reference geometry: arena radius 72, fighter radius 2.25, dunk hit range 8. Under the profile's launch feel (power 180), an inward launch crosses wall-to-core in roughly 0.4s, so the break window is tight — the pull and core radius are the knobs to soften it if playtests want more reaction time; chain-scaled launches compress it further. Outward launches wrap at the rim and never transit the centre, so the escape route survives.

## Launch feel (profile-only for now)

The profile also carries a launch-state retune: `launchBasePower 180` (from 126), `helplessVelocityDamping 0.985` (from 0.995), `helplessReleaseSpeedRatio 0.7` (from 0.38). Launches become ~1.5s explosive arcs — control returns as soon as the flight visibly stops — instead of ~5s drifts.

These deliberately stay **out of the base defaults**: with fast recovery, the old launch → chase → button-dunk pipeline collapses (dunk pursuit at 58 u/s cannot catch victims flying at ~180), so dunk-recovery fuel drains stop happening and matches stop reaching the zero-fuel finish — verified empirically: under these values even AI matches no longer produce a winner inside the ranked 3-minute round cap (`RANKED_MAX_FRAMES`). Inside this profile the well core replaces the collapsed finish route. Promoting the feel to base defaults therefore requires a companion decision first: buff dunk startup pursuit to new-physics speeds, retune the AI/thresholds around fuel-war finishes, or make the well hazard part of the default game.

## How to play it

- Balance profile: run with `VITE_BALANCE_PROFILE_ID=well_hazard_v1`, or
- Live: pause menu → Debug Tuning → Well hazard (experimental), in training / cpu_vs_cpu / balance_sparring (guarded by `balanceLabRuntime` like every local experiment).

## Replay, rollback, and ranked safety

- All five knobs are zero-default and registered in both `ZERO_DEFAULT_TUNING_KEYS` (`src/sim/replay.ts`) and `createGameTuningFingerprintInput` (`src/sim/tuning.ts`): historical replays, ranked proofs, and checked-in checksum baselines remain valid, and pre-experiment replay headers still validate.
- No `PlayerState` fields were added; `computeStateChecksum` is untouched.
- The profile is **not** listed in `RANKED_SUPPORTED_RULESET_VERSIONS`, so `+well_hazard_v1` cannot enter ranked.
- Coverage: `src/sim/wellHazard.test.ts` (capture, win-at-zero-fuel, hover safety, no re-capture during recovery, corona gating, pull determinism, missing-fuel scaling, checksum determinism + snapshot round-trip with the hazard active).

## Non-goals in this slice

- AI awareness: the AI's centre bias will walk it into the corona; fine for human playtests, required work before any promotion.
- Distinct capture presentation: capture currently reuses the dunk flash channel; a dedicated `well_capture` VFX/audio event is the follow-up (and should fix the `toCombatAudioEventType` default-arm fallback while there).
- Any default-profile or ranked adoption. Promotion goes knob-by-knob through balance candidate review, then requires a ruleset version bump with the client+API deployed as one unit.
