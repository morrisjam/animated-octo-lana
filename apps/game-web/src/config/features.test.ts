import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig, shouldEnableOnlineDiagnostics } from './features';

describe('shouldEnableOnlineDiagnostics', () => {
  it('honours the deployment flag outside development', () => {
    expect(shouldEnableOnlineDiagnostics({
      platformKind: 'web',
      configuredEnabled: true,
      queryOverride: null,
      developmentBuild: false,
    })).toBe(true);
  });

  it('allows a query-only opt-in only in a development build', () => {
    expect(shouldEnableOnlineDiagnostics({
      platformKind: 'web',
      configuredEnabled: false,
      queryOverride: '1',
      developmentBuild: true,
    })).toBe(true);
    expect(shouldEnableOnlineDiagnostics({
      platformKind: 'web',
      configuredEnabled: false,
      queryOverride: '1',
      developmentBuild: false,
    })).toBe(false);
  });

  it('allows an explicit query opt-out and never enables the web overlay on Steam', () => {
    expect(shouldEnableOnlineDiagnostics({
      platformKind: 'web',
      configuredEnabled: true,
      queryOverride: '0',
      developmentBuild: false,
    })).toBe(false);
    expect(shouldEnableOnlineDiagnostics({
      platformKind: 'steam',
      configuredEnabled: true,
      queryOverride: null,
      developmentBuild: true,
    })).toBe(false);
  });
});

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
