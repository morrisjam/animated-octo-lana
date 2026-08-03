# Gravity Well Design Notes

This document summarises the current gameplay rules and mechanics implemented in the prototype. It is intended as a session handover reference.

## Scope

- Mode: local 1v1 arena combat prototype.
- Platform target: browser build via Vite.
- Architecture:
  - `src/sim`: simulation rules and state.
  - `src/input`: keyboard and Xbox gamepad mapping.
  - `src/view`: Three.js rendering, camera, HUD.

## Win Condition

- A player wins by landing a dunk on an opponent who has no fuel left.
- If the dunked player still has fuel, the dunk does not end the game. They enter a recovery sequence instead.

## Arena and Boundary

- Arena shape: circular.
- Play radius: `ARENA_RADIUS = 72`.
- Boundary crossing:
  - Normal movement cannot pass through the boundary.
  - Crossing is allowed only while launched (`helpless > 0`) or during super boost.
- Ring-out wrap:
  - If an allowed crossing goes beyond `ARENA_WRAP_RADIUS`, the player wraps to the opposite side of the circle.
  - Wrap fuel penalty applies only when not launched.

## Well Hazard (Experimental, Default Off)

- The central well can be enabled as a gameplay object via five zero-default tuning knobs (see `docs/WELL_HAZARD_EXPERIMENT.md`), shipped as balance profile `well_hazard_v1`.
- Core (`wellCoreRadius`): swallows helpless fighters, resolving through the dunk finish — a zero-fuel capture wins the round, a fuelled one costs the standard dunk recovery. Fighters in control hover safely.
- Corona (`wellCoronaRadius` / `wellCoronaDrainPerSecond`): drains fuel from fighters in control; never affects steering.
- Pull (`wellHelplessPull`): accelerates only helpless fighters toward the centre, bending launches into arcs.
- Launch scaling (`launchMissingFuelPowerScale`): launches hit harder against low-fuel targets.
- With all knobs at `0` the simulation is bit-identical to the pre-experiment build.

## Player Resources

- Max fuel: `300` (`MAX_FUEL`), scaled per character by `fuelCapacityMultiplier`.
- Launch breaks: `3`.
- Fuel usage:
  - Movement uses fuel over time.
  - Projectile uses fuel.
  - Boost drains fuel slowly while held (`boost.holdFuelPerSecond`); launch, parry, and break do not directly consume fuel.
  - Super boost has an upfront cost and end cost.
  - Dunk recovery removes fuel from the dunked player.

## Core Actions

- Move:
  - Screen-locked movement.
  - Inputs are world axes, not character-relative.
- Boost (hold):
  - Drives directly towards opponent while held.
  - Movement input does not influence boost direction while active.
- Super boost (hold):
  - Active only while held.
  - On release, total super boost fuel costs are applied.
  - Includes travel cost, turn cost, and non-commit penalty if no launch or dunk was attempted during the super boost.
- Projectile:
  - Hits stun the target.
  - Targets do not lose projectile fuel while launched.
- Launch:
  - Applies high knockback and helpless state.
  - Launched target keeps momentum with very light damping. (The `well_hazard_v1` profile overrides this feel: harder pop, faster momentum bleed, earlier control return — see `docs/WELL_HAZARD_EXPERIMENT.md`.)
  - Very small directional influence comes from the launched player input.
- Parry:
  - Short active window, plus end-lag.
  - If launch is parried, attacker is stunned.
- Break:
  - Usable only while launched and with break stock remaining.
  - Clears helpless state and applies a short stun to the user.
- Dunk:
  - Requires close range; there is no attacker fuel requirement.
  - If target fuel is zero, dunk ends the game.
  - Otherwise target enters recovery.

## Launch Chain Rules

- Chain increments only on successful launch hit.
- Chain resets when:
  - No follow-up launch within `CHAIN_WINDOW_SECONDS`.
  - Attacker is stunned.
  - Attacker is parried.
  - Defender exits helpless without another launch connecting.
- Launch speed scales by chain count, so sequential launches are stronger.

## Dunk Recovery Rules

- Recovery triggers when dunked target still has fuel.
- Recovery fuel cost:
  - `20%` of max fuel, or all remaining fuel if lower.
- At `0` fuel there is no recovery: the dunk ends the game while `allowDunkWin` is true; when it is false, the target is refuelled to max and recovers.
- Recovery behaviour:
  - Target is moved towards the arena centre and away from attacker.
  - Target cannot act during recovery.
  - Recovery returns to neutral once the timer ends.
- Recovery visuals:
  - Target moves away from the camera and shrinks through the arc midpoint.
  - Target returns towards camera and normal scale at recovery end.

## Camera and Visual Feedback

- Camera follows both players with smoothing and wrap-aware tracking.
- During launch state (`helpless` active on either player), camera switches to a fixed zoomed-out view until launch state ends.
- Wrap-aware tracking avoids hard camera snaps when players cross boundary and wrap.
- Indicators:
  - Parry indicator.
  - Launch/helpless indicator.
  - Projectile indicator.
  - Break indicator.
  - Dunk indicator.

## Input Mapping

- Keyboard:
  - P1: `WASD` move, `F` boost, `G` super boost, `R` shot, `T` launch, `Y` dunk, `H` parry, `V` break.
  - P2: `IJKL` move, `O` boost, `P` super boost, `[` shot, `]` launch, `\` dunk, `'` parry, `;` break.
- Xbox controller:
  - Move: left stick or D-pad.
  - `RT` boost, `LT` super boost.
  - `X` shot, `Y` launch, `B` dunk.
  - `LB` parry, `A` break.
  - First connected pad maps to P1, second to P2.

## Pause and Live Tuning

- Pause toggle:
  - Keyboard: `Esc`
  - Controller: `Start/Menu` button
- Pause menu tabs:
  - Pause
  - Controller Bindings
  - Debug Tuning
- Debug Tuning:
  - Edits runtime tuning values used by sim update.
  - Includes copy-to-clipboard JSON export for sharing preferred balance.

## Current Source of Truth

- Primary gameplay tuning lives in `src/sim/constants.ts`.
- Rule flow and state transitions live in `src/sim/sim.ts`.
- HUD status and bars live in `src/view/hud.ts`.
- Input bindings live in `src/input/keyboard.ts` and `src/input/gamepad.ts`.
