# Release Preparation: 2026-09-10

## Requested Work

Fix the AI gameplay-flow regressions, retain character balance and existing test
thresholds, push the verified fix, and deploy through the existing release process.

## Deployment Preflight

Read-only checks on September 10 found:

- GitHub authentication permits repository and workflow operations.
- Repository Actions secrets contain only `DATABASE_URL` and `REDIS_URL`.
- No repository Actions variables or deployment environments are configured.
- The required safe-rollout secrets and variables below are absent.
- Connected Chrome shows signed-out Render and Cloudflare dashboards. Provider
  settings, current API revision, deploy hooks, and rollback baseline cannot yet
  be independently verified.
- Public web metadata still identifies
  `e8bf3c0b0b80e36a71b431f98e4ef5d4d1bffa63`; public API health returns
  `{"ok":true}` without a release SHA. This does not establish version parity.
- The currently published web SHA has a failed CI run. A different earlier SHA
  with successful CI is not automatically an eligible rollback: safe rollout
  requires the selected baseline to be currently deployed and healthy.

These checks did not read secret values or write to hosted databases. No
deployment or migration was triggered during this preflight.

## Additional CI Regression

Run [34421912894](https://github.com/morrisjam/animated-octo-lana/actions/runs/34421912894)
at `8a978e5` failed the production-root ranked browser smoke before reaching the
AI gate. Its corrected winner was frame 4710, but the local input recorder had
already sealed commitments through frame 5159 after generating 5349 inputs.
Rollback reached a depth of 653 frames, exceeding the assumed 120-frame guard.

The client now supplies the already archived canonical replay prefix when
capturing ranked input commitments. Live chunks can be sealed only before that
prefix's latest frame, leaving a non-empty final chunk if that frame is the
winner. This retains immutable receipts, digests, chunk sizes, contiguous frame
capture, and fail-closed handling of contradictory finalization; it does not
raise the guard, rewrite acknowledged chunks, or weaken proof validation.

Regression coverage includes the CI-sized speculative tail, a winner exactly on
a chunk boundary, catch-up after confirmation stalls, round reset, invalid
watermarks, and final chunk digests. The commitment unit suite passes 11 tests.

Live simulation is also bounded to 119 frames ahead of mutual input confirmation.
The remaining guard frame covers the gap between receipt and canonical archival,
preventing a 241-frame terminal flush from exceeding the 240-frame burst allowance.
When that limit is reached, it stops generating speculative input, discards the
catch-up time backlog, and continues transport polling and acknowledgements.
This prevents large stalled buffers from being submitted as a burst when the
connection catches up. An API-side regression verifies the client window and
recorder together against the unchanged production observation ratio (0.25) and
bounded receipt-cadence enforcement. No artificial receipt pacing is added.

## AI Fix and Local Verification

The `flow-v26` controller rejects an inward movement-dash commitment immediately
after control returns when the opponent can counter-launch. Steering, reactive
parry, and genuine punish opportunities remain available. A bounded, cloned-state
forecast now checks the authored dunk startup/active window, pursuit, wrap, and
the opponent's control-return counter deadline instead of only present distance.
The forecast does not mutate live state or emit live telemetry.
The retired `finishPursuitReachScale` control and recommendations are removed;
the serialized field is retained for old replay/draft compatibility and its
no-effect status is explained in the Balance Lab.

On the unchanged normal gate's mirrored veteran matrix (36 rounds per ordering):

- Blocked Chase fell from 11/36 to 9/36, meeting the existing maximum of 0.25.
- Vanguard zero-fuel finishes changed from 2 wins in 19 starts to 2 in 3 starts.
  This removes unsafe commitments, not evidence of increased finish frequency.
- All normal regression thresholds pass. Character stats, rules, gate thresholds,
  and matrix seeds are unchanged.

The non-advisory `ai:alpha-readiness` still **fails** on the final source. Veteran
Commitment is flagged in 33/36 rounds and Chase in 36/36; sustained control-return
resets are 11/63 for Vanguard and 11/104 for Duelist. Vanguard finish-start rate is
0.083 versus the required 0.15. Cadet flow checks also fail. These are unresolved
gameplay-loop quality targets, not class win-rate targets, and block safe rollout.

Local checks completed before publication:

- Web unit/browser suite: 1,141 tests across 146 files passed.
- API suite: 365 tests passed, including unchanged production timing enforcement.
- TypeScript, replay checksum, and static migration compatibility checks passed.
- Final `npm run build` passed all content checks and unchanged production bundle
  budgets: 1,123,388 initial JavaScript bytes and 469,830 entry-chunk bytes.
- Local rollback soak passed; no hosted services were used.
- Direct and forced-relay integration passed using local PostgreSQL and ephemeral
  coturn. Both production-root browser matches recovered, settled with attested
  input history, and loaded verified replays. Maximum observed rollback depth was
  40 frames direct and 118 frames over relay. API replacement, simultaneous API
  instances, and database-connection interruption checks also passed.
- These integration runs tested the final network/AI behavior before the purely
  descriptive legacy-control cleanup. They are working-tree test evidence, not
  clean-SHA deployment attestations. A coordinated release still needs clean-SHA
  evidence, successful CI, provider configuration, and the strict gameplay gate.

The optional local outcome tracker loads on demand to retain the entry-bundle
budget. Immediate action indicators remain available. Balance comparison tests
select actual recorded durations rather than assuming how adaptive AI responds
to a longer startup; terminal-tail and shorter-candidate UI assertions remain.

## Configuration Required Before Rollout

Configure these **secrets** in GitHub using the verified provider values. Do not
paste credentials into chat or commit them:

- `RENDER_CANARY_DEPLOY_HOOK_URL`
- `RENDER_PRODUCTION_DEPLOY_HOOK_URL`
- `API_CANARY_BASE_URL`
- `API_PRODUCTION_BASE_URL`
- `SLO_ADMIN_KEY`

Configure these **variables**, independently verified against each target:

- `API_CANARY_EXPECTED_HOSTNAME`
- `API_PRODUCTION_EXPECTED_HOSTNAME`
- `API_CANARY_DATABASE_ID`
- `API_PRODUCTION_DATABASE_ID`
- `WEB_CANARY_RELEASE_ATTESTATION_URL`
- `WEB_PRODUCTION_RELEASE_ATTESTATION_URL`
- `WEB_CANARY_EXPECTED_HOSTNAME`
- `WEB_PRODUCTION_EXPECTED_HOSTNAME`

Sign in to the existing provider accounts before configuring resources. Do not
create paid canary services or change account plans without an explicit spending
decision. Follow `docs/DEPLOYMENT_RUNBOOK.md` for the offline provider-config audit,
coordinated client/API settings, known-good rollback bootstrap, migrations, and
exact-SHA canary then production promotion.

## Release Boundaries

- Passing `ai:balance-gate` repairs the normal CI regression gate; the stricter
  `ai:alpha-readiness` remains independently required by safe rollout.
- Do not lower thresholds, mark advisory evidence as a strict pass, or choose an
  undeployed rollback SHA to bypass a gate.
- Do not push `master` merely to trigger Pages before verifying API compatibility
  and the coordinated deployment path. A branch push is not a deployment.
- A complete release must identify the exact candidate SHA in public web/API
  metadata and satisfy authenticated readiness before matchmaking resumes.
