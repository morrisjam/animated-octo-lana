import {
  STAGE_ATMOSPHERE_PRESET_DEFINITIONS,
  type StageAtmospherePresetDefinition,
  type StageAtmospherePresetTokenOverrides,
} from '../../content/stages/atmospherePresets';

export interface StageAtmosphereTokens {
  sceneBackgroundColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  ambientLightColor: string;
  ambientLightIntensity: number;
  keyLightColor: string;
  keyLightIntensity: number;
  keyLightPositionX: number;
  keyLightPositionY: number;
  keyLightPositionZ: number;
  gravityWellColor: string;
  gravityWellEmissive: string;
  gravityWellEmissiveIntensity: number;
  ringColor: string;
  ringOpacity: number;
  starsColor: string;
  starsSize: number;
  backgroundImageTextureId: string | null;
  backgroundImageTint: string;
  backgroundImageOpacity: number;
  backgroundModelId: string | null;
  backgroundModelTint: string;
  backgroundModelOpacity: number;
}

export interface StageAtmospherePreset {
  id: string;
  label: string;
  description: string;
  tokens: StageAtmosphereTokens;
}

export interface StageAtmosphereOption {
  id: string;
  label: string;
  description: string;
}

export const DEFAULT_STAGE_ATMOSPHERE_ID = 'default';

const DEFAULT_STAGE_ATMOSPHERE_TOKENS: StageAtmosphereTokens = {
  sceneBackgroundColor: '#040816',
  fogColor: '#15264a',
  fogNear: 76,
  fogFar: 240,
  ambientLightColor: '#b6c8ff',
  ambientLightIntensity: 0.5,
  keyLightColor: '#d5e4ff',
  keyLightIntensity: 1.3,
  keyLightPositionX: 24,
  keyLightPositionY: 16,
  keyLightPositionZ: 35,
  gravityWellColor: '#7f3fff',
  gravityWellEmissive: '#5b1fcf',
  gravityWellEmissiveIntensity: 1.2,
  ringColor: '#9f82ff',
  ringOpacity: 0.5,
  starsColor: '#99a8ff',
  starsSize: 0.35,
  backgroundImageTextureId: null,
  backgroundImageTint: '#ffffff',
  backgroundImageOpacity: 0.35,
  backgroundModelId: null,
  backgroundModelTint: '#9fb7ff',
  backgroundModelOpacity: 0.5,
};

function mergeTokens(overrides: StageAtmospherePresetTokenOverrides): StageAtmosphereTokens {
  return {
    ...DEFAULT_STAGE_ATMOSPHERE_TOKENS,
    ...overrides,
  };
}

function toPreset(definition: StageAtmospherePresetDefinition): StageAtmospherePreset {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    tokens: mergeTokens(definition.tokens),
  };
}

function buildStageAtmospherePresets(): StageAtmospherePreset[] {
  const presets: StageAtmospherePreset[] = [{
    id: DEFAULT_STAGE_ATMOSPHERE_ID,
    label: 'Default Arena',
    description: 'Baseline Gravity Well arena lighting and atmosphere.',
    tokens: { ...DEFAULT_STAGE_ATMOSPHERE_TOKENS },
  }];
  for (const definition of STAGE_ATMOSPHERE_PRESET_DEFINITIONS) {
    presets.push(toPreset(definition));
  }
  return presets;
}

export const STAGE_ATMOSPHERES: StageAtmospherePreset[] = buildStageAtmospherePresets();
export const STAGE_ATMOSPHERE_IDS: string[] = STAGE_ATMOSPHERES.map((preset) => preset.id);
export const STAGE_ATMOSPHERE_BY_ID: Record<string, StageAtmospherePreset> = Object.fromEntries(
  STAGE_ATMOSPHERES.map((preset) => [preset.id, preset]),
);
export const STAGE_ATMOSPHERE_OPTIONS: StageAtmosphereOption[] = STAGE_ATMOSPHERES.map((preset) => ({
  id: preset.id,
  label: preset.label,
  description: preset.description,
}));

export function resolveStageAtmosphere(presetId: string | undefined | null): StageAtmospherePreset {
  if (!presetId) {
    return STAGE_ATMOSPHERE_BY_ID[DEFAULT_STAGE_ATMOSPHERE_ID];
  }
  const trimmed = presetId.trim();
  if (!trimmed) {
    return STAGE_ATMOSPHERE_BY_ID[DEFAULT_STAGE_ATMOSPHERE_ID];
  }
  return STAGE_ATMOSPHERE_BY_ID[trimmed] ?? STAGE_ATMOSPHERE_BY_ID[DEFAULT_STAGE_ATMOSPHERE_ID];
}
