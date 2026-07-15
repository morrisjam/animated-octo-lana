export type RuntimeEnvironment = 'development' | 'staging' | 'production';

export interface FeatureFlags {
  onlineEnabled: boolean;
  rankedEnabled: boolean;
  onlineMatchRuntimeEnabled: boolean;
  debugToolsEnabled: boolean;
  onlineDiagnosticsEnabled: boolean;
  trainingModeEnabled: boolean;
  arcadeModeEnabled: boolean;
  onlineDevMenuEnabled: boolean;
}

export interface RuntimeConfig {
  environment: RuntimeEnvironment;
  features: FeatureFlags;
}

export interface OnlineDiagnosticsVisibilityOptions {
  platformKind: 'web' | 'steam';
  configuredEnabled: boolean;
  queryOverride: string | null;
  developmentBuild: boolean;
}

export function shouldEnableOnlineDiagnostics(
  options: OnlineDiagnosticsVisibilityOptions,
): boolean {
  if (options.platformKind !== 'web' || options.queryOverride === '0') {
    return false;
  }
  if (options.configuredEnabled) {
    return true;
  }
  return options.developmentBuild && options.queryOverride === '1';
}

const ENVIRONMENT_PRESETS: Record<RuntimeEnvironment, FeatureFlags> = {
  development: {
    onlineEnabled: true,
    rankedEnabled: true,
    onlineMatchRuntimeEnabled: false,
    debugToolsEnabled: true,
    onlineDiagnosticsEnabled: false,
    trainingModeEnabled: true,
    arcadeModeEnabled: true,
    onlineDevMenuEnabled: true,
  },
  staging: {
    onlineEnabled: true,
    rankedEnabled: true,
    onlineMatchRuntimeEnabled: false,
    debugToolsEnabled: true,
    onlineDiagnosticsEnabled: true,
    trainingModeEnabled: true,
    arcadeModeEnabled: false,
    onlineDevMenuEnabled: true,
  },
  production: {
    onlineEnabled: false,
    rankedEnabled: false,
    onlineMatchRuntimeEnabled: false,
    debugToolsEnabled: false,
    onlineDiagnosticsEnabled: false,
    trainingModeEnabled: true,
    arcadeModeEnabled: false,
    onlineDevMenuEnabled: false,
  },
};

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === '1' || normalised === 'true' || normalised === 'yes' || normalised === 'on') {
    return true;
  }
  if (normalised === '0' || normalised === 'false' || normalised === 'no' || normalised === 'off') {
    return false;
  }
  return undefined;
}

function normaliseEnvironment(rawValue: string | undefined): RuntimeEnvironment {
  const normalised = (rawValue ?? '').trim().toLowerCase();
  if (normalised === 'production' || normalised === 'staging' || normalised === 'development') {
    return normalised;
  }
  return 'development';
}

export function loadRuntimeConfig(): RuntimeConfig {
  const environment = normaliseEnvironment(import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE);
  const preset = ENVIRONMENT_PRESETS[environment];

  const onlineOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_ONLINE);
  const rankedOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_RANKED);
  const onlineRuntimeOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_ONLINE_MATCH_RUNTIME);
  const debugOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_DEBUG_TOOLS);
  const diagnosticsOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_ONLINE_DIAGNOSTICS);
  const trainingOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_TRAINING_MODE);
  const arcadeOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_ARCADE_MODE);
  const onlineDevMenuOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_ONLINE_DEV_MENU);

  const features: FeatureFlags = {
    onlineEnabled: onlineOverride ?? preset.onlineEnabled,
    rankedEnabled: rankedOverride ?? preset.rankedEnabled,
    onlineMatchRuntimeEnabled: onlineRuntimeOverride ?? preset.onlineMatchRuntimeEnabled,
    debugToolsEnabled: debugOverride ?? preset.debugToolsEnabled,
    onlineDiagnosticsEnabled: diagnosticsOverride ?? preset.onlineDiagnosticsEnabled,
    trainingModeEnabled: trainingOverride ?? preset.trainingModeEnabled,
    arcadeModeEnabled: arcadeOverride ?? preset.arcadeModeEnabled,
    onlineDevMenuEnabled: onlineDevMenuOverride ?? preset.onlineDevMenuEnabled,
  };

  if (!features.onlineEnabled) {
    features.rankedEnabled = false;
    features.onlineMatchRuntimeEnabled = false;
    features.onlineDiagnosticsEnabled = false;
  }

  return {
    environment,
    features,
  };
}
