# Controller-First Foundations

Gravity Well now has reusable controller-first building blocks without changing deterministic
simulation input or coupling the modules to a specific menu implementation.

## Scope

- `input/controllerGlyphs.ts` detects Xbox, PlayStation, Nintendo, and generic pads. It exposes
  stable glyph tokens, visible labels, accessible labels, and remap-aware action glyph maps.
- `input/controllerRegistry.ts` records pre-connected pads, browser connect/disconnect events,
  index replacement, and polling reconciliation after background or suspend.
- `input/controllerOwnership.ts` tracks the active menu controller separately from optional P1/P2
  assignments. Disconnecting a pad reports exactly which player slots lost ownership.
- `view/controllerUi/navigation.ts` converts a standard-layout pad into edge-triggered and repeated
  menu actions. Its navigation list skips hidden or disabled targets and has no DOM dependency.
- `view/controllerUi/recoveryMessage.ts` builds accessible disconnect and recovery notices. A
  player-owned controller loss recommends pausing; a menu-only loss does not.
- `view/controllerUi/safeArea.ts` calculates system, comfortable (2.5%), and television (5%) safe
  areas and applies them as `--gw-safe-area-*` CSS variables.
- `input/virtualKeyboard.ts` tries an injected platform text-entry adapter before a browser prompt
  fallback. The prompt fallback refuses secure text because it cannot mask the value safely.

## Controller Conventions

The gameplay remapping profile remains the source of truth for action buttons. Pass a player's
current `ButtonPlayerBindings` to `buildGamepadActionGlyphs` whenever bindings or the active
controller family changes.

Menu navigation uses standard-layout positions rather than gameplay actions. Xbox A and
PlayStation Cross confirm; Xbox B and PlayStation Circle go back. Nintendo A confirms and Nintendo
B goes back, matching Nintendo menu conventions.

Controller indices are browser slots, not durable device identities. Ownership must therefore be
reconciled after every disconnect, reconnect, page background return, or platform resume.

## Integration Order

1. Start one `ControllerRegistry` when the presentation shell starts and poll `refresh()` after
   visibility or resume events.
2. Mirror registry connection changes into `ControllerOwnership`. Treat meaningful button or stick
   activity as `recordActivity(index)` so prompts follow the last-used controller.
3. Feed the active pad through `resolveControllerNavigationSample` and one
   `ControllerNavigationRepeater`; send emitted actions to the currently visible navigation list.
4. On disconnect, combine the registry device family with `ControllerDisconnectResult` to build a
   recovery message. Pause only when `pauseRecommended` is true.
5. Apply a saved safe-area preference to the root UI style, then consume the CSS variables in the
   menu and HUD layout.
6. Provide Steam or console shells as `PlatformVirtualKeyboard` adapters. Keep browser password
   fields on masked HTML inputs until a secure browser text-entry surface is supplied.

## Runtime Integration

- The start menu uses family-correct confirm/back actions and held-direction repeat.
- Controllers claim P1 then P2 in connection order, and gameplay reads those stable assignments
  instead of renumbering the remaining pad after a disconnect.
- Assigned-controller loss pauses an offline match and shows an accessible recovery notice.
- Reconnection or replacement input restores ownership, while resume refreshes the registry.
- Comfortable safe-area variables now drive the HUD and start-menu padding.

Gameplay actions still come from the remappable input profile, so this presentation integration
does not change deterministic simulation, rollback input, or replay checksums. Native platform
virtual-keyboard adapters and authored glyph artwork remain platform-shell work.

## Verification

Run the focused suite and typecheck from the repository root:

```text
npm test --workspace @gravity-well/game-web -- --run src/input/controllerGlyphs.test.ts src/input/controllerRegistry.test.ts src/input/controllerOwnership.test.ts src/input/virtualKeyboard.test.ts src/view/controllerUi/navigation.test.ts src/view/controllerUi/recoveryMessage.test.ts src/view/controllerUi/safeArea.test.ts
npm run typecheck --workspace @gravity-well/game-web
```
