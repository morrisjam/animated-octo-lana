# AI Flow Diagnosis

Date: 2026-09-05. Investigated HEAD: `09fc4ea`.

**Status: read-only investigation. No candidate AI fix implemented or verified.**
AI changes await explicit user approval. This report does not authorize changes
to character stats, combat rules, gate thresholds, or the test seed matrix.

## Reproduction

CI run: https://github.com/morrisjam/animated-octo-lana/actions/runs/33969999252

From `apps/game-web`, run:

```sh
npm run ai:balance-gate
```

The unchanged local gate reproduced CI exactly: veteran Vanguard versus Duelist,
12 sets / 36 rounds per seat ordering, 90-second maximum rounds.

- Blocked Chase: `11/36 = 0.306`, above the `0.25` maximum.
- Vanguard zero-fuel finish conversion: `2/19 = 0.105`, below the `0.20` minimum.
- The mirrored matchup produced the same failures with player seats swapped.

Generated local evidence lives under `apps/game-web/build-artifacts/`:

- `ai-balance-regression-report.json` and `.md`.
- `ai-balance-regression-report-replays/veteran-duelist-vs-vanguard-loop-chase-g12-r1-replay.json`.

Replay frames below are one-based. The emitted chase replay is mirrored:
Duelist is P1 there; the diagnosis below uses Vanguard P1 / Duelist P2.
The gate seeds were not changed. Finish-attempt replay reconstruction checked
every reconstructed frame against its recorded checksum.

## Confirmed Behavior

### Post-return dash creates a punish window

Across the 36 Vanguard-P1 rounds, all 53 Duelist control-return windows ending
in a pressure-range relaunch within one second had its movement-dash special
as the first accepted action. Vanguard had eight immediate-relaunch windows,
only one with its guard special first. Guard spam is therefore not the primary
cause identified by this evidence.

Seed `2188322406`, round 1:

- Frame 1040: Duelist regains control at 15.24 units; both fighters are action-ready.
- Frame 1041: Duelist selects dash plus ordinary boost. Dash is its only positive
  tactical candidate weight (`0.836`); no post-event spacing is active.
- Frame 1044: Vanguard starts launch while Duelist remains committed.
- Frame 1052: launch connects, only 0.20 seconds after control return.

An in-memory probe vetoed only that frame-1041 dash, leaving subsequent AI live.
Duelist could parry at frame 1047 and was not relaunched through frame 1100.
This demonstrates the local commitment problem, not a sustained-reset or
whole-gate improvement.

Relevant code: `apps/game-web/src/sim/ai.ts:1064` (existing first-choice window),
`:1806` (dash suppression), and `:1849` (dash weighting).

### Finish acceptance ignores when contact can occur

The finish check uses a static 33.275-unit Vanguard commitment range and
bypasses velocity safety for exact-zero-fuel helpless targets. Steering lead
does not change the acceptance calculation. Vanguard's dunk startup is 31
frames; the target can regain control earlier through the speed-based natural
release rule despite a long remaining helpless timer.

Of the 19 counted Vanguard finish attempts:

- 14 were interrupted by a recovered Duelist launch before dunk connection.
- Two whiffed; two won.
- One hit a target with 0.12 fuel and caused recovery rather than victory. The
  existing telemetry bucket includes fuel ratios at or below `0.001`; this is
  not a request to change that threshold.
- Vanguard had zero fuel at the start of 15 attempts. Interrupted attempts
  generally began around 32-33 units away, with target control returning 2-26
  ticks later.

Seed `44521056`, round 3:

- Frame 3494: Vanguard starts dunk at 33.10 units.
- Frame 3518: Duelist regains control and immediately requests launch.
- Frame 3524: launch connects before dunk can connect at frame 3526.

An input-only branch from the same recorded encounter started dunk at frame
3481, while the target was closing from 48.87 units, and won legally at frame
3513. Starts at 3485 and 3489 also won. These are diagnostic branches using the
recorded subsequent inputs, not a tested replacement AI policy.

Relevant code: `apps/game-web/src/sim/ai.ts:886-919` (finish acceptance),
`:922` (steering lead), and `:1514` (finish movement);
`apps/game-web/src/sim/sim.ts` (`applyDunkStartupPursuit`,
`resolveHelplessReleaseSpeed`, and `updatePlayer`).

### Alternative explanations checked

Suppressing boost and super-boost throughout the two boosted misses did not
rescue either. One minimum active-window distance worsened from 15.72 to 32.06
units. A blanket boost ban is not supported by these probes.

Both shipped fighters have zero default parry startup. The gate replay scan
found no active-super-boost dunk interruptions for either seat. The repaired
dunk fuel-settlement path is therefore not a demonstrated direct cause of
these failures. Timer corrections change deterministic encounters, but this
investigation did not isolate the contribution of every prior simulation fix.

## Proposed Minimal Follow-up

Subject to approval:

1. Extend dash eligibility during the existing post-control first-choice window
   to reject an inward movement dash into an action-ready opponent without a
   punishable opening. Preserve movement, reactive defense, and genuine punish
   or finish opportunities; do not globally suppress specials.
2. Replace distance-only finish acceptance with a time-aware interception check
   over authored startup and active frames. Account for target velocity,
   damping, speed-based control return, and arena wrapping. Permit feasible
   earlier closing interceptions instead of merely reducing attempts or
   increasing a distance multiplier.

Do not lower gate thresholds, select easier seeds, increase frame budgets, or
change character stats/combat rules to address these AI decisions.

## Proposed Acceptance Tests

- In `ai.test.ts`, cover fresh pressure-range control returns against ready
  opponents: reject the unsafe dash while retaining steering and timely parry.
  Cover genuine punish openings and both player seats to avoid a blanket ban.
- Add closing, receding, imminent-release, and arena-wrap finish cases using
  authored move data. Assert actual contact/win or a justified wait, not just
  the selected input flag. Retain nonzero-fuel overshoot coverage.
- Reproduce the two recorded incidents above and their mirrors. Verify the
  chase change preserves defensive choice and the finish change converts a
  feasible intercept rather than only shrinking the metric denominator.
- Verify deterministic repeated runs and recorded-input replay/checksum
  agreement, then run the existing simulation and rollback tests.
- Run the unchanged full `ai:balance-gate` matrix. Require all thresholds to
  pass, including Chase and finish conversion; inspect attempts, wins, resets,
  action diversity, and resource use for regressions, not just the two ratios.

No whole-gate candidate result exists yet. Source remained unchanged during
the investigation; only generated local diagnostic artifacts were produced.
