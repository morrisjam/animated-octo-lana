# Gameplay, Visuals, and Balance Review

Date: 2026-09-05. Reviewed revision: `e8bf3c0`.

## Scope and conclusion

Read-only review of the current client, simulation, character presentation, balance workflow, menus, and selected matchmaking/session paths. This is not a security audit or a claim that every game mode has been exhaustively tested. No gameplay changes, deployments, or paid services were used for this review.

The project has substantial working infrastructure: deterministic simulation, replay/rollback machinery, configurable classes, telemetry, controlled AI roles, and a Balance Lab. The immediate problem is trust and readability. Some tools do not reflect what the simulation does; the camera and animation adapter can obscure valid actions; and the current stage and character art do not share a coherent visual language. More content or more settings would amplify those problems before solving them.

## Confirmed findings

### 1. [P1] Camera framing can lose fighters inside the arena

Location: `apps/game-web/src/view/render.ts:371`.

The camera follows only a fraction of the players' midpoint and derives zoom from their separation, without fitting their projected bounds to the viewport. Two nearby fighters near an arena edge therefore stay zoomed in while the camera looks too far toward the center. A projection check using the current 30-degree stage pitch and a 1440x900 viewport put both players at `(0,65)` and `(7,59)` above the top edge. Both positions are inside the radius-72 arena. This persists at the desired camera position, so it is not merely interpolation lag.

Fit both fighters, including sprite extents and HUD-safe margins, before applying presentation smoothing. Regression cases should cover every arena edge, launch states, close encounters, and narrow/wide aspect ratios. Make smoothing time-based rather than dependent on render frequency.

### 2. [P1] The online P2 client reads the wrong local controller slot

Location: `apps/game-web/src/main.ts:6935`.

The first attached controller is assigned to local P1, but an online participant assigned match seat P2 sends the local P2 input slot. A single controller can therefore navigate locally yet fail to move its fighter when that machine becomes online P2. The ownership assignment is in `src/input/controllerOwnership.ts:31` and `:140`; gamepad input is written in `src/input/gamepad.ts:101`.

Separate local device ownership from network seat identity. Test both online seats with one controller per machine, including reconnect and rematch. This was confirmed through the input path and an isolated input probe, not physical controller testing.

### 3. [P1] Waiting ranked tickets are not reconsidered as the skill window expands

Location: `apps/api/src/matchmaking/queueService.ts:765`.

Matching runs when a new ticket is created. Polling only cleans up and returns tickets (`:774`), and rejoining an existing ticket returns early (`:743`). Two players initially outside the permitted rating gap can remain queued after they become eligible unless another join happens to trigger matching. An in-memory test with ratings 1200 and 1500 reproduced this after the waiting-time allowance widened beyond their gap.

Re-evaluate eligible waiting tickets through a bounded, atomic server-side matching path. Cover widening, expiry, concurrent polling, and duplicate-session prevention.

### 4. [P2] A failed session lookup after a match can strand the client

Location: `apps/game-web/src/main.ts:2751`.

The client stores the matched ticket before fetching its session. If that fetch fails, polling stops because the ticket is no longer queued (`:3248`). A manual retry then takes the resume/rejoin path rather than the initial bootstrap path (`src/net/onlineSessionLifecycle.ts:68`). This is a concrete route to a matched-but-not-playing screen; it does not prove the cause of every earlier reported online failure.

Track ticket matching and successful session bootstrap separately. Retry recoverable bootstrap failures without requiring the previous ticket to remain queued. Test failure at each asynchronous boundary.

### 5. [P2] An ordinary paused match has no visible return-to-menu action

Location: `apps/game-web/src/view/pauseMenu.ts:996`.

The normal pause panel offers resume, review, settings, balance tools, and export, but no quit-to-menu action. Endless AI sparring also loops wins, so it never provides a natural match-over exit. The available escapes are debug-only controls or reloading the page. This was confirmed in the local browser.

Add a clearly labelled return-to-menu action, with appropriate confirmation and session/queue cleanup. Include it in gamepad navigation tests and all local modes.

### 6. [P2] The escape test dummy can boost toward its pursuer

Location: `apps/game-web/src/sim/aiControllerRoles.ts:234`.

The role selects an away movement direction but requests ordinary boost at close range. Ordinary boost pursues the opponent rather than following that direction. At 24 units of separation, the isolated probe moved the escaping P2 toward P1 while reporting `scripted_escape_boost`. This can make a viable retreat mechanic appear ineffective during controlled balancing.

Use an escape action that actually respects direction, or explicitly test ordinary boost as an approach commitment. Assert separation and resource use, not just the chosen input flag.

### 7. [P2] The exposed parry startup setting has no simulation effect

Location: `apps/game-web/src/sim/sim.ts:708`.

Starting a parry reads active and recovery frames but not startup frames. Setting startup to 60 frames still allows the immediate counter behavior of a zero-startup parry. The editor and frame-data description nevertheless expose startup as meaningful.

Either implement the startup phase consistently across simulation, presentation, telemetry, and rollback, or remove/lock this setting if instant parry is the intentional rule. Add behavioral tests for non-default values.

### 8. [P2] P2 skips the first frames of non-looping combat animations

Locations: `apps/game-web/src/view/characterVisual.ts:659` and `:759`; `src/view/sprites/atlasDefinitions.ts:120`.

P2 receives a 0.13-second animation offset that is applied to every clip. On the three-frame, 24-fps Vanguard launch startup, P1 begins at frame 12 while P2 immediately displays frame 14, the last startup frame. Specials and launch breaks are similarly affected. Identical classes consequently provide different visual tells depending on player seat.

Restrict decorative phase offsets to suitable looping animations. Combat clips must begin at the actual simulation phase and remain correct when replaying or seeking.

### 9. [P2] Ordinary attack recovery displays hit/get-up imagery

Locations: `apps/game-web/src/sim/sim.ts:2017`; `src/view/sprites/atlasDefinitions.ts:90`.

Ordinary attack end-lag is presented as `recover.recovery`, which also maps to recovery from being dunked. The current Vanguard recovery frames show a prone/get-up sequence; Duelist uses the same horizontal frame for helplessness and recovery. A character can therefore appear knocked down after its own attack without having been hit.

Separate attack follow-through from hit recovery, helpless travel, and dunk recovery in the presentation contract. Preserve action identity through recovery so the renderer can show the correct pose and punish window.

### 10. [P2] Dunk interruption drops accumulated super-boost fuel cost

Location: `apps/game-web/src/sim/sim.ts:821`; settlement guard at `:1295`.

A dunk directly clears the target's super-boost state before its accumulated travel cost is settled. This is reachable from the default initial state using normal inputs: continuously super-boost P2 along `(-1, 0.2)`, and have stationary P1 press dunk on frame 15 at 60 Hz. The dunk connects on frame 48; 54.86592 units of accumulated travel leave approximately 4.12327 fuel uncharged. The dunk's own recovery charge still applies.

Centralize action interruption and settlement so every exit path charges the same earned cost exactly once. Cover dunk, launch, round termination, and other interrupts with conservation-style tests.

### 11. [P2] Leaving the home menu for local play can abandon a live ranked ticket

Location: `apps/game-web/src/main.ts:4658`.

The teardown path ignores the home phase and does not consistently use the outstanding `playerRankedTicket`. Starting a local match while queued can stop client polling without canceling the server ticket, allowing another player to match against an absent participant.

Make leaving ranked queue an explicit lifecycle transition, independent of whether a transport/session has already been created. Test queued-to-local, queued-to-arcade, logout, and menu exit.

### 12. [P2] Switching accounts can copy arcade history into another account

Location: `apps/game-web/src/main.ts:3834`.

Account switching merges the current in-memory arcade history with the destination account's stored history before persisting it. Progress from account A can therefore appear in account B on the same browser. This is a progression correctness issue, not a security finding in this review.

Replace account-scoped state on identity changes. Keep any deliberate guest-progress migration separate and explicit. Test A-to-B-to-A switching.

### 13. [P2] Combat sound event routing conflates distinct actions

Location: `apps/game-web/src/main.ts:358`.

The audio mapping has no explicit cases for clash, special, or launch break, so they fall through to `combat.dunk`. These actions cannot reliably communicate their identity through the sound event pipeline even when distinct effects are available.

Map each supported event explicitly, with intentional silent/fallback behavior where needed. Validate the mapping exhaustively against the event union. This finding comes from source inspection, not an auditory comparison.

### 14. [P2] Training frame data ignores applied character tuning

Location: `apps/game-web/src/view/trainingFrameData.ts:10`.

Training supports Balance Lab overrides, but its frame-data overlay reads packaged character definitions rather than the active simulation configuration. Setting Vanguard launch startup to 60 frames and applying/restarting leaves the overlay reporting the default seven. This affects the Training overlay, not every mode's HUD.

Build the display from the same resolved character configuration used by simulation. Show its active fingerprint and test applying, importing, and resetting overrides.

### 15. [P2] Floating-point residue can add a startup tick

Location: `apps/game-web/src/sim/sim.ts:729`.

Startup timers subtract fractional seconds and wait for an exact non-positive result. Excluding the input acceptance tick, six full 60-Hz advancement ticks applied to a six-frame startup leave `2.0816681711721685e-17` seconds remaining. The move becomes active only on the seventh advancement tick. This is separate from the design choice about whether the acceptance tick counts.

Use integer simulation-frame counters for frame-authored timing, or a consistently tested tick-safe conversion. Audit the equivalent dunk and other action countdowns. Test all supported frame values, not just a few defaults, and update deterministic replay expectations deliberately.

### 16. [P2] A candidate that wins earlier cannot be captured as the baseline comparison

Locations: `apps/game-web/src/view/pauseMenu.ts:2396`; `src/sim/balanceReplayComparison.ts:188`.

The capture/comparison path rejects different replay lengths, but a candidate stops when it wins. A real simulation of the shipped `zero_fuel_chase` scenario, seed 42, Vanguard adaptive versus Duelist passive, changed P1's win from 209 to 184 frames when dunk range changed from 8 to 12. Both runs were recorded through the real replay recorder; the shorter candidate was rejected. This was reproduced through simulation/recording, not a browser click-through.

Support a common comparison interval plus explicit terminal outcomes and finish-time differences. Do not silently reject the very result a finish-reliability experiment is intended to measure.

## Visual review

### Arena and wormhole

The current luminous funnel is more developed than the earlier cone, but it dominates the composition. Broad bright blue bands and dense stars compete with small fighters and action effects. The arena mouth, playable surface, and distant throat do not read as three clearly separated depths. The active preset sets rim and depth-tick opacity to zero (`content/stages/atmospherePresets.ts:71`), removing useful spatial cues.

Recommended direction: two readable airborne fighters above a dark gravitational pit. Establish a subtle elliptical arena rim and stable play plane, with softer, slower-moving filaments descending into a distant throat. Reserve the strongest contrast for fighters and meaningful impacts. Reduce bright square star clutter near combat. Do not add more independent rings or effects to compensate for unclear geometry.

A modest tilt is worth testing, but only after camera fitting is reliable. Compare approximately 15-20 degrees against the current 30-degree view in the same recorded encounter. Judge target visibility, perceived spacing, edge readability, and launch tracking, not just an attractive empty-stage screenshot. Keep simulation and targeting strictly 2D.

Several existing atmosphere controls do not operate uniformly on the luminous funnel. For example, the principal shader receives unscaled game time in `src/view/render.ts:416`, while the effect-speed control drives other backdrop components. Consolidate the artist-facing controls around actual funnel radius, depth, twist rate, flow rate, contrast, and rim visibility rather than adding more overlapping presets.

### Characters and sprites

The current pair is not production-coherent: Vanguard is a detailed dark armored humanoid with baked fiery accents, while Duelist is an angular low-detail robot. Their silhouette treatment, shading, pose language, and visual density differ. At normal gameplay size, extra detail does less for recognition than consistent outlines, pose shapes, and contrast.

The asset checks report 56 Vanguard review frames but only eight Duelist frames. Most Duelist combat clips are single poses; startup and active often reuse the same frame, parry and break share a pose, and helpless/recovery share another. That is placeholder coverage, not a readable combat animation set. The current presentation mapping also lacks distinct regular-movement and win-pose states and shares boost presentation across movement intensities.

Do not commission a full roster yet. Produce a two-character style pilot with the same camera, light direction, scale, foot/pelvis anchors, right-facing convention, and effect-free base art. Test idle, movement, boost, launch anticipation/contact/recovery, and helpless/break poses at actual game size. Approve silhouettes and action readability before expanding frame counts. Keep energy trails and player/action colors in reusable VFX layers rather than baking every effect into the atlas.

The renderer's near-zero-width turn interpolation and pose crossfades also need scrutiny: fighters can become slivers and conflicting poses can overlap. Better source art alone will not fix this. Favor stable facing with a short controlled flip or authored turn, and preserve crisp combat key poses.

### Menus and information hierarchy

The home screen reads as a development configuration form. Disabled arcade options and lengthy history/preview panels remain visible in other modes; the start action can fall below the fold at 900 pixels high. Fighter selection uses text rather than the available visual identity. Internal stage names such as "Candidate" leak into player-facing choices.

Separate Play, Training/Balance Lab, and Settings. Show only the controls relevant to the chosen mode. Keep Start and Back visible without scrolling. During combat, move seed, mode, and diagnostic prose out of the central fighting area. Keep action-color keys optional, with shape/pose cues as well as color.

## Gameplay-loop observations

One local Cadet AI-vs-AI sample used seed `1930601551` with Vanguard against Duelist, observed for 39.6 seconds. This is diagnostic evidence, not a class-balance verdict:

- Telemetry recorded 16 exchanges, 14 concrete outcomes, and 10 sustained spacing resets, but no shared action-ready window lasting at least 0.75 seconds.
- Both players were simultaneously action-ready for about 9% of the sample. During shared movement-control time, roughly 95% was still in pressure range.
- P1 selected approach about 76% of the time and disengage about 2%; P2 selected approach about 63% and disengage about 15%.
- P2 spent about 42% of the sample helpless. Eleven launch hits and five dunk hits occurred without the observed sample ending the round.
- One inspected launch-break recovery was followed by boost after roughly 0.02 seconds and another launch hit about 0.67 seconds later. Returned control did not become a durable tactical reset in that incident.

This suggests focusing on the quality of choices after contact, not merely increasing separation numbers. Test whether a defender can move, bait, punish a missed committed approach, or deliberately spend fuel to reset before another guaranteed engagement. Distinguish physical distance from actionable breathing room. Excessive helpless duration and instant AI re-engagement can mask otherwise useful movement options.

The default Vanguard/Duelist pairing does not have projectile specials: their kits use guard and dash. Lack of projectiles in that pairing is not itself an AI defect. Use a projectile-equipped test class/role when evaluating ranged mechanics.

The experimental well-capture rules change the finishing route and should remain a clearly separated experiment until human testing establishes the preferred loop. Decide whether fuel exhaustion plus a deliberate dunk or spatial capture is the primary finish, then verify that launch speed, pursuit speed, recovery, and available counters support it. Do not compensate for an unreachable or unreadable finish by making AI more aggressive.

## Make balancing easier without rebuilding the lab

The Balance Lab already includes presets, scenarios, controlled roles, telemetry, baselines, replay comparison, and export. Its current panel measured about 5,896 pixels of scroll content in an 874-pixel viewport, with 239 layout-visible controls across that content. Discoverability is now a larger problem than a shortage of controls.

Recommended workflow:

1. Choose a question such as "Can I escape after a clash?", "Can I punish a missed boost?", or "Can I finish a launched target?".
2. Open a short controlled scenario with deliberate attacker/defender behavior and a human takeover option. Repair the scripted escape role first.
3. Change a small number of relevant values. Put advanced class/AI parameters behind separate sections, not the default task flow.
4. Replay baseline and candidate with an event timeline showing accepted input, movement control, attack availability, vulnerability, distance, and fuel. Allow comparisons where a candidate ends the round earlier instead of requiring identical durations.
5. Save the hypothesis, complete settings, scenario, seed, controller roles, both replays, and outcome together so the experiment can be reopened.

Primary measures should be choice windows, whiff punishability, repeated-contact loops, time helpless, resource tradeoffs, and understandable finishing opportunities. Class win percentages are secondary evidence, especially when driven by different AI policies rather than human decisions.

## Implementation order

1. **Trust and access:** fix camera containment, online seat/input mapping, queue/bootstrap recovery, normal menu exit, ineffective tuning controls, and animation timing. Add regressions for each confirmed finding before changing the balance.
2. **Readable greybox:** use a restrained stage with a visible rim and coherent temporary character silhouettes. Separate action recovery states and normalize action VFX/audio. Validate clips and camera at live gameplay size, including arena edges.
3. **Human balance loop:** repair controlled roles and simplify the lab around a few encounter questions. Compare pursuit, retreat, clash reset, break timing, and finish reliability one change at a time. Use recorded incidents rather than long unattended win-rate runs.
4. **Art pilot:** approve one consistent two-character direction and one stage composition, then expand sprites, portraits, effects, and sound against a stable presentation contract.
5. **Online alpha gate:** run two local clients through both seats, one controller each, matchmaking wait expansion, packet delay/loss, disconnect/rejoin, rematch, result settlement, and menu exits. Follow with a small hosted smoke test only after local gates pass.

Do not add more classes until their timing, presentation, and tuning are trustworthy. Do not expand console/platform work before the core encounter and menu flow are reliable.

## Verification and limits

- Full game-web test suite: **947 tests passed across 130 files**.
- Full game-web production build: **passed**, including type checking and configured content, provenance, asset, matchup-smoke, and bundle checks.
- Additional focused simulation and in-memory API/input probes reproduced the findings above. Their tests overlap the full suite and are not added to its count.
- Browser review used the local development server with API addresses pointed at localhost. No Neon/cloud database testing was performed. Missing local API requests produced expected connection-refused errors; no rendering error was observed during the visual review.
- No physical controller, full two-browser online session, hosted deployment, console target, or performance profiling was tested in this pass. The production release attestation is not established by the local build.
- Screenshots are local ignored artifacts in `apps/game-web/build-artifacts/review-2026-09-05/`: `local-menu.png`, `match-analysis.png`, `match-clean.png`, `match-clean-2.png`, and `balance-lab.png`.

Passing tests and a successful build establish a useful baseline, not gameplay quality. The main missing coverage is behavioral integration: actual devices, asynchronous session transitions, camera containment, and non-default tuning values.
