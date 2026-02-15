# Next Epic Plan: E4 Content Production (No Engine Workflow)

Date: 2026-02-15  
Status: in progress (`E4.1` complete; next `E4.2`)

## Epics
1. `E4.1` Character package system (first priority).
2. `E4.2` Balance and mechanics operations.
3. `E4.3` Visual content and menu theming.
4. `E4.4` Cutscene and dialogue systems.
5. `E4.5` Music and score pipeline.

## Requested content goals mapped to epics
- Custom characters: `E4.1`.
- Game balance and mechanics: `E4.2`.
- In-game and menu visuals: `E4.3`.
- Cutscene image/video: `E4.4`.
- SFC-style dialogue: `E4.4`.
- Music authoring and runtime behavior: `E4.5`.

## Dependency order
1. Build character package foundation (`E4.1`).
2. Stabilize balance/patch workflow (`E4.2`) so character/content iteration is safe.
3. Expand visual and UI theme packages (`E4.3`) on top of package conventions.
4. Implement cutscene/dialogue runtime (`E4.4`) for narrative content.
5. Extend adaptive music to full cue graph and cutscene hooks (`E4.5`).

## Next implementation target
- Start `E4.2` (balance and mechanics operations).
- Keep `E4.1` QA harness in CI while tuning content.
