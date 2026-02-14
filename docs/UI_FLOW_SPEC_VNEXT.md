# UI Flow Spec (Web vNext)

Date: 2026-02-14
Status: approved for implementation

## Goals
- Move from dev-centric home menu to player-facing flow.
- Enforce one clear path: `Title -> Login -> Main Menu -> Category -> Action`.
- Keep input parity: keyboard, mouse, controller for every screen and selector.
- Avoid duplicate entry points and dead-end buttons.

## Screen Map
1. `Title`
- Primary CTA: `Continue`.
- Input: confirm enters Login screen.

2. `Login`
- Actions:
  - `Sign In`
  - `Sign Up`
  - `Continue as Guest`
  - `Back`
- Notes:
  - Sign in/up calls web auth flow.
  - Guest continues without auth requirement.

3. `Main Menu`
- Categories:
  - `Online`
  - `Local`
  - `Replays`
  - `Rankings`
  - `Settings`
  - `Back`
- Includes account summary label.

4. `Online`
- Actions:
  - `Ranked`
  - `Custom Room`
  - `Back`
- Routing:
  - Ranked -> matchmaking section UI.
  - Custom Room -> room section UI.

5. `Local`
- Controls:
  - Mode selector: `Endless Dev`, `Best of 3`, optional `Training` when enabled.
  - Character selectors for `P1` and `P2`.
- Actions:
  - `Start Local Match`
  - `Back`

6. `Replays`
- Actions:
  - `Replay Archive` (API-backed replay UI)
  - `Replay Review (Smoke Fixture)`
  - `Back`

7. `Rankings`
- Actions:
  - `Ranked Snapshot` (current ranked section)
  - `Back`
- Note: leaderboard API is not shipped yet, so this is explicitly snapshot/dev-backed.

8. `Settings`
- Actions:
  - `Account`
  - `Social`
  - `Back`
- Routing:
  - Account -> auth/account flow.
  - Social -> social section UI.

9. `Match Over` (existing)
- Actions:
  - `Play Again`
  - `Return to Home`

## Navigation Rules
- Up/down: move between actionable rows.
- Left/right: change selector values (mode, character, select controls).
- Confirm (`Enter` / `Space` / controller `A`): activate current row/control.
- Back (`Esc` / `Backspace` / controller `B`): move to previous screen, never dead-end.
- Start button (controller `Start`) triggers primary action on local gameplay screens.

## No-Duplication Rules
- No separate root `Online Dev` button in player-facing menu.
- Online category owns ranked/room entry points.
- Replays, Rankings, Settings each have one canonical category button in Main Menu.

## Endpoint Coverage
- Auth: `/auth/web/signup`, `/auth/web/signin`
- Matchmaking: `/matchmaking/queue/*`, `/matchmaking/sessions/*`
- Rooms: `/rooms/*`
- Replays: `/replays/search`, `/replays/:replayId/payload`
- Social: `/friends/*`, `/social/*`
- Ranked: fallback snapshot path via existing ranked section until leaderboard endpoints exist.

## Implementation Order
1. Start menu state-machine refactor for Title/Login/Main/Category screens.
2. Hook category actions to existing UI sections and callbacks.
3. Preserve local mode + character selection and start flow.
4. Validate keyboard/mouse/controller behavior on all screens.
5. Keep match-over flow unchanged except back consistency.
