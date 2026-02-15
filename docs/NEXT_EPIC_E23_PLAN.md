# Next Epic Plan: E2.3 Ranked And Progression

Date: 2026-02-14
Status: complete (`S2.7`, `S2.8`, `S2.9`, `S2.17`, `S2.18`, `S2.19`, `S2.20` complete)

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
- `S3.4` (ranked anomaly detection) is complete.
- `S3.5` (enforcement tooling) is complete.
- `S3.1` (service health and SLO baseline) is complete.
- `S3.2` (backup and disaster recovery drills) is complete.
- `S3.3` (safe deployment strategy) is complete.
- `S3.6` (platform compliance gap audit) is complete.
- `S3.7` (console-safe persistence abstraction) is complete.
- `S3.8` (console entitlement gateway) is complete.
- `S2.28` (Steam identity link and account merge policy) is complete.
- `S1.4` (deterministic RNG policy) is complete.
- `S1.5` (full state serialise and restore) is complete.
- `S1.6` (checksum replay runner) is complete.
- `S1.9` (Steam sign-in path) is complete.
- `S1.2` (Steam build profile and packaging) is complete.
- `S1.11` (Move frame-data registry) is complete.
- `S1.12` (Frame data visualiser overlay) is complete.
- `S1.13` (Asset manifest and loader abstraction) is complete.
- `S1.14` (Character visual profile abstraction) is complete.
- `S1.15` (VFX event binding and tuning presets) is complete.
- `S1.16` (Asset budgets and validation checks) is complete.
- `S1.17` (Audio event bus and routing) is complete.
- `S1.18` (Adaptive music state system) is complete.
- `S1.19` (Voice line and callout system) is complete.
- Next recommended slice: `S1.20` Mix, loudness, and accessibility controls.
