import {
  formatGamepadFamilyName,
  type GamepadFamily,
} from '../../input/controllerGlyphs';
import type { ControllerPlayerSlot } from '../../input/controllerOwnership';

export type ControllerRecoveryMessageTone = 'warning' | 'success';

export interface ControllerLossMessageContext {
  family: GamepadFamily;
  lostPlayers: readonly ControllerPlayerSlot[];
  replacementControllerCount: number;
  keyboardAvailable: boolean;
}

export interface ControllerRecoveryMessage {
  id: 'controller_lost' | 'controller_recovered';
  tone: ControllerRecoveryMessageTone;
  title: string;
  body: string;
  announcement: string;
  pauseRecommended: boolean;
}

function playerLabel(players: readonly ControllerPlayerSlot[]): string | null {
  if (players.length === 0) {
    return null;
  }
  return players.map((player) => player === 'P1' ? 'Player 1' : 'Player 2').join(' and ');
}

function controllerLabel(family: GamepadFamily): string {
  return family === 'generic'
    ? 'Controller'
    : `${formatGamepadFamilyName(family)} controller`;
}

export function createControllerLossMessage(
  context: ControllerLossMessageContext,
): ControllerRecoveryMessage {
  const affectedPlayers = playerLabel(context.lostPlayers);
  const controllerName = controllerLabel(context.family);
  const title = affectedPlayers
    ? `${affectedPlayers} ${context.lostPlayers.length === 1 ? 'controller' : 'controllers'} disconnected`
    : 'Controller disconnected';
  let recoveryInstruction: string;
  if (context.replacementControllerCount > 0) {
    recoveryInstruction = 'Press any button on another controller to take control.';
  } else if (context.keyboardAvailable) {
    recoveryInstruction = 'Reconnect the controller or use the keyboard to continue.';
  } else {
    recoveryInstruction = 'Reconnect a controller to continue.';
  }
  const body = `${controllerName} was disconnected. ${recoveryInstruction}`;
  return {
    id: 'controller_lost',
    tone: 'warning',
    title,
    body,
    announcement: `${title}. ${body}`,
    pauseRecommended: context.lostPlayers.length > 0,
  };
}

export function createControllerRecoveredMessage(
  player: ControllerPlayerSlot | null,
  family: GamepadFamily,
): ControllerRecoveryMessage {
  const affectedPlayer = playerLabel(player ? [player] : []);
  const title = affectedPlayer
    ? `${affectedPlayer} controller restored`
    : 'Controller restored';
  const body = `${controllerLabel(family)} is ready.`;
  return {
    id: 'controller_recovered',
    tone: 'success',
    title,
    body,
    announcement: `${title}. ${body}`,
    pauseRecommended: false,
  };
}
