# Ranked Result Verification

Ranked ratings are changed only after the API independently replays a complete match proof. Matching declarations from two clients are a secondary consistency check, not the source of truth.

## Proof contract

`gw.ranked-sim.v1` uses schema version `1`. Every proof binds:

- matchmaking `sessionId` and `matchId`
- exact release build, ruleset, and named balance profile
- deterministic session-derived seed and fixed 60 Hz step
- P1/P2 character loadout and character-registry fingerprint
- compact P1/P2 inputs for every frame in every round
- claimed round winners, final state checksums, and match outcome

Inputs are stored as six-value tuples: P1 X/Y/action mask followed by P2 X/Y/action mask. The action mask covers boost, super boost, special, launch, dunk, parry, and launch break. Axis ranges, action bits, round count, epoch order, and frame budgets are validated before simulation.

The API recreates each round from the same initial state, applies every input, requires the first winning state to occur on the final recorded frame, compares the derived winner and checksum, and derives the best-of-three outcome. It then computes a canonical SHA-256 proof digest. The second participant must submit the same independently valid digest before ratings settle.

## Persistence

Migration `019_ranked_match_proofs.sql` stores one verified proof payload per digest in `ranked_match_proofs`. Participant submissions reference that digest and record `proof_verification_status = verified`. This preserves the authoritative input timeline for replay, anti-cheat review, and future gameplay-flow analysis without duplicating the payload for both participants.

In developer builds, the web client also keeps one latest proof plus its server verification receipt in local browser storage. **Replays -> Review Last Ranked Match** verifies the digest and deterministic outcome again, then rebuilds Balance Lab flow telemetry locally. The record contains both players' frame-level inputs and a correlatable session id, so production builds neither retain it nor expose the review entry unless debug tools are explicitly enabled.

Migration `020_ranked_authoritative_resolutions.sql` adds a separate audit source for server-observed forfeits. A ranked match references exactly one settlement source: either a proof-confirmed player submission or an authoritative resolution. A single participant missing the reconnect deadline, or explicitly leaving an already matched ticket, produces a server resolution naming the forfeiting account. Repeated disconnect calls cannot extend the original grace deadline. Simultaneous timeouts, generic session expiry, and completed sessions have no attributed forfeiter and do not settle ratings.

Migration `027_ranked_terminal_decisions.sql` closes the crash window between resolving matchmaking and settling ranked progression. The immutable forfeit or no-contest decision is committed in the same database transaction as the runtime snapshot. A bounded `SKIP LOCKED` worker claims it with an expiring token, retries failures with capped backoff, and marks it settled or superseded without allowing another worker to mutate its participants, reason, winner, or deadline. No-contests remain durable even though they intentionally create no `ranked_matches` row.

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

`npm run api:smoke:ranked-online` verifies valid proof settlement, checksum-tamper rejection, duplicate/outsider/token rejection, progression updates, and settlement-to-leaderboard consistency. Its unique local region cohort checks numeric rank ordering, display identity, rating and record counters, stable non-overlapping pagination, authenticated public reads, unsigned rejection, response-field privacy, and Master-track isolation. `npm run api:smoke:ranked-authoritative-forfeit` verifies reconnect-deadline immutability, one-player timeout attribution, server-owned settlement, participant-only tokenless recovery, durable terminal linkage, and a zero-rating mutual-timeout no-contest. `npm run api:smoke:matchmaking-restart` verifies that a pending proof-backed result and matchmaking session survive API process replacement. All refuse remote or unreported database targets by default. `npm run api:local` pins migration and API startup to `LOCAL_DATABASE_URL`, so a hosted `DATABASE_URL` cannot be used accidentally; Neon is not required.
