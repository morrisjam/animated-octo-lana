# Balance Telemetry and AI Regression Gate

Gravity Well records deterministic, sparse combat events alongside the existing match summary. Telemetry is observational and is not included in rollback state or simulation checksums.

## Schemas

- Match summary: `gw.match-telemetry.v7`
- Combat event stream: `gw.combat-events.v5`
- Multi-round aggregate: `gw.match-telemetry-aggregate.v7`
- AI batch report: `gw.ai-matchup-batch.v15`
- AI threshold file: `gw.ai-balance-thresholds.v9`
- Training summary: `gw.training-telemetry.v3`
- Training export envelope: `gw.training-telemetry-export.v3`
- Per-tick AI decision trace: `gw.ai-decision-trace.v3`
- Retained AI decision telemetry: `gw.ai-decision-telemetry.v3`
- Replay AI decision trace: `gw.replay-ai-decision-trace.v2`
- Local AI replay provenance: `gw.local-ai-replay.v1`
- Incident replay comparison: `gw.balance-replay-comparison.v1`
- Human-annotated balance experiment: `gw.balance-lab-experiment.v7`
- Local per-side controller roles: `gw.ai-controller-roles.v1`
- Local gameplay-loop test recipe: `gw.balance-test-recipe.v1`
- Deterministic starting situation: `gw.balance-scenario.v1`
- Local AI match export: `gw.ai-match-telemetry-export.v8`

Every match summary includes the character registry schema, a hash of the active character rules, and each player's character/package version. Aggregation rejects mixed registry hashes or mixed loadouts. Training exports retain immutable `runs[]`; a change to tuning, scenario sample, loadout, package, registry, or character rules starts a new run instead of relabelling prior frames. Top-level training metrics describe only the latest run, and legacy v1/v2 data remains explicitly unattributed where package identity was not recorded. Balance Lab exports also include the derived six-stage loop chain for **Neutral -> Commitment -> Exchange -> Separation -> Chase -> Finish**; its status comes only from the recorded flow evidence and never from class win percentage. Experiment v7 retains separate baseline/candidate notes and an explicit `unrated|clear|mixed|blocked` human verdict for every stage, and carries the current clash-cause evidence. Those annotations are preserved for design review but are never read by simulation, regression thresholds, or ranked logic.

Local AI-vs-AI rounds may assign an independent controller role to each side. `adaptive` runs the full difficulty profile; `passive`, `defensive`, and `evasive` are deterministic designer fixtures for offense/collision, defense timing, and pursuit/separation tests. Roles are frozen on clean restart, included in the scenario fingerprint and replay label, and exported as active and pending objects plus fingerprints. Balance Sparring uses only P2's selected role and identifies P1 as human. These local roles are not used by ordinary human sparring, Arcade, Online, or Ranked matches.

The versioned gameplay probes compose one starting situation and two controller roles around a single designer question. Known combinations retain a recipe id in scenario identity; changing either component manually produces `custom` rather than guessing intent. Probe identity is therefore validated with the same seed, scenario, role, loadout, package, and rules evidence as every other Balance Lab comparison.

Local AI sets retain a stable match seed but derive a distinct deterministic round seed and separate P1/P2 AI streams for every automatic round. Manual Balance Lab restarts retain the current round seed and selected starting situation so baseline and candidate samples remain directly reproducible. Balance Sparring retains that seed for a clean candidate restart, records P1 as human, and verifies each round's actual input/checksum stream independently rather than claiming the human repeated identical inputs. The v8 local AI export records `matchSeed`, `roundSeed`, zero-based `roundIndex`, scenario identity, and retained AI decisions; its legacy `seed` field is the current round seed. Live and batch AI replay headers optionally carry `gw.local-ai-replay.v1` provenance with the profile, match/round/index seeds, independent controller seeds, controller roles, exact behavior tuning, and recovery/clash/pursuit policy ids. Replay headers also carry the versioned scenario when a non-standard state is used. Live and batch AI review replays may carry the optional `gw.replay-ai-decision-trace.v2` stream; ranked, human, and replay payloads without this optional block remain unchanged. Human-vs-AI sparring replays retain exact inputs for both players and a one-sided P2 decision trace without falsely claiming two-controller AI provenance. The reader migrates v1 replay traces with v2 decisions and v5 AI tuning to the current schemas with zero commitment controls, while rejecting new intents mislabeled as legacy data. **Pause -> Review Latest Local Round** and decision-event links reconstruct the actual live input sequence from that state, verify per-frame checksums, and return to the same paused match on exit. At each traced event the viewer correlates intended movement/action, emitted input, simulator acceptance, and the matching resolution. The flow panel derives the same deterministic plain-language Fight story as Balance Lab, including its first Blocked/Watch stage and suggested existing probe; Replay Review renders that guidance read-only. A decision focus range gets its own telemetry tracker during reconstruction, so its flow panel reports only that window while the full-round review remains available elsewhere on the timeline. The in-memory `gw.balance-replay-comparison.v1` pair preserves one reviewed incident across baseline and candidate, validates both checksum streams, enforces zero-or-one effective rule changes, and opens both variants on the same frame.

## Captured signals

- edge-triggered action presses, simulation-accepted action starts, and accepted combat-start cadence per minute
- per-tick AI movement intent, selected tactical action and reason, deterministic selection rolls, contextual gates, candidate weights, and blocker reasons
- launch hits, launch hits received, helpless seconds per received hit, and launch clashes split by active-vs-active, global startup grace, recovery-counter grace, or explicitly unattributed legacy inference
- successful parries and launch breaks
- dunk hits, including recovery and round-winning outcomes
- special resolves and projectile spawn/end outcomes
- fuel depletion, fuel lost/restored, zero-fuel time, and helpless time
- physical-contact occupancy using combined fighter radii plus a 0.75-unit tolerance, with distinct episode count and sorted average, p90, and maximum episode duration
- per-player approach, retreat, orbit, and idle intent while in contact, including a separate both-fighters-controllable contact slice
- shared movement-control time, where neither fighter is helpless, stunned, or in forced dunk recovery; shared action-ready time, where neither fighter is additionally in end lag, parry, or an active attack commitment; and action-ready share of shared control
- contact and pressure while both fighters retain movement control, separated from contact and pressure while both are simultaneously action-ready
- shared neutral decision episodes where both fighters are action-ready outside pressure, including average, p90, maximum, and the count/total duration of windows lasting at least 0.75 seconds
- exclusive point-blank, pressure, mid, and long spacing bands
- the starting spacing band at frame zero, followed by every band transition; current transitions also retain closing/separating speed and each fighter's approach/orbit/retreat/idle intent, held and active boost state, controllability, and action-recovery state
- sustained reset conversion for clashes, parries, and launch breaks independently
- pressure exchanges grouped by accepted opener, concrete outcome, duration, exit band, and sustained neutral window
- launch-break reaction timing and the zero-fuel launch-to-dunk-to-win funnel
- opponent-relative movement intent on controllable frames: approach, orbit, disengage, and idle, with separate pressure and point-blank approach/disengage counts
- round end and winner attribution
- natural and launch-break control returns; post-step distance plus `controlReturnStartDistance` captured on entry to the return frame before reset displacement; return-to-relaunch windows; first accepted action and action delay after return; sustained pressure exits measured independently from the control-return moment and from the first action; accepted actions before re-launch
- first accepted action after every launch clash, its delay and pressure context, rapid launch recommit, per-action mix, and whether another clash follows within one second
- first accepted action after every pressure exit, its actor and delay, plus brief exits that returned to pressure without any newly accepted action; these carried re-entries are attributed to held boost, held approach, action-recovery momentum, uncontrolled momentum, residual closing velocity, or unknown legacy context

An edge-triggered press is input intent. `action_start` means the simulation accepted the action. Offline direct-step telemetry receives accepted starts from an optional simulation observer, so an action consumed or cleared later in the same frame is still recorded without entering rollback state or checksums. The Balance Lab and batch report show accepted/requested counts independently for launch, special, dunk, parry, and launch break. Conversion rates use accepted starts, so holding or spamming a rejected input does not lower or inflate hit conversion.

Threshold schema v9 gates loop quality that aggregate spacing alone can hide: average sustained-neutral duration, resolved-exchange ratio, exchange reset ratio, brief-exit ratio, unresolved-pressure duration, contact-episode p90 and maximum duration, launch-break reaction timing, zero-fuel finish-start cadence, qualified finish completion, launch-to-dunk delay, and both the reached-round issue and Blocked ratios for Commitment and Chase. Stage ratios qualify only after 12 reached rounds in a directed pairing. Repeat clashes, rapid post-clash launch, immediate re-launch, failed control-return resets, carried brief re-entry, and finish completion also use explicit minimum denominators; sparse evidence is reported but does not manufacture a pass or failure. Finish completion means a round-winning dunk divided by zero-fuel finish starts once enough starts exist; it is not a class set-win percentage. Combat stream v3 and later distinguish per-hit helpless duration from immediate re-launch after control actually returns. Version 4 adds causal context to spacing transitions. Version 5 adds simulator-owned clash causes; direct local simulation, AI batches, and replay reconstruction retain exact attribution, while rollback-only flash inference is labelled `unattributed` rather than assigned a guessed cause. Telemetry remains outside rollback state. Character win percentage remains report-only.

Valid parries and launch breaks are latched before committed combat resolution. Existing specials then resolve for both players, followed by both launches and both dunks, before either locomotion phase. Launch clashes consult only captured frame-start launch state. This prevents a seat from gaining an extra movement/fuel frame before a hit or observing a same-frame action transition unavailable to the other seat. Mirrored-state tests cover complete AI-driven combat, the shared 12-seed batch matrix, and all five possible round indices.

`fuelLost` and `fuelRestored` describe state deltas only. They intentionally do not claim whether a loss came from movement, an attack cost, damage, recovery, or an arena penalty. Causal fuel accounting requires explicit simulation events and must not be inferred from the delta.

## Run a batch

From the repository root:

```bash
npm run ai:batch -- -- --games 12 --max-round-seconds 90 --difficulty veteran --p1 vanguard --p2 duelist
```

The root command contains two `--` separators because it forwards arguments through a second workspace-level npm script. From `apps/game-web`, invoke `npx tsx scripts/ai-matchup-batch.ts` directly as shown below.

Run all mirrored pairings for a character subset directly from `apps/game-web`:

```bash
npx tsx scripts/ai-matchup-batch.ts --games 12 --max-round-seconds 90 --difficulty veteran --characters vanguard,duelist
```

In PowerShell, quote comma-separated lists such as `--difficulty "cadet,veteran"` and `--characters "vanguard,duelist"`; otherwise PowerShell can split them into positional arguments.

Reports are written to `apps/game-web/build-artifacts/ai-matchup-batch-report.json` and `.md`. Pass `--output-dir "C:/path/to/reports"` to keep temporary experiments outside the watched project tree or place them on another local drive.

Use `--recovery-policy legacy|spacing|evasive` to screen behavior after launch control returns, `--clash-policy legacy|spacing` after a launch clash, and `--pursuit-policy legacy|neutral_hold` after an ordinary pressure exit without changing source. These are independent switches and all three selected policies are included in the report. Every shipped default is `legacy`; every alternative is a local experiment. When all three policies are `legacy`, no experimental posture is added and the report carries the current `flow-v16` controller fingerprint. Experimental combinations receive distinct fingerprints. A strict `--compare-report` requires the same base AI fingerprint and selected policy set, so it cannot accidentally present a controller-revision or policy change as a tuning result.

The in-game AI flow editor in AI vs AI and Balance Sparring adds a versioned `gw.ai-behavior-tuning.v10` object to `gw.balance-lab-draft.v3`. It exposes engagement distance, neutral inward drive, ordinary boost-distance offset, reaction/error/risk scaling, pressure-exit hold, zero-default commitment observe/press/reset phases, an authored-recovery-aware post-commitment read, post-clash and post-recovery spacing, a tactical-action-preserving post-control steering window, an attacker-only opponent-recovery respect window, an authored-startup-aware post-control defense window, separate block-special and threat-parry chances, a one-roll timing-valid committed-launch Guard response, retreat/escape posture, finish-only authored dunk-pursuit reach, and action-choice weights. Finish pursuit ships at `0.70`; v5/v6 data retains historical `0.25`, v7 data receives neutral steering, v8 data receives neutral opponent-recovery respect, and v9 data receives a zero post-commitment read. Any non-neutral value receives a distinct AI behavior/profile fingerprint. The batch CLI rejects unknown `--flags` instead of silently running a default scenario after a typo.

Global tuning now also includes zero-default `naturalRecoveryResetMultiplier`. It scales the existing bilateral defense reset only for a natural control return that still occurs inside the scaled reset distance and while the recovering fighter retains at least 20% fuel; launch breaks keep their independent scale, low-reserve and already-safe returns receive no free impulse, and simultaneous returns resolve once after both player updates. The **Control return pressure** starting situation and **Post-control agency** gameplay probe isolate this transition locally. Immediate re-launch, Post-control reset failure, Chase, and Separation evidence link directly to the control, but no diagnostic changes it automatically. Control-return pressure classification uses the pre-displacement `controlReturnStartDistance` with a legacy fallback to ordinary event distance, preventing a successful reset from shrinking its own denominator.

`postControlCounterLaunchClashGraceSeconds` is a second zero-default local mechanics probe. After genuine natural or launch-break control return, only the first simulation-accepted action within one second can qualify; it must be a launch, and it can clash only with an opposing launch started after control returned. It does not armor the fighter against an attack that was already committed. A fixed-seed mirrored Cadet/Veteran screen tested a two-frame value and rejected it: pooled first-second re-launch fell only from about `34.1%` to `29.9%`, below the predeclared relative-improvement target, while sustained post-return reset conversion fell from about `36.3%` to `33.1%` and clash cadence increased sharply. The live default remains `0`; **Recovery Counter-Launch Grace** is retained only so the exact situation can be inspected manually with causal telemetry.

The Markdown report leads with a versioned **Designer Brief** and the aggregate **Neutral -> Commitment -> Exchange -> Separation -> Chase -> Finish** chain for every directed pairing. The brief ranks shared bottlenecks from Blocked and Watch evidence only, with Blocked evidence weighted twice, counts Waiting separately, lists the most repeated AI/global/character lever families, and retains one deterministic representative for each priority. It never receives set wins or class win rate as input. Each detailed stage reports Blocked, Watch, Observed, and Waiting round counts plus the Watch-and-Blocked flagged ratio. Waiting stays distinct because a short or early-ending round may never reach a later stage; it is not silently treated as failure. Detailed flow reports launch-clash cadence, accepted combat-start cadence, and launch pressure as both received-hit count and helpless seconds per received hit. This prevents repeated cancellations, action substitution, repeated conversions, and an overlong recovery window from being collapsed into one score. Set wins and class win percentages appear later as AI-policy or kit-asymmetry context only.

To turn the representative flow failures into exact local review files, add `--emit-review-replays`:

```bash
npx tsx scripts/ai-matchup-batch.ts --games 4 --max-round-seconds 60 --difficulty "cadet,veteran" --characters "vanguard,duelist" --report-name local-flow-review --emit-review-replays
```

The repository shortcut for that controlled local run is `npm run ai:flow-review`. When a v8 regression or alpha gate fails a qualified Commitment or Chase limit, it also emits one checksum-verified representative for each failed stage automatically; passing gates do not create those extra files.

The command creates `build-artifacts/local-flow-review-replays/*.replay.json` for each available flagged loop-stage representative, worst-unresolved, worst-brief-exit, worst-contact, and worst-timeout case. Each stage representative records the human-readable Watch or Blocked reason, affected player, relevant global tuning, and character control families in the parent report. Every replay contains the exact round seed, AI-generated input timeline, sparse decision trace, global tuning, per-character overrides, and a checksum for every simulated frame. Stage and timeout cases open on the final twelve seconds of the evidence round; exchange cases seek to the flagged exchange. In the local game choose **Replays -> Open Local Replay JSON** and select a file. The client re-simulates and verifies the full round before opening it. A replay produced by incompatible simulation code is rejected instead of being shown approximately. Generation, verification, and review are local and do not use Neon or the online API.

## Evaluate a Balance Lab draft

Use **Download Balance JSON** in the in-game Balance Lab, then run the candidate against the same scenario as a saved baseline:

```bash
cd apps/game-web
npx tsx scripts/ai-matchup-batch.ts --games 12 --max-round-seconds 90 --difficulty veteran --characters "vanguard,duelist" --report-name baseline
npx tsx scripts/ai-matchup-batch.ts --games 12 --max-round-seconds 90 --difficulty veteran --characters "vanguard,duelist" --draft "C:/path/to/gravity-well-balance.json" --compare-report build-artifacts/baseline.json --report-name candidate
```

`--draft` applies the exported global tuning, AI behavior tuning, and every staged per-character override before frame zero. The v15 report records the behavior-specific fingerprint, behavior-independent base AI fingerprint, effective character-rules identity, causal carried re-entry context, contact-lock evidence, shared-decision agency, outcome-independent Designer Brief, and an immutable `gw.ai-batch-rule-snapshot.v1` containing the exact sanitized global, effective character-override, and AI behavior inputs. `--compare-report` refuses reports with different seeds, pairings, controller revision, AI profile definitions or policies, package versions, simulation rules, game counts, or round limits. A v14-or-older report lacks the exact snapshot and must be regenerated before it can serve as a strict baseline.

For global, character-rule, and AI behavior experiments, use the strict comparison command above. By default v15 requires exactly one effective numeric rule change across global tuning, every registered character's resolved rules, and AI behavior. It writes the path, baseline value, candidate value, and delta into JSON and Markdown, rejects an unchanged draft, and rejects contaminated multi-variable drafts during preflight before simulation starts. Use `--allow-multi-rule-comparison` only for a deliberate compound experiment; the report is then labelled `explicit_multi_variable` and still lists every changed rule. A behavior candidate may have a different behavior-specific fingerprint because the exact snapshot now proves the declared independent variable, while the behavior-independent controller revision, profile definitions, policies, seed matrix, packages, simulation settings, game count, and round limit must still match. Compare loop, spacing, shared agency, reset, action, resource, timeout, and finish sections, or use the browser's matched experiment bundle, which records the rule change explicitly.

The comparison table reports candidate-minus-baseline deltas for average round duration, timeouts, physical contact, shared movement control, contact and pressure while both can steer, shared action-ready time and its share of shared control, action-ready contact/pressure/neutral, sustained shared decision windows, p90 shared-neutral duration, p90 and maximum contact-episode duration, point-blank and pressure occupancy, launch clashes, accepted combat-start cadence, spacing resets, parry and launch-break reset conversion, resolved exchanges, brief exits, carried brief re-entry, first accepted neutral-exit action delay, unresolved pressure, launch-break uses per round and reaction timing, helpless share, launch hits received per round, helpless seconds per received hit, immediate re-launch ratio, average control window before re-launch, sustained reset from the actual control-return moment, sustained reset after the first accepted action, first-action delay, post-clash recurrence, rapid post-clash launch recommit and post-clash decision delay, pressure droughts, missing dunk pipelines, dominant-action share, repeat streaks, and launch-to-dunk delay. Per-player both-active contact intent shows whether a lower contact number came from retreat, orbit, or a controller still driving into the opponent. Lower action cadence or a longer decision delay is descriptive rather than inherently positive: use the per-action mix to detect whether one repeated action was simply replaced by another or whether a pause only made rounds stall. Received-hit frequency, per-hit duration, post-return movement, first-action choice, post-clash choice, carried re-entry cause, and deliberate re-engagement must be interpreted independently because any one can create control lock. Missing funnels and zero-denominator ratios are reported as `N/A`, not as misleading zeroes. Causal neutral-exit deltas are also `N/A` when comparing a v8 candidate with a v7-or-older baseline because the attribution semantics changed; unchanged mechanics are not presented as a regression. The report deliberately does not use class win percentage as its headline score.

A reset attempt counts only when the exchange begins inside point-blank or pressure range. It succeeds when a continuous mid/long window of at least 0.75 seconds starts within two seconds. Same-frame displacement is evaluated from frame/sequence order rather than rounded timeline positions.

Each report stores the exact seed list, fixed timestep, rules, character registry hash, global tuning hash, character rules hash, AI behavior object/hash, package versions, selected recovery, clash, and pursuit policies, and effective AI profile hash. Experimental-policy hashes include difficulty values, all three policies, and an explicit policy revision. Neutral all-`legacy` reports carry the current `flow-v16` identity; any controller behavior change must advance that identity, and older revisions are rejected as strict comparison baselines. It also records gameplay-flow evidence independently from win rate: aggregate loop-stage counts, per-action accepted/requested counts, accepted combat starts per minute, contact-episode count and average/p90/maximum duration, per-player both-active contact intent, launch clashes per round/minute, post-clash action mix and recurrence, pressure-range launch-defense reads with pre-emptive/reactive timing, parry/guard/counter choice, outcome, unanswered hits, and durable reset conversion, sustained neutral resets, longest pressure sequences, resolved and unresolved exchange ratios, brief exits, causal carried re-entry mix, first neutral-exit action and delay, pressure duration per exchange, opponent-relative movement intent, post-control first-action mix and consequences, missing finish pipelines, tactical-action variety, dominant-action share, normalized action entropy, repeat streaks, launch-to-dunk delay, and dunk commit/hit motion. The movement and defensive-read tables are deliberately descriptive rather than win-rate gates: they reveal whether a controller recognizes commitment and whether the authored response works before collision, launch power, or class strength is retuned. For each directed pairing it retains replayable worst-unresolved, worst-brief-exit, and worst-contact samples with set/round seed, game, exchange number, time range, opener, outcome sequence, stop reason, exit band, first accepted neutral action, carried brief re-entry cause and closing speed, and contact duration. When a timeout occurs, it also retains one representative timeout with round-level spacing, reset, exchange, and finish-cadence context. Scenario seeds derive from the base seed, difficulty, sorted character pair, and game index. AI streams then derive from scenario seed, character id, and round; experimental posture choices use a separate deterministic stream. Mirrored directions therefore preserve both the scenario and each character's random stream, while traversal order cannot change matchup state or outcome.

## CI regression gate

```bash
npm run ai:balance-gate
```

The CI gate runs 12 deterministic, mirror-paired games for each directed Vanguard/Duelist pairing and evaluates `apps/game-web/content/balance/ai-regression-thresholds.json`. Every pairing is evaluated independently; a healthy direction cannot mask a dead reverse matchup. Commitment and Chase each have separate reached-round-qualified limits for any issue and for the more severe Blocked state. This lets the regression profile encode the accepted baseline while still rejecting a severity regression even when the broader issue ratio is already saturated. These are ratcheted pathology guards, not final balance targets.

CI runs this gate before the production build. Its detailed JSON and Markdown reports are written as `ai-balance-regression-report` artifacts.

## Online-alpha readiness gate

```bash
npm run ai:alpha-readiness
```

This larger 12-game run evaluates `apps/game-web/content/balance/online-alpha-ai-thresholds.json` for both Cadet (the local-menu default) and Veteran. It requires completed sets, low timeout rates, bounded physical-contact occupancy and contact-episode duration, bounded pressure occupancy, recurring successful neutral resets, denominator-qualified recurrence behavior, bounded helpless time, a functioning launch-to-dunk pipeline, accepted inputs, broad kit use, and bounded action repetition in every directed pairing and AI profile. Character win rates remain in the report as an AI/kit diagnostic, but are not an alpha blocker by themselves; human playtests will eventually determine matchup balance. A non-zero exit identifies a gameplay-loop blocker, not a reason to tune thresholds around the current output.

Normal CI runs `npm run ai:alpha-readiness:report`, which generates and archives the same evidence without emitting a misleading failed-build annotation while the game is intentionally pre-alpha. `npm run alpha:local-gate` remains strict, and `.github/workflows/safe-rollout.yml` reruns `ai:alpha-readiness` against the exact release SHA before any provider health, drain, or deployment call. A release therefore cannot use the advisory CI status to bypass the gameplay gate.

For interactive local iteration, use the in-game Balance Lab described in `docs/BALANCE_LAB.md`.

## Rollback boundary

Match-combat telemetry is currently recorded only for deterministic offline training and AI-vs-AI simulation. It is intentionally not recorded from online rollback sessions because predicted frame observations cannot yet be replaced after authoritative late input arrives. Online alpha uses rollback diagnostics, relay/SLO telemetry, and authoritative ranked settlement instead. Do not enable live online combat metrics until the tracker supports frame replacement and has a rollback-parity test.
