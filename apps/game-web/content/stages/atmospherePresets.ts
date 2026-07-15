export interface StageAtmospherePresetTokenOverrides {
  sceneBackgroundColor?: string;
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;
  ambientLightColor?: string;
  ambientLightIntensity?: number;
  keyLightColor?: string;
  keyLightIntensity?: number;
  keyLightPositionX?: number;
  keyLightPositionY?: number;
  keyLightPositionZ?: number;
  cameraPitchDegrees?: number;
  cameraLaunchPitchBoostDegrees?: number;
  cameraLookAtYOffset?: number;
  arenaMouthOpacity?: number;
  arenaRimOpacity?: number;
  arenaDepthTickOpacity?: number;
  gravityWellColor?: string;
  gravityWellEmissive?: string;
  gravityWellEmissiveIntensity?: number;
  ringColor?: string;
  ringOpacity?: number;
  starsColor?: string;
  starsSize?: number;
  backgroundImageTextureId?: string | null;
  backgroundImageTint?: string;
  backgroundImageOpacity?: number;
  backgroundModelId?: string | null;
  backgroundModelTint?: string;
  backgroundModelOpacity?: number;
  backgroundEffectId?: string | null;
  backgroundEffectTint?: string;
  backgroundEffectSecondaryTint?: string;
  backgroundEffectOpacity?: number;
  backgroundEffectCoreOpacity?: number;
  backgroundEffectFarFade?: number;
  backgroundEffectSpeed?: number;
  backgroundEffectScale?: number;
  backgroundEffectDepthTravel?: number;
}

export interface StageAtmospherePresetDefinition {
  id: string;
  label: string;
  description: string;
  tokens: StageAtmospherePresetTokenOverrides;
}

export const STAGE_ATMOSPHERE_PRESET_DEFINITIONS: StageAtmospherePresetDefinition[] = [
  {
    id: 'wormhole_depths_v2',
    label: 'Wormhole Depths V2',
    description: 'A restrained tilted arena mouth suspended over a slowly twisting cyan-violet gravity shaft.',
    tokens: {
      sceneBackgroundColor: '#01040c',
      fogColor: '#07162d',
      fogNear: 74,
      fogFar: 286,
      ambientLightColor: '#8ebdff',
      ambientLightIntensity: 0.5,
      keyLightColor: '#d8edff',
      keyLightIntensity: 1.42,
      keyLightPositionX: 18,
      keyLightPositionY: 20,
      keyLightPositionZ: 48,
      cameraPitchDegrees: 16,
      cameraLaunchPitchBoostDegrees: 2,
      cameraLookAtYOffset: 3.2,
      arenaMouthOpacity: 0.54,
      arenaRimOpacity: 0.34,
      arenaDepthTickOpacity: 0.22,
      gravityWellColor: '#174d91',
      gravityWellEmissive: '#4826a8',
      gravityWellEmissiveIntensity: 1.5,
      ringColor: '#56bfff',
      ringOpacity: 0,
      starsColor: '#87dfff',
      starsSize: 0.34,
      backgroundImageTextureId: null,
      backgroundModelId: null,
      backgroundEffectId: 'wormhole_v1',
      backgroundEffectTint: '#43d9ff',
      backgroundEffectSecondaryTint: '#8d4cff',
      backgroundEffectOpacity: 0.94,
      backgroundEffectCoreOpacity: 0,
      backgroundEffectFarFade: 0.96,
      backgroundEffectSpeed: 0.7,
      backgroundEffectScale: 1.12,
      backgroundEffectDepthTravel: 6,
    },
  },
  {
    id: 'wormhole_depths_v1',
    label: 'Wormhole Depths V1',
    description: 'A spinning cosmic tunnel with neon depth rings, dense haze, and high-energy particles.',
    tokens: {
      sceneBackgroundColor: '#02040d',
      fogColor: '#140d2d',
      fogNear: 70,
      fogFar: 268,
      ambientLightColor: '#96a5ff',
      ambientLightIntensity: 0.48,
      keyLightColor: '#d7dbff',
      keyLightIntensity: 1.34,
      keyLightPositionX: 12,
      keyLightPositionY: 18,
      keyLightPositionZ: 46,
      cameraPitchDegrees: 22,
      cameraLaunchPitchBoostDegrees: 3,
      cameraLookAtYOffset: 4.6,
      arenaRimOpacity: 0.22,
      arenaDepthTickOpacity: 0.34,
      gravityWellColor: '#5c7cff',
      gravityWellEmissive: '#6b2dff',
      gravityWellEmissiveIntensity: 1.6,
      ringColor: '#8f78ff',
      ringOpacity: 0.38,
      starsColor: '#6cc7ff',
      starsSize: 0.34,
      backgroundImageTextureId: null,
      backgroundModelId: null,
      backgroundEffectId: 'wormhole_v1',
      backgroundEffectTint: '#4fd2ff',
      backgroundEffectSecondaryTint: '#b24cff',
      backgroundEffectOpacity: 1,
      backgroundEffectSpeed: 0.9,
      backgroundEffectScale: 1.08,
      backgroundEffectDepthTravel: 4.5,
    },
  },
  {
    id: 'nebula_twilight_v1',
    label: 'Nebula Twilight V1',
    description: 'Soft purple nebula with medium fog and distant backdrop image.',
    tokens: {
      sceneBackgroundColor: '#070a18',
      fogColor: '#1b2042',
      fogNear: 72,
      fogFar: 236,
      ambientLightColor: '#b9c5ff',
      ambientLightIntensity: 0.54,
      keyLightColor: '#d8d6ff',
      keyLightIntensity: 1.22,
      keyLightPositionX: 18,
      keyLightPositionY: 22,
      keyLightPositionZ: 42,
      gravityWellColor: '#7a51ff',
      gravityWellEmissive: '#4a30d0',
      gravityWellEmissiveIntensity: 1.36,
      ringColor: '#a690ff',
      ringOpacity: 0.56,
      starsColor: '#aab6ff',
      starsSize: 0.34,
      backgroundImageTextureId: 'stage_nebula_texture',
      backgroundImageTint: '#8d9cff',
      backgroundImageOpacity: 0.38,
      backgroundModelId: null,
    },
  },
  {
    id: 'ion_storm_v1',
    label: 'Ion Storm V1',
    description: 'Cool cyan storm mood with sharper contrast and industrial silhouette model.',
    tokens: {
      sceneBackgroundColor: '#031118',
      fogColor: '#0b3342',
      fogNear: 68,
      fogFar: 224,
      ambientLightColor: '#97d1ee',
      ambientLightIntensity: 0.6,
      keyLightColor: '#c3f7ff',
      keyLightIntensity: 1.28,
      keyLightPositionX: 28,
      keyLightPositionY: 10,
      keyLightPositionZ: 38,
      gravityWellColor: '#35b6ff',
      gravityWellEmissive: '#1a6ea2',
      gravityWellEmissiveIntensity: 1.44,
      ringColor: '#7ce6ff',
      ringOpacity: 0.54,
      starsColor: '#9fd9ef',
      starsSize: 0.3,
      backgroundImageTextureId: 'stage_ion_clouds_texture',
      backgroundImageTint: '#8be7ff',
      backgroundImageOpacity: 0.32,
      backgroundModelId: 'stage_spire_model',
      backgroundModelTint: '#6cc8d8',
      backgroundModelOpacity: 0.52,
    },
  },
  {
    id: 'ruins_sunset_v1',
    label: 'Ruins Sunset V1',
    description: 'Warm sunset haze with silhouetted ruins model and long-distance fog.',
    tokens: {
      sceneBackgroundColor: '#160b08',
      fogColor: '#4f2f23',
      fogNear: 86,
      fogFar: 260,
      ambientLightColor: '#ffd4b3',
      ambientLightIntensity: 0.52,
      keyLightColor: '#ffe3bf',
      keyLightIntensity: 1.15,
      keyLightPositionX: -20,
      keyLightPositionY: 24,
      keyLightPositionZ: 34,
      gravityWellColor: '#e56f55',
      gravityWellEmissive: '#b84a31',
      gravityWellEmissiveIntensity: 1.28,
      ringColor: '#ffb587',
      ringOpacity: 0.58,
      starsColor: '#ffcaa0',
      starsSize: 0.28,
      backgroundImageTextureId: 'stage_sunset_haze_texture',
      backgroundImageTint: '#ffb98a',
      backgroundImageOpacity: 0.36,
      backgroundModelId: 'stage_ruins_model',
      backgroundModelTint: '#d58a6e',
      backgroundModelOpacity: 0.54,
    },
  },
];
