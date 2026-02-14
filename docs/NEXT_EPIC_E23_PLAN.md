# Next Epic Plan: E2.3 Ranked And Progression

Date: 2026-02-14
Status: ready to execute

## Scope
- `S2.7` Rating engine service.
- `S2.8` Season model and leaderboard API.
- `S2.9` Match result validation.
- `S2.17` League ladder model.
- `S2.18` Master rating track.
- `S2.19` Ranked matchmaking uses league and MR.
- `S2.20` Ranked progression UX and anti-smurf rules.

## Execution slices
1. Integrity first
- Implement `S2.9` result validation before broad rating writes.
- Enforce session token checks, participant checks, and match id checks in ranked result submission path.

2. Core ratings
- Implement `S2.7` rating service with deterministic update path.
- Store pre/post rating values per ranked match.

3. Seasonal data model
- Implement `S2.8` season tables and leaderboard read API.
- Add pagination and region filter support.

4. League and MR
- Implement `S2.17` tier thresholds and placement flow.
- Implement `S2.18` MR entry threshold and update rules.
- Implement `S2.19` queue matching bands using league/MR windows.

5. Client UX and operations policy
- Implement `S2.20` progression UX details in game-web ranked screen.
- Add anti-smurf ops heuristics documentation and escalation rules.

## First concrete story to start now
- Start with `S2.9` (match result validation), because it is a hard dependency for trustworthy ranked updates.
