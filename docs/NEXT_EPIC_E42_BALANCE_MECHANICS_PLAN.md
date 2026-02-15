# Next Epic Plan: E4.2 Balance And Mechanics Operations

Date: 2026-02-15  
Status: in progress (`S4.6`, `S4.7` complete)

## Scope
- `S4.6` Balance profile registry and validation workflow. (complete)
- `S4.7` Training telemetry capture for tuning sessions. (complete)
- `S4.8` Patch note generator from tuning profile diffs.
- `S4.9` Matchup regression smoke suite for core move interactions.

## S4.6 delivered
- Data-authored balance profiles under `apps/game-web/content/balance`.
- Runtime profile resolver and safe fallback to default profile.
- Build/CI validation command and artifact report.
- Ruleset version tagging with active profile id for diagnostics.

## S4.7 delivered
- Training telemetry tracker for local tuning sessions (input usage, outcomes, fuel spend, round timing, chain peak).
- Pause menu debug action to export telemetry JSON in training mode.
- Local persistence snapshot for latest telemetry export.
- Unit coverage for telemetry aggregation behavior.

## Immediate next story
- Start `S4.8`:
  - generate patch-note summary from balance profile diffs
  - include field-level before/after tuning values
  - produce markdown artifact for release notes and design review
