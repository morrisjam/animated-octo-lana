import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig } from './features';

describe('loadRuntimeConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps online match runtime disabled by default in development', () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_APP_ENV', 'development');
    vi.stubEnv('VITE_FEATURE_ONLINE', undefined);
    vi.stubEnv('VITE_FEATURE_ONLINE_MATCH_RUNTIME', undefined);

    const config = loadRuntimeConfig();

    expect(config.features.onlineEnabled).toBe(true);
    expect(config.features.onlineMatchRuntimeEnabled).toBe(false);
  });

  it('disables ranked and runtime flags when online is disabled', () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_APP_ENV', 'development');
    vi.stubEnv('VITE_FEATURE_ONLINE', 'false');
    vi.stubEnv('VITE_FEATURE_RANKED', 'true');
    vi.stubEnv('VITE_FEATURE_ONLINE_MATCH_RUNTIME', 'true');

    const config = loadRuntimeConfig();

    expect(config.features.onlineEnabled).toBe(false);
    expect(config.features.rankedEnabled).toBe(false);
    expect(config.features.onlineMatchRuntimeEnabled).toBe(false);
  });

  it('allows explicit runtime bootstrap opt-in', () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_APP_ENV', 'development');
    vi.stubEnv('VITE_FEATURE_ONLINE', 'true');
    vi.stubEnv('VITE_FEATURE_ONLINE_MATCH_RUNTIME', 'true');

    const config = loadRuntimeConfig();

    expect(config.features.onlineEnabled).toBe(true);
    expect(config.features.onlineMatchRuntimeEnabled).toBe(true);
  });
});
