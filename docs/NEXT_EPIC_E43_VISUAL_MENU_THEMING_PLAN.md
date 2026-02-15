# Next Epic Plan: E4.3 Visual Content And Menu Theming

Date: 2026-02-15  
Status: in progress (`S5.1`, `S5.2`, `S5.3` complete)

## Scope
- `S5.1` Menu theme registry, runtime application, and persistence. (complete)
- `S5.2` In-game HUD theme tokens and accessibility contrast presets. (complete)
- `S5.3` Stage atmosphere presets (background gradients, fog, color grading controls). (complete)
- `S5.4` Menu motion pass (intentional transitions and panel choreography).

## S5.1 delivered
- Data-authored theme definitions under `apps/game-web/content/themes/menuThemes.ts`.
- Runtime theme resolver and CSS-variable application at startup/profile hydration.
- Settings screen theme selector with keyboard, mouse, and controller left/right support.
- Theme persistence in local/profile settings payload (`menuThemeId`).
- Build/CI validator and artifact report (`menu-theme-validation-report.json`).

## S5.2 delivered
- HUD-facing color and border hardcodes moved behind theme tokens and CSS variables.
- New accessibility preset `high_contrast_v1` in menu theme definitions.
- Contrast checker script with required token-pair minimum ratios and CI gating.
- Contrast report artifact `menu-theme-contrast-report.json` for design review.

## Immediate next story
- Start `S5.4`:
  - add menu-panel transition choreography
  - tune staggered reveal timings per panel category
  - keep keyboard/mouse/controller nav parity during transitions
