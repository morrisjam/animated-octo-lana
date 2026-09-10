# Online Lifecycle and Combat Readability Pass

## Scope

- Verify the published release identity with public, read-only requests.
- Exercise cancellation, reconnect, rematch, and result lifecycle boundaries locally.
- Clarify combat phases and outcomes without changing character stats, combat rules, or art.

## Release Findings

The public website's `/release.json` returned commit
`e8bf3c0b0b80e36a71b431f98e4ef5d4d1bffa63`, not the latest pushed
`09fc4ea33e7319dcdc4ec2b0925b85ee611e7129`. The API `/health` returned
`{"ok":true}` without release identity. This establishes liveness, not matching
client/API versions or ruleset compatibility. No hosted matches, account writes,
readiness probes, provider configuration changes, or deployments were performed.

`npm.cmd run release:public-check -- --expected-sha <full-commit-sha>` now checks
only these two public endpoints. It reports stale/missing identities and missing
cache protection, and explicitly does not certify alpha readiness.

GitHub Actions run [33969999252](https://github.com/morrisjam/animated-octo-lana/actions/runs/33969999252)
passed compilation, production build, and its online integration checks. It failed
the unchanged AI gameplay-flow gate: 11/36 blocked chase rounds (0.306, maximum
0.25), and Vanguard zero-fuel finish conversion 2/19 (0.105, minimum 0.2), mirrored
across seats. These are gameplay-flow failures, not evidence of a broken build.
The stricter alpha-readiness step did not run after this failure.

## Online Changes

- Recheck queue generation after application callbacks, preventing a cancelled
  session from being delivered by a late match-found response.
- Discard errors from an obsolete transport recovery attempt after closure.
- Clear the old peer's confirmed-frame prefix when replacing a data channel;
  the replacement must advertise its own synchronization state.
- Add regressions for old upload/poll/confirmation generations, recovery
  checkpoints, rematch boundaries, lifecycle closure, and completion consensus.

## Combat Readability

- Replace globally pulsing action halos with stable, move-phase-local indicators.
- Show hollow vulnerability brackets during helplessness and recovery, including
  recovery that outlasts the decorative action flash.
- Add distinct short shapes for launch wind-up, guard attempt, successful parry,
  missed launch/dunk, spent launch break, and completed break recovery.
- Add outcome shapes to the optional analysis HUD key. Limit transient outcome
  cues to one per fighter, without textures, particle clouds, or strobing.
- Reset presentation state on round changes, replay transitions, and rollback
  corrections. A guard attempt is no longer announced as a successful parry.

Exact parry/whiff/break-ready outcomes are currently emitted only from local,
non-rollback fixed steps. Online and replay views retain phase indicators, but do
not claim confirmed outcomes from speculative or skipped frames. A future
confirmed-event stream can extend those outcome cues safely.

## Verification

- API suite: 363 tests passed; API typecheck passed.
- Client suite: 1,112 tests across 143 files passed; client typecheck passed.
- Network unit suite: 159 tests across 21 files passed.
- Production builds and existing asset/bundle limits passed without relaxed limits.
- Local forced-relay integration passed, including rollback convergence,
  transport replacement, production-root ranked settlement and replay storage,
  forfeit/no-contest handling, database interruption, API process replacement,
  and concurrent API instances.
- Fresh direct-path integration passed after final legend and presentation-reset
  integration. The network implementation was unchanged between these two runs.
- Final production visual smoke passed: WebGL, replay navigation, lazy pause
  menus, local review, balance sparring, no page errors or failed same-origin
  requests. The expanded key was also visually inspected in a live local AI match.
- Public release check correctly failed for the stale web release and missing
  API release identity described above.
- Release-check tests cover malformed CLI arguments, native-fetch stalled headers
  and bodies, response-size limits, and rejection before contacting invalid targets.

Integration evidence is under `apps/api/build-artifacts/local-alpha-integration/`
(`report-direct.json` and `report-relay.json`); screenshots are under
`apps/game-web/build-artifacts/visual-alpha-smoke/`. These are dirty-worktree
verification runs, explicitly not deployable release evidence. The Steam verifier
was a loopback fake, not real Steam authentication.

The local preview is running at `http://127.0.0.1:4174/` with online/ranked runtime
disabled and profile/matchmaking origins pointed at loopback. Local gameplay works
without the API; account/profile requests report connection refused while that
optional server is stopped. Continue as Guest, then use Local and AI vs AI to
inspect the cues. The analysis HUD has a hide/show toggle.

Real two-device, cross-network acceptance and longer soak testing remain separate
from these local browser and relay checks. No changes were committed, pushed, or
deployed in this pass. AI decision-making follow-up is documented in
`AI_FLOW_DIAGNOSIS_2026-09-05.md`; no stats, rules, AI decisions, or gate thresholds
were changed.
