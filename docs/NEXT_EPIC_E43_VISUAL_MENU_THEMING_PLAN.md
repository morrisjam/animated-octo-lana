# Next Epic Plan: E4.3 Visual Content And Menu Theming

Date: 2026-02-15  
Updated: 2026-07-16
Status: complete (`S5.1` through `S5.4` complete)

## Scope
- `S5.1` Menu theme registry, runtime application, and persistence. (complete)
- `S5.2` In-game HUD theme tokens and accessibility contrast presets. (complete)
- `S5.3` Stage atmosphere presets (background gradients, fog, color grading controls). (complete)
- `S5.4` Menu motion pass (intentional transitions and panel choreography). (complete)

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

## S5.4 delivered
- Screen-depth-aware transitions: deeper navigation moves inward, back navigation moves outward, and lateral or repeated screens use a restrained replacement transition.
- Immediate screen state, focus, and input handling preserve keyboard, mouse, and controller navigation during animation.
- Opacity-only content staggering avoids backdrop-filter compositor artifacts while retaining panel hierarchy.
- Reduced-motion mode removes spatial movement and suppresses nonessential menu-control transitions.
- Scroll-safe centering keeps both short and tall panels reachable at desktop and mobile viewport sizes; fixed decorative glows no longer inflate the scroll area.
- Pure direction-resolution tests cover inward, outward, lateral, repeated, and match-over transitions.

## Follow-on visual work
- The first authored Blender stage source is delivered as the `wormhole_authored_v4` prototype while V1-V3 remain selectable rollback references.
- Its embedded GLB, constrained static runtime, source-hash validator, strict manifest budget, and production visual-smoke visibility assertions are implemented.
- Continue exporting only web-appropriate meshes, baked flow/emissive textures, and VFX sprite sheets; retain the existing local production visual smoke as the integration gate.
- Treat Blender as a reproducible source-asset workshop, not a replacement game runtime, and keep content work independent from simulation and network correctness.
