export type RuntimeEnvironment = 'development' | 'staging' | 'production';

export interface FeatureFlags {
  onlineEnabled: boolean;
  rankedEnabled: boolean;
  debugToolsEnabled: boolean;
  trainingModeEnabled: boolean;
  arcadeModeEnabled: boolean;
}

export interface RuntimeConfig {
  environment: RuntimeEnvironment;
  features: FeatureFlags;
}

const ENVIRONMENT_PRESETS: Record<RuntimeEnvironment, FeatureFlags> = {
  development: {
    onlineEnabled: true,
    rankedEnabled: true,
    debugToolsEnabled: true,
    trainingModeEnabled: true,
    arcadeModeEnabled: true,
  },
  staging: {
    onlineEnabled: true,
    rankedEnabled: true,
    debugToolsEnabled: true,
    trainingModeEnabled: true,
    arcadeModeEnabled: false,
  },
  production: {
    onlineEnabled: false,
    rankedEnabled: false,
    debugToolsEnabled: false,
    trainingModeEnabled: true,
    arcadeModeEnabled: false,
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
  const debugOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_DEBUG_TOOLS);
  const trainingOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_TRAINING_MODE);
  const arcadeOverride = parseBooleanEnv(import.meta.env.VITE_FEATURE_ARCADE_MODE);

  const features: FeatureFlags = {
    onlineEnabled: onlineOverride ?? preset.onlineEnabled,
    rankedEnabled: rankedOverride ?? preset.rankedEnabled,
    debugToolsEnabled: debugOverride ?? preset.debugToolsEnabled,
    trainingModeEnabled: trainingOverride ?? preset.trainingModeEnabled,
    arcadeModeEnabled: arcadeOverride ?? preset.arcadeModeEnabled,
  };

  if (!features.onlineEnabled) {
    features.rankedEnabled = false;
  }

  return {
    environment,
    features,
  };
}
