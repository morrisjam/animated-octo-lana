import { describe, expect, test } from 'vitest';
import {
  DEFAULT_STAGE_ATMOSPHERE_ID,
  ONLINE_ALPHA_STAGE_ATMOSPHERE_ID,
  STAGE_ATMOSPHERE_IDS,
  STAGE_ATMOSPHERES,
  resolveStageAtmosphere,
} from './stageAtmosphere';
import { MAX_STAGE_CAMERA_PITCH_DEGREES } from './stagePresentation';

describe('stage atmosphere registry', () => {
  test('includes default and resolves unknown ids to default', () => {
    expect(STAGE_ATMOSPHERE_IDS.includes(DEFAULT_STAGE_ATMOSPHERE_ID)).toBe(true);
    expect(STAGE_ATMOSPHERE_IDS.includes('ion_storm_v1')).toBe(true);
    expect(STAGE_ATMOSPHERE_IDS.includes('wormhole_depths_v1')).toBe(true);
    expect(STAGE_ATMOSPHERE_IDS.includes(ONLINE_ALPHA_STAGE_ATMOSPHERE_ID)).toBe(true);
    expect(resolveStageAtmosphere(undefined).id).toBe(DEFAULT_STAGE_ATMOSPHERE_ID);
    expect(resolveStageAtmosphere('').id).toBe(DEFAULT_STAGE_ATMOSPHERE_ID);
    expect(resolveStageAtmosphere('missing-atmosphere').id).toBe(DEFAULT_STAGE_ATMOSPHERE_ID);
    expect(resolveStageAtmosphere('wormhole_depths_v1').tokens.cameraPitchDegrees).toBeGreaterThan(
      resolveStageAtmosphere(DEFAULT_STAGE_ATMOSPHERE_ID).tokens.cameraPitchDegrees,
    );
  });

  test('keeps optional background slots and core lighting tokens defined', () => {
    for (const atmosphere of STAGE_ATMOSPHERES) {
      expect(atmosphere.label.trim().length).toBeGreaterThan(0);
      expect(atmosphere.description.trim().length).toBeGreaterThan(0);
      expect(atmosphere.tokens.sceneBackgroundColor.trim().length).toBeGreaterThan(0);
      expect(Number.isFinite(atmosphere.tokens.ambientLightIntensity)).toBe(true);
      expect(Number.isFinite(atmosphere.tokens.keyLightIntensity)).toBe(true);
      expect(atmosphere.tokens.cameraPitchDegrees).toBeGreaterThanOrEqual(0);
      expect(atmosphere.tokens.cameraPitchDegrees).toBeLessThanOrEqual(MAX_STAGE_CAMERA_PITCH_DEGREES);
      expect(atmosphere.tokens.cameraLaunchPitchBoostDegrees).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(atmosphere.tokens.cameraLookAtYOffset)).toBe(true);
      expect(atmosphere.tokens.arenaMouthOpacity).toBeGreaterThanOrEqual(0);
      expect(atmosphere.tokens.arenaMouthOpacity).toBeLessThanOrEqual(1);
      expect(atmosphere.tokens.arenaRimOpacity).toBeGreaterThanOrEqual(0);
      expect(atmosphere.tokens.arenaRimOpacity).toBeLessThanOrEqual(1);
      expect(atmosphere.tokens.arenaDepthTickOpacity).toBeGreaterThanOrEqual(0);
      expect(atmosphere.tokens.arenaDepthTickOpacity).toBeLessThanOrEqual(1);
      expect(Number.isFinite(atmosphere.tokens.fogNear)).toBe(true);
      expect(Number.isFinite(atmosphere.tokens.fogFar)).toBe(true);
      expect(atmosphere.tokens.fogFar).toBeGreaterThan(atmosphere.tokens.fogNear);
      expect(atmosphere.tokens.backgroundImageTextureId === null || atmosphere.tokens.backgroundImageTextureId.trim().length > 0).toBe(true);
      expect(atmosphere.tokens.backgroundModelId === null || atmosphere.tokens.backgroundModelId.trim().length > 0).toBe(true);
      expect(atmosphere.tokens.backgroundEffectId === null || atmosphere.tokens.backgroundEffectId.trim().length > 0).toBe(true);
      expect(atmosphere.tokens.backgroundEffectTint.trim().length).toBeGreaterThan(0);
      expect(atmosphere.tokens.backgroundEffectSecondaryTint.trim().length).toBeGreaterThan(0);
      expect(Number.isFinite(atmosphere.tokens.backgroundEffectOpacity)).toBe(true);
      expect(atmosphere.tokens.backgroundEffectCoreOpacity).toBeGreaterThanOrEqual(0);
      expect(atmosphere.tokens.backgroundEffectCoreOpacity).toBeLessThanOrEqual(1);
      expect(atmosphere.tokens.backgroundEffectFarFade).toBeGreaterThanOrEqual(0);
      expect(atmosphere.tokens.backgroundEffectFarFade).toBeLessThanOrEqual(1);
      expect(Number.isFinite(atmosphere.tokens.backgroundEffectSpeed)).toBe(true);
      expect(Number.isFinite(atmosphere.tokens.backgroundEffectScale)).toBe(true);
      expect(Number.isFinite(atmosphere.tokens.backgroundEffectDepthTravel)).toBe(true);
    }
  });

  test('keeps V1 compatible while V2 opts into the tilted arena-mouth treatment', () => {
    expect(resolveStageAtmosphere('wormhole_depths_v1').tokens.arenaMouthOpacity).toBe(0);
    const alphaPreset = resolveStageAtmosphere(ONLINE_ALPHA_STAGE_ATMOSPHERE_ID);
    expect(alphaPreset.tokens.arenaMouthOpacity).toBeGreaterThan(0);
    expect(alphaPreset.tokens.cameraPitchDegrees).toBeGreaterThan(0);
    expect(alphaPreset.tokens.backgroundEffectId).toBe('wormhole_v1');
    expect(alphaPreset.tokens.backgroundEffectCoreOpacity).toBeLessThan(
      resolveStageAtmosphere('wormhole_depths_v1').tokens.backgroundEffectCoreOpacity,
    );
    expect(alphaPreset.tokens.backgroundEffectFarFade).toBeGreaterThan(
      resolveStageAtmosphere('wormhole_depths_v1').tokens.backgroundEffectFarFade,
    );
  });
});
