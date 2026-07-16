import { describe, expect, test } from 'vitest';
import { resolveStartMenuMotionDirection } from './startMenu';

describe('start menu motion direction', () => {
  test('moves inward as navigation descends through the menu hierarchy', () => {
    expect(resolveStartMenuMotionDirection('title', 'login')).toBe('inward');
    expect(resolveStartMenuMotionDirection('login', 'main')).toBe('inward');
    expect(resolveStartMenuMotionDirection('main', 'online')).toBe('inward');
    expect(resolveStartMenuMotionDirection('online', 'online_ranked')).toBe('inward');
  });

  test('moves outward when back navigation returns to a parent screen', () => {
    expect(resolveStartMenuMotionDirection('online_room', 'online')).toBe('outward');
    expect(resolveStartMenuMotionDirection('local', 'main')).toBe('outward');
    expect(resolveStartMenuMotionDirection('main', 'login')).toBe('outward');
    expect(resolveStartMenuMotionDirection('login', 'title')).toBe('outward');
  });

  test('uses a neutral replacement for same-level, repeated, and match-over screens', () => {
    expect(resolveStartMenuMotionDirection('main', 'main')).toBe('replace');
    expect(resolveStartMenuMotionDirection('local', 'settings')).toBe('replace');
    expect(resolveStartMenuMotionDirection('main', 'match_over')).toBe('replace');
    expect(resolveStartMenuMotionDirection('match_over', 'title')).toBe('replace');
  });
});
