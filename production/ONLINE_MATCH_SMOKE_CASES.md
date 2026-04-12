# Online Match Smoke Cases

Date: 2026-04-06  
Scope: current milestone online loop

This checklist is the minimum smoke surface for the `queue -> bootstrap -> live match -> result` path.

## Core Happy Path

1. Two accounts join ranked queue from separate browsers.
2. Both accounts receive the same matched session id.
3. Both clients enter the online bootstrap phase.
4. Both clients enter a live match with mirrored character assignments.
5. The match completes normally.
6. Both clients reach the online match-over screen.
7. Ranked result submission succeeds or is recognized as already processed.
8. Ranked progression refreshes without a misleading error state.

Script support:

- `API_BASE_URL=http://127.0.0.1:3000 ONLINE_SMOKE_WAIT_SECONDS=33 npm run api:smoke:ranked-online`
- This script covers frame relay, invalid-token rejection for relay and ranked submission, disconnect/reconnect, replayed reconnect rejection, outsider ranked-result rejection, the session-expiry post-match case, and duplicate submission handling.

## Session And Token Validation

1. Wrong `x-account-id` cannot submit frames for the session.
2. Wrong `sessionToken` cannot poll or submit frames.
3. A non-participant cannot submit a ranked result.
4. A non-ranked session cannot submit to `POST /ranked/results`.

## Duplicate Result Handling

1. Both players submit the same ranked result for the same session.
2. One submission is accepted.
3. The second submission resolves as already processed or already submitted.
4. The second client still refreshes progression cleanly.

## Disconnect And Reconnect

1. One player disconnects during the live match.
2. Session enters reconnect grace without crashing the other client.
3. Disconnected client reconnects with a fresh reconnect attempt id.
4. Live match resumes without desynchronizing frame flow.
5. Match can still complete and submit ranked result.

## Failure UX

1. Ranked result submission failure surfaces a clear retry state.
2. Retry button resubmits without forcing a full app restart.
3. Progression refresh failure does not masquerade as a match failure.
4. Public online entry remains hidden in builds where the runtime flag is off.

## Logging Expectations

For each smoke run, capture:

- account ids
- ticket ids
- session id
- queue type
- region
- result submission outcome
- any relay or poll errors shown in the client

## Exit Rule

Do not expose the public online path by default until the happy path, duplicate-result path, and reconnect path all pass in local or staging smoke runs.
