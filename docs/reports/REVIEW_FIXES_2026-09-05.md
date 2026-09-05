# Review Fixes: September 2026

Implementation follow-up to `GAMEPLAY_VISUAL_REVIEW_2026-09-05.md`.

## Addressed findings

| Review | Implementation |
| --- | --- |
| 1. Camera containment | Fits conservative fighter volumes inside HUD-safe bounds at the actual pitch/aspect, including during smoothed edge tracking; time-based damping. |
| 2. Online P2 controller | Local P1 device input is independent of the participant's network seat. |
| 3. Queue expansion | Polling and existing-ticket joins reconsider eligible waiting tickets. |
| 4. Matched bootstrap retry | Queue client preserves initial-match provenance through failed session reads, with bounded requests and retryable state. |
| 5. Match exit | Pause offers Return to Menu, confirmation/cancel, keyboard and controller navigation, and normal lifecycle cleanup. |
| 6. Escape dummy | Directional escape no longer requests opponent-homing ordinary boost. |
| 7. Parry startup | Authored startup is simulated, interrupts correctly, appears in presentation/telemetry, and survives rollback snapshots. |
| 8. P2 animation offset | Decorative offsets apply only to neutral loops; combat phases use simulation elapsed time where available. |
| 9. Recovery imagery | Ordinary attack recovery is distinct from victim dunk recovery; legacy packages fall back to an upright pose. |
| 10. Super-boost settlement | Accumulated travel cost settles exactly once on action interruption and round termination. |
| 11. Abandoned queue | Cancellation invalidates pending joins and cleans up late responses instead of silently abandoning tickets. |
| 12. Account progress | Account switches replace scoped arcade history and fence stale persistence responses. |
| 13. Audio routing | Explicit boost, super-boost, clash, special, break, launch, parry, projectile, and dunk event routing. |
| 14. Training timings | Overlay uses active character overrides and fingerprints, not unsaved drafts or packaged defaults. |
| 15. Phantom timing tick | Tick-safe countdowns eliminate fractional residue; regressions cover all supported frame durations at 60/120 Hz. |
| 16. Earlier finish comparison | Unequal samples are accepted when the shorter replay genuinely finishes; comparison retains full recordings and reports finish-time differences. |

The online result refresh also rechecks delayed settlement instead of refreshing only the rank display.

## Presentation and workflow

- The main well preset uses an 18-degree pitch, lower-contrast flowing color, fewer/dimmer stars, and a readable rim. Interior calibration contours are hidden in the luminous stage. Effect speed, secondary color, core intensity, and depth scale now affect the principal funnel; depth scaling keeps the arena mouth fixed.
- Fighter turns keep their full silhouette instead of squeezing through zero width. Combat transitions remain crisp; only neutral transitions may dissolve.
- Match metadata sits below the fuel HUD rather than in the center of combat.
- Local setup hides unrelated arcade controls and keeps Start/Back reachable on desktop and narrow screens.
- Advanced balance controls are collapsed into sections. Existing scenarios, baseline capture, replay inspection, export, and one-change comparison remain in place.

These are readability and correctness improvements, not final character art. The existing Vanguard/Duelist raster assets have not been replaced. Current new recovery/startup mappings use upright temporary poses. A consistent two-character art pilot, authored movement/outcome clips, and human balance decisions remain production work.

## Compatibility and deployment

The corrected simulation uses `prototype-2026.09`. Client defaults, API defaults, local runners, CI, environment examples, and the Steam shell identity are aligned. Explicit hosted environment overrides must also be updated together before release; no hosted configuration was changed by this work.

Snapshot schema 6 migrates older snapshots with zero parry startup. The replay wire format remains readable, but arbitrary February replays are not guaranteed to reproduce September checksums. Historical replay fixtures were not rewritten to disguise this. `alpha-visual-2026.09.replay.json` explicitly re-authors the visual input choreography for the corrected engine; its refresh script retains the old fixture as its source.

Current matchup regression goldens were refreshed only after all 24 semantic checks passed. Reinstating the old timer subtraction reproduced all old goldens, confirming the expected timer-driven differences. The simple historical 12-frame smoke replay still passes unchanged.

## Verification

Verification is local-first. No hosted application service, Neon database, paid asset generator, or deployment was used.

- Client suite: 1,053 tests passed across 138 files. API suite: 349 tests passed. Both workspaces passed type checking.
- Production builds passed, including the online-enabled build with unchanged bundle limits: initial JavaScript 1,128,488 / 1,130,000 bytes; entry 491,637 / 492,000 bytes. These limits have little remaining headroom.
- All 24 matchup regressions passed. The unchanged historical smoke replay passed. A 3,600-frame rollback soak converged despite 120 dropped packets.
- Local integration passed all 24 steps on September 5: authentication, ranked proof settlement and leaderboards, authoritative forfeits, real-browser rollback/reconnect, two-browser ranked play through the production root, database interruption recovery, process replacement, and concurrent API instances. Evidence: `apps/api/build-artifacts/local-alpha-integration/report-direct.json`.
- Visual smoke passed with no page errors, failed same-origin requests, or external requests. It covered asset readiness, replay action presentation, pause/review re-entry, and staged balance sparring. The short 180-interval presentation sample averaged 60 FPS with a 16.8 ms p95; this is not a sustained performance certification. Evidence: `apps/game-web/build-artifacts/visual-alpha-smoke/report.json`.

The reports are ignored local artifacts. This run used a dirty working tree and is not immutable deployable-release evidence. Physical-controller testing, forced-relay/cross-network testing, a longer soak, and a real two-device rehearsal remain separate alpha acceptance checks. Steam authentication used a local fake verifier, not the real Steam service. No commit, push, or hosted configuration change was performed.
