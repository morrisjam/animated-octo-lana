# Ranked Result Verification

Ranked ratings are changed only after the API independently replays a complete match proof. Matching declarations from two clients are a secondary consistency check, not the source of truth.

This proves that the submitted input timeline is internally valid and deterministic. The API also requires server-observed, chain-linked commitments to each participant's own input while the ranked session is live. That prevents a client from waiting until match end and then inventing an unobserved proof timeline, but it does not prove that clients are unmodified, human, or independent. Two modified clients can still coordinate in real time, so ranked remains controlled-alpha until this path is exercised adversarially in multi-instance staging.

## Proof contract

`gw.ranked-sim.v1` uses schema version `1`. Every proof binds:

- matchmaking `sessionId` and `matchId`
- exact release build, ruleset, and named balance profile
- deterministic session-derived seed and fixed 60 Hz step
- P1/P2 character loadout and character-registry fingerprint
- compact P1/P2 inputs for every frame in every round
- claimed round winners, final state checksums, and match outcome

Inputs are stored as six-value tuples: P1 X/Y/action mask followed by P2 X/Y/action mask. The action mask covers boost, super boost, special, launch, dunk, parry, and launch break. Axis ranges, action bits, round count, epoch order, and frame budgets are validated before simulation.

The API recreates each round from the same initial state, applies every input, requires the first winning state to occur on the final recorded frame, compares the derived winner and checksum, and derives the best-of-three outcome. It then computes a canonical lowercase SHA-256 proof digest. The second participant must submit the same independently valid digest before ratings settle; missing, legacy, malformed, uppercase, or mismatched digests fail closed.

## Live input commitments

`gw.ranked-input-commitment.v1` hashes only the submitting participant's compact input into chain-linked chunks of at most 120 frames. The client retains a 120-frame uncommitted rollback guard, so ordinary late-input corrections can still replace the speculative tail. If a correction reaches an already accepted chunk, ranked settlement fails closed instead of silently attesting stale input.

Each commitment request requires signed account authentication, the live matchmaking session token, and the participant's server-assigned side. The API verifies identity, side, sequence, frame and round continuity, retry idempotency, and the previous chain digest before recording its own receipt time. The commitment route does not receive raw gameplay frames; those remain on the WebRTC path and in the final proof.

At settlement, the verifier requires both participants' chains to reproduce every own-side input in every proof frame and every round boundary. Production additionally requires the span between server receipt timestamps to cover at least 25% of the observable proof timeline and applies the same ratio as a rolling token-bucket cadence. The bucket permits a bounded 240-frame burst, covering one 120-frame commitment plus the 120-frame rollback guard, then replenishes only with elapsed server time. A client therefore cannot satisfy the aggregate duration check by sending one chunk, waiting, and bursting the rest at the threshold boundary. Test and development use a zero observation threshold, which disables both wall-clock checks only so accelerated deterministic local harnesses do not pretend to run in real time. The final `gw.ranked-input-attestation.v1` records both participant sides, frame and commitment counts, observed durations, ratios, and final chain digests; the result is returned as `match_verified`.

## Persistence

Migration `019_ranked_match_proofs.sql` stores one verified proof payload per digest in `ranked_match_proofs`. Participant submissions reference that digest and record `proof_verification_status = verified`. This preserves the authoritative input timeline for replay, anti-cheat review, and future gameplay-flow analysis without duplicating the payload for both participants.

In developer builds, the web client also keeps one latest proof plus its server verification receipt in local browser storage. **Replays -> Review Last Ranked Match** verifies the digest and deterministic outcome again, then rebuilds Balance Lab flow telemetry locally. The record contains both players' frame-level inputs and a correlatable session id, so production builds neither retain it nor expose the review entry unless debug tools are explicitly enabled.

Migration `020_ranked_authoritative_resolutions.sql` adds a separate audit source for server-observed forfeits. A ranked match references exactly one settlement source: either a proof-confirmed player submission or an authoritative resolution. A single participant missing the reconnect deadline, or explicitly leaving an already matched ticket, produces a server resolution naming the forfeiting account. Repeated disconnect calls cannot extend the original grace deadline. Simultaneous timeouts, generic session expiry, and completed sessions have no attributed forfeiter and do not settle ratings.

Migration `027_ranked_terminal_decisions.sql` closes the crash window between resolving matchmaking and settling ranked progression. The immutable forfeit or no-contest decision is committed in the same database transaction as the runtime snapshot. A bounded `SKIP LOCKED` worker claims it with an expiring token, retries failures with capped backoff, and marks it settled or superseded without allowing another worker to mutate its participants, reason, winner, or deadline. No-contests remain durable even though they intentionally create no `ranked_matches` row.

Player-proof settlement and terminal-decision persistence acquire the same session-scoped transaction lock. After acquiring it, the proof path revalidates live session state and rereads the durable decision inside the transaction before writing proof or rating rows. A pending or committed server forfeit/no-contest therefore rejects a late proof instead of allowing it to overwrite the server-owned outcome.

Migration `031_ranked_input_commitments.sql` adds participant-side session projection, the append-only commitment chain, and `ranked_match_proofs.input_attestation_json`. The final attestation is stored beside the proof and returned by settled-result recovery, so it survives API process replacement and can be audited without trusting browser-local state.

## Compatibility

Ranked queue joins require `buildVersion`, `rulesetVersion`, `balanceProfileId`, and a supported `characterId`. Matchmaking pairs only clients with identical values and persists them in the durable session snapshot. The API accepts only rulesets in `RANKED_SUPPORTED_RULESET_VERSIONS` and balance profiles compiled into the simulator.

The web build must send the same values:

- `VITE_APP_BUILD` equals an allowed release build id.
- `VITE_RULESET_VERSION` is present in the API ruleset allowlist.
- `VITE_BALANCE_PROFILE_ID` names a compiled profile; omitted means `default`.

Drain active matchmaking sessions before deploying a simulator-changing release. The current API hosts one verifier implementation rather than a registry of historical simulators.

## Forfeits and draws

Played `p1_win` and `p2_win` results are proof verified. During the controlled alpha, unfinished matches are explicitly **no-contest**: client-declared `draw` returns `422 ranked_draw_no_contest`, mutual timeout/session expiry creates no settlement, and neither ratings nor placement counters change. Client-declared `forfeit` also returns `422`; forfeits are derived only from the durable matchmaking session state described above.

The client does not infer a ranked outcome from a WebRTC or heartbeat error. It reads the resolved matchmaking session, uses `forfeitingAccountId` only when the server has attributed exactly one departure, and otherwise presents an explicit no-contest. Server-attributed forfeits poll the ranked result endpoint for the canonical settlement and rating delta; an active session with a failed transport remains an interruption with no invented winner. Once a terminal decision or match is durable, either participant can recover it with signed account authentication after the volatile session and its token have expired; an unrelated account is rejected.

Both accepted proof wins and server-attributed forfeits use the same `settleRankedMatch` transaction for Elo, league placement, Master Rating, anomaly records, match audit rows, and leaderboard counters. The shared policy guard permits only proof-replayed P1/P2 wins from `player_consensus` and only attributed forfeits from `server_authoritative`.

## Local gates

`npm run api:smoke:ranked-online` submits both commitment chains, verifies their final two-participant attestation, then checks valid proof settlement, commitment/proof tamper rejection, duplicate/outsider/token rejection, progression updates, and settlement-to-leaderboard consistency. Its unique local region cohort checks numeric rank ordering, display identity, rating and record counters, stable non-overlapping pagination, authenticated public reads, unsigned rejection, response-field privacy, and Master-track isolation. `npm run api:smoke:ranked-authoritative-forfeit` verifies reconnect-deadline immutability, one-player timeout attribution, server-owned settlement, late-valid-proof rejection, participant-only tokenless recovery, durable terminal linkage, and a zero-rating mutual-timeout no-contest. `npm run api:smoke:matchmaking-restart` verifies that both commitment chains, a pending proof-backed result, and the matchmaking session survive API process replacement. The production-root two-browser smoke also requires each browser's final local chain digest to equal its persisted participant attestation. All local gates refuse remote or unreported database targets by default. `npm run api:local` pins migration and API startup to `LOCAL_DATABASE_URL`, so a hosted `DATABASE_URL` cannot be used accidentally; Neon is not required.
