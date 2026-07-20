import { describe, expect, test } from 'vitest';
import {
  createControllerLossMessage,
  createControllerRecoveredMessage,
} from './recoveryMessage';

describe('controller recovery messaging', () => {
  test('pauses for a player-owned controller and offers a connected replacement', () => {
    const message = createControllerLossMessage({
      family: 'xbox',
      lostPlayers: ['P1'],
      replacementControllerCount: 1,
      keyboardAvailable: true,
    });

    expect(message).toMatchObject({
      id: 'controller_lost',
      title: 'Player 1 controller disconnected',
      pauseRecommended: true,
    });
    expect(message.body).toContain('Press any button on another controller');
  });

  test('does not recommend pausing when only the menu-active controller is lost', () => {
    const message = createControllerLossMessage({
      family: 'generic',
      lostPlayers: [],
      replacementControllerCount: 0,
      keyboardAvailable: true,
    });

    expect(message.pauseRecommended).toBe(false);
    expect(message.body).toContain('Controller was disconnected');
    expect(message.body).not.toContain('Controller controller');
    expect(message.body).toContain('use the keyboard');
  });

  test('announces restored ownership accessibly', () => {
    expect(createControllerRecoveredMessage('P2', 'playstation')).toMatchObject({
      title: 'Player 2 controller restored',
      body: 'PlayStation controller is ready.',
      tone: 'success',
    });
  });
});
