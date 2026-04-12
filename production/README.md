# Production Workspace

This folder is the Codex-native production surface for `Gravity Well`.

It adapts the useful operating ideas from `Claude-Code-Game-Studios` into repo-local artifacts:

- one integrated production plan
- one current milestone
- one active sprint
- separate stream plans with clear ownership

## Files

- `FULL_GAME_PRODUCTION_PLAN.md`
  - top-level roadmap from prototype to functioning game
- `CURRENT_MILESTONE.md`
  - the current cross-stream milestone and exit criteria
- `CURRENT_SPRINT.md`
  - the active sprint slice and concrete work items
- `VISUAL_BIBLE_V1.md`
  - first-slice visual direction for stage, fighters, HUD, and VFX
- `FIRST_CHARACTER_KIT_TARGETS.md`
  - first two calibration characters and their kit targets
- `ASSET_BRIEFS_V1.md`
  - concrete stage and character asset briefs for the first production batch
- `ASSET_WORKFLOW_V1.md`
  - the repeatable brief -> generate -> review -> cleanup -> integrate -> validate flow
- `ONLINE_MATCH_SMOKE_CASES.md`
  - minimum online validation checklist for the current milestone
- `STREAM_DESIGN_AND_ASSETS.md`
  - design, art, VFX, audio, and presentation lane
- `STREAM_GAMEPLAY_AND_SYSTEMS.md`
  - mechanics, balance, AI, determinism, training, and replay lane
- `STREAM_ONLINE_AND_SERVICES.md`
  - matchmaking, ranked, transport, backend, and live-ops lane

## Operating Rule

Use these files as the stable artifacts for multi-agent work:

1. pick the current milestone
2. cut a sprint slice across the three streams
3. delegate by file and ownership
4. integrate against milestone exit criteria
5. update the sprint and milestone docs after each meaningful batch

If a task does not change one of these files, it should still map back to one of them.
