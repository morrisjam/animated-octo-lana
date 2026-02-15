import { describe, expect, test } from 'vitest';
import {
  DEFAULT_STAGE_ATMOSPHERE_ID,
  STAGE_ATMOSPHERE_IDS,
  STAGE_ATMOSPHERES,
  resolveStageAtmosphere,
} from './stageAtmosphere';

describe('stage atmosphere registry', () => {
  test('includes default and resolves unknown ids to default', () => {
    expect(STAGE_ATMOSPHERE_IDS.includes(DEFAULT_STAGE_ATMOSPHERE_ID)).toBe(true);
    expect(STAGE_ATMOSPHERE_IDS.includes('ion_storm_v1')).toBe(true);
    expect(resolveStageAtmosphere(undefined).id).toBe(DEFAULT_STAGE_ATMOSPHERE_ID);
    expect(resolveStageAtmosphere('').id).toBe(DEFAULT_STAGE_ATMOSPHERE_ID);
    expect(resolveStageAtmosphere('missing-atmosphere').id).toBe(DEFAULT_STAGE_ATMOSPHERE_ID);
  });

  test('keeps optional background slots and core lighting tokens defined', () => {
    for (const atmosphere of STAGE_ATMOSPHERES) {
      expect(atmosphere.label.trim().length).toBeGreaterThan(0);
      expect(atmosphere.description.trim().length).toBeGreaterThan(0);
      expect(atmosphere.tokens.sceneBackgroundColor.trim().length).toBeGreaterThan(0);
      expect(Number.isFinite(atmosphere.tokens.ambientLightIntensity)).toBe(true);
      expect(Number.isFinite(atmosphere.tokens.keyLightIntensity)).toBe(true);
      expect(Number.isFinite(atmosphere.tokens.fogNear)).toBe(true);
      expect(Number.isFinite(atmosphere.tokens.fogFar)).toBe(true);
      expect(atmosphere.tokens.fogFar).toBeGreaterThan(atmosphere.tokens.fogNear);
      expect(atmosphere.tokens.backgroundImageTextureId === null || atmosphere.tokens.backgroundImageTextureId.trim().length > 0).toBe(true);
      expect(atmosphere.tokens.backgroundModelId === null || atmosphere.tokens.backgroundModelId.trim().length > 0).toBe(true);
    }
  });
});
