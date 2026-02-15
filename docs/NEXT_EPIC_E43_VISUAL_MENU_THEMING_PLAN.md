# Next Epic Plan: E4.3 Visual Content And Menu Theming

Date: 2026-02-15  
Status: in progress (`S5.1` complete)

## Scope
- `S5.1` Menu theme registry, runtime application, and persistence. (complete)
- `S5.2` In-game HUD theme tokens and accessibility contrast presets.
- `S5.3` Stage atmosphere presets (background gradients, fog, color grading controls).
- `S5.4` Menu motion pass (intentional transitions and panel choreography).

## S5.1 delivered
- Data-authored theme definitions under `apps/game-web/content/themes/menuThemes.ts`.
- Runtime theme resolver and CSS-variable application at startup/profile hydration.
- Settings screen theme selector with keyboard, mouse, and controller left/right support.
- Theme persistence in local/profile settings payload (`menuThemeId`).
- Build/CI validator and artifact report (`menu-theme-validation-report.json`).

## Immediate next story
- Start `S5.2`:
  - move HUD color hardcodes behind theme tokens
  - add high-contrast preset option for readability
  - validate contrast-sensitive text pairs with a lightweight checker
