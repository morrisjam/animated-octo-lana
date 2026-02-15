# Menu Theme Workflow (E4.3 / S5.1)

Menu themes are data-authored and applied via CSS variable tokens at runtime.

## Source of truth
- Theme definitions: `apps/game-web/content/themes/menuThemes.ts`
- Runtime registry and CSS binding: `apps/game-web/src/view/menuThemes.ts`
- Validator script: `apps/game-web/scripts/menu-theme-validate.ts`

## Commands
Run from repo root:

```bash
npm run theme:validate
```

Workspace direct:

```bash
npm run theme:validate -w @gravity-well/game-web
```

## Build and CI integration
- Included in:
  - `npm run build -w @gravity-well/game-web`
  - `npm run build:steam -w @gravity-well/game-web`
  - `npm run verify -w @gravity-well/game-web`

## Runtime usage
- Open `Settings` in the home flow.
- Select `Menu Theme` and cycle using:
  - mouse click
  - keyboard left/right
  - controller left/right
- Theme selection persists in settings as `menuThemeId`.

## Report output
- `apps/game-web/build-artifacts/menu-theme-validation-report.json`
