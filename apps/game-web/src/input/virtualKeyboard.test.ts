import { describe, expect, test } from 'vitest';
import {
  createBrowserVirtualKeyboard,
  createVirtualKeyboardService,
  type PlatformVirtualKeyboard,
} from './virtualKeyboard';

describe('browser virtual keyboard fallback', () => {
  test('normalises and limits submitted browser text', async () => {
    const keyboard = createBrowserVirtualKeyboard({
      prompt: () => '  LONG PLAYER NAME  ',
    });

    await expect(keyboard.requestText({
      title: 'Profile',
      label: 'Player name',
      maxLength: 10,
      trim: true,
    })).resolves.toEqual({
      status: 'submitted',
      source: 'browser_prompt',
      value: 'LONG PLA',
    });
  });

  test('does not send secure text through an unmasked browser prompt', async () => {
    const keyboard = createBrowserVirtualKeyboard({ prompt: () => 'secret' });

    await expect(keyboard.requestText({
      title: 'Sign in',
      label: 'Password',
      secure: true,
    })).resolves.toMatchObject({ status: 'unavailable' });
  });
});

describe('platform virtual keyboard service', () => {
  test('uses a platform keyboard before the browser fallback', async () => {
    const platform: PlatformVirtualKeyboard = {
      id: 'console_keyboard',
      supportsSecureEntry: true,
      isAvailable: () => true,
      requestText: async () => ({
        status: 'submitted',
        source: 'console_keyboard',
        value: 'Pilot',
      }),
    };
    const browser = createBrowserVirtualKeyboard({ prompt: () => 'Browser' });
    const service = createVirtualKeyboardService(platform, browser);

    await expect(service.requestText({ title: 'Profile', label: 'Name' })).resolves.toEqual({
      status: 'submitted',
      source: 'console_keyboard',
      value: 'Pilot',
    });
  });

  test('falls back after a platform error but preserves explicit cancellation', async () => {
    const failingPlatform: PlatformVirtualKeyboard = {
      id: 'platform',
      supportsSecureEntry: true,
      isAvailable: () => true,
      requestText: async () => ({ status: 'error', source: 'platform', reason: 'offline' }),
    };
    const browser = createBrowserVirtualKeyboard({ prompt: () => 'Fallback' });
    const service = createVirtualKeyboardService(failingPlatform, browser);

    await expect(service.requestText({ title: 'Room', label: 'Code' })).resolves.toMatchObject({
      status: 'submitted',
      source: 'browser_prompt',
      value: 'Fallback',
    });

    const cancelledPlatform: PlatformVirtualKeyboard = {
      ...failingPlatform,
      requestText: async () => ({ status: 'cancelled', source: 'platform' }),
    };
    await expect(
      createVirtualKeyboardService(cancelledPlatform, browser)
        .requestText({ title: 'Room', label: 'Code' }),
    ).resolves.toEqual({ status: 'cancelled', source: 'platform' });
  });
});
