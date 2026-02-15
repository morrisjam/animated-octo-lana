# Next Epic Plan: E4.2 Balance And Mechanics Operations

Date: 2026-02-15  
Status: in progress (`S4.6` complete)

## Scope
- `S4.6` Balance profile registry and validation workflow. (complete)
- `S4.7` Training telemetry capture for tuning sessions.
- `S4.8` Patch note generator from tuning profile diffs.
- `S4.9` Matchup regression smoke suite for core move interactions.

## S4.6 delivered
- Data-authored balance profiles under `apps/game-web/content/balance`.
- Runtime profile resolver and safe fallback to default profile.
- Build/CI validation command and artifact report.
- Ruleset version tagging with active profile id for diagnostics.

## Immediate next story
- Start `S4.7`:
  - capture per-round tuning telemetry (launch/dunk/special usage and outcomes)
  - export tuning session summary JSON from training mode
  - document iteration loop for balance review
