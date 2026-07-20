import type { PlayerId } from '../sim/types';
import {
  GAMEPLAY_ACTIONS,
  type InputBindingProfile,
  type KeyboardPlayerBindings,
} from './bindings';
import {
  INPUT_COMMAND_LABELS,
  formatGamepadBinding,
  formatKeyboardBinding,
  formatMouseBinding,
} from './bindingEditor';

export interface InputBindingLegend {
  p1Keyboard: string;
  p2Keyboard: string;
  gamepad: string;
  mouse: string;
}

function formatKeyboardLine(playerId: PlayerId, bindings: KeyboardPlayerBindings): string {
  const movement = [bindings.up, bindings.left, bindings.down, bindings.right]
    .map(formatKeyboardBinding)
    .join('/');
  const actions = GAMEPLAY_ACTIONS.map(
    (action) => `${formatKeyboardBinding(bindings[action])} ${INPUT_COMMAND_LABELS[action].toLowerCase()}`,
  ).join(' | ');
  return `${playerId}: ${movement} move | ${actions}`;
}

function formatGamepadActions(profile: InputBindingProfile, playerId: PlayerId): string {
  return GAMEPLAY_ACTIONS.map(
    (action) => `${formatGamepadBinding(profile.gamepad[playerId][action])} ${INPUT_COMMAND_LABELS[action].toLowerCase()}`,
  ).join(' | ');
}

export function buildInputBindingLegend(profile: InputBindingProfile): InputBindingLegend {
  const p1Gamepad = formatGamepadActions(profile, 'P1');
  const p2Gamepad = formatGamepadActions(profile, 'P2');
  const mousePlayers = (['P1', 'P2'] as const).map((playerId) => {
    const actions = GAMEPLAY_ACTIONS
      .filter((action) => profile.mouse[playerId][action] !== null)
      .map((action) => `${formatMouseBinding(profile.mouse[playerId][action])} ${INPUT_COMMAND_LABELS[action].toLowerCase()}`);
    return actions.length > 0 ? `${playerId}: ${actions.join(' | ')}` : null;
  }).filter((line): line is string => line !== null);
  return {
    p1Keyboard: formatKeyboardLine('P1', profile.keyboard.P1),
    p2Keyboard: formatKeyboardLine('P2', profile.keyboard.P2),
    gamepad: p1Gamepad === p2Gamepad
      ? `Controllers: Left stick or D-pad move | ${p1Gamepad}`
      : `P1 pad: ${p1Gamepad} || P2 pad: ${p2Gamepad}`,
    mouse: mousePlayers.length > 0
      ? `Mouse actions: ${mousePlayers.join(' || ')}`
      : 'Mouse actions: unbound',
  };
}

export function renderInputBindingLegend(profile: InputBindingProfile): void {
  const legend = buildInputBindingLegend(profile);
  const entries = {
    p1KeyboardControls: legend.p1Keyboard,
    p2KeyboardControls: legend.p2Keyboard,
    gamepadControls: legend.gamepad,
    mouseControls: legend.mouse,
  };
  for (const [id, text] of Object.entries(entries)) {
    const element = document.querySelector<HTMLSpanElement>(`#${id}`);
    if (element) {
      element.textContent = text;
    }
  }
}
