import { describe, expect, test } from 'vitest';
import {
  applySafeAreaPreference,
  calculateSafeAreaLayout,
  sanitiseSafeAreaPreference,
} from './safeArea';

describe('controller-safe UI area', () => {
  test('preserves larger system insets and applies a comfortable minimum', () => {
    expect(calculateSafeAreaLayout({
      viewportWidth: 1920,
      viewportHeight: 1080,
      preference: 'comfortable',
      systemInsets: { top: 48, left: 20 },
    })).toEqual({
      top: 48,
      right: 48,
      bottom: 27,
      left: 48,
      contentWidth: 1824,
      contentHeight: 1005,
    });
  });

  test('uses a five-percent title-safe margin for television mode', () => {
    expect(calculateSafeAreaLayout({
      viewportWidth: 1280,
      viewportHeight: 720,
      preference: 'television',
    })).toMatchObject({ top: 36, right: 64, bottom: 36, left: 64 });
  });

  test('sanitises preferences and applies reusable CSS variables', () => {
    const properties = new Map<string, string>();
    const layout = applySafeAreaPreference(
      { setProperty: (name, value) => properties.set(name, value) },
      { viewportWidth: 800, viewportHeight: 600, preference: 'system' },
    );

    expect(sanitiseSafeAreaPreference('overscan')).toBe('system');
    expect(layout.contentWidth).toBe(800);
    expect(properties.get('--gw-safe-area-left')).toBe('0px');
    expect(properties.get('--gw-safe-area-content-height')).toBe('600px');
  });
});
