import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STAGE_ATMOSPHERE_IDS,
  STAGE_ATMOSPHERES,
  type StageAtmosphereTokens,
} from '../src/view/stageAtmosphere';
import { DEFAULT_ASSET_MANIFEST } from '../src/view/assets/defaultManifest';
import { MAX_STAGE_CAMERA_PITCH_DEGREES } from '../src/view/stagePresentation';

interface StageAtmosphereValidationIssue {
  atmosphereId: string;
  message: string;
}

interface StageAtmosphereValidationReport {
  generatedAt: string;
  atmosphereCount: number;
  atmosphereIds: string[];
  valid: boolean;
  issues: StageAtmosphereValidationIssue[];
}

function writeReport(report: StageAtmosphereValidationReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'stage-atmosphere-validation-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function validateFiniteRange(
  issues: StageAtmosphereValidationIssue[],
  atmosphereId: string,
  token: keyof StageAtmosphereTokens,
  value: number,
  {
    min,
    max,
    minExclusive = false,
  }: {
    min: number;
    max: number;
    minExclusive?: boolean;
  },
): void {
  if (!Number.isFinite(value)) {
    issues.push({
      atmosphereId,
      message: `tokens.${token} must be a finite number.`,
    });
    return;
  }
  const lowerBoundValid = minExclusive ? value > min : value >= min;
  if (!lowerBoundValid || value > max) {
    issues.push({
      atmosphereId,
      message: `tokens.${token} must be ${minExclusive ? '>' : '>='} ${min} and <= ${max}.`,
    });
  }
}

function validate(): StageAtmosphereValidationReport {
  const issues: StageAtmosphereValidationIssue[] = [];
  const seen = new Set<string>();
  const textureIds = new Set(DEFAULT_ASSET_MANIFEST.textures.map((entry) => entry.id));
  const modelIds = new Set(DEFAULT_ASSET_MANIFEST.models.map((entry) => entry.id));

  for (const atmosphere of STAGE_ATMOSPHERES) {
    if (seen.has(atmosphere.id)) {
      issues.push({
        atmosphereId: atmosphere.id,
        message: 'duplicate atmosphere id.',
      });
      continue;
    }
    seen.add(atmosphere.id);

    if (atmosphere.id.trim().length === 0) {
      issues.push({
        atmosphereId: atmosphere.id,
        message: 'atmosphere id must not be empty.',
      });
    }
    if (atmosphere.label.trim().length === 0) {
      issues.push({
        atmosphereId: atmosphere.id,
        message: 'label must not be empty.',
      });
    }
    if (atmosphere.description.trim().length === 0) {
      issues.push({
        atmosphereId: atmosphere.id,
        message: 'description must not be empty.',
      });
    }

    const tokens = atmosphere.tokens;
    const colorTokens: Array<keyof StageAtmosphereTokens> = [
      'sceneBackgroundColor',
      'fogColor',
      'ambientLightColor',
      'keyLightColor',
      'gravityWellColor',
      'gravityWellEmissive',
      'ringColor',
      'starsColor',
      'backgroundImageTint',
      'backgroundModelTint',
      'backgroundEffectTint',
      'backgroundEffectSecondaryTint',
    ];
    for (const token of colorTokens) {
      if (typeof tokens[token] !== 'string' || (tokens[token] as string).trim().length === 0) {
        issues.push({
          atmosphereId: atmosphere.id,
          message: `tokens.${token} must be a non-empty string.`,
        });
      }
    }

    validateFiniteRange(issues, atmosphere.id, 'fogNear', tokens.fogNear, { min: 0, max: 1_000 });
    validateFiniteRange(issues, atmosphere.id, 'fogFar', tokens.fogFar, { min: 0, max: 1_000 });
    if (tokens.fogFar <= tokens.fogNear) {
      issues.push({
        atmosphereId: atmosphere.id,
        message: 'tokens.fogFar must be greater than tokens.fogNear.',
      });
    }
    validateFiniteRange(issues, atmosphere.id, 'ambientLightIntensity', tokens.ambientLightIntensity, { min: 0, max: 3 });
    validateFiniteRange(issues, atmosphere.id, 'keyLightIntensity', tokens.keyLightIntensity, { min: 0, max: 4 });
    validateFiniteRange(issues, atmosphere.id, 'cameraPitchDegrees', tokens.cameraPitchDegrees, { min: 0, max: MAX_STAGE_CAMERA_PITCH_DEGREES });
    validateFiniteRange(issues, atmosphere.id, 'cameraLaunchPitchBoostDegrees', tokens.cameraLaunchPitchBoostDegrees, { min: 0, max: 10 });
    validateFiniteRange(issues, atmosphere.id, 'cameraLookAtYOffset', tokens.cameraLookAtYOffset, { min: -12, max: 12 });
    validateFiniteRange(issues, atmosphere.id, 'arenaMouthOpacity', tokens.arenaMouthOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'arenaRimOpacity', tokens.arenaRimOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'arenaDepthTickOpacity', tokens.arenaDepthTickOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'gravityWellEmissiveIntensity', tokens.gravityWellEmissiveIntensity, { min: 0, max: 4 });
    validateFiniteRange(issues, atmosphere.id, 'ringOpacity', tokens.ringOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'starsSize', tokens.starsSize, { min: 0, max: 2, minExclusive: true });
    validateFiniteRange(issues, atmosphere.id, 'backgroundImageOpacity', tokens.backgroundImageOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'backgroundModelOpacity', tokens.backgroundModelOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'backgroundEffectOpacity', tokens.backgroundEffectOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'backgroundEffectCoreOpacity', tokens.backgroundEffectCoreOpacity, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'backgroundEffectFarFade', tokens.backgroundEffectFarFade, { min: 0, max: 1 });
    validateFiniteRange(issues, atmosphere.id, 'backgroundEffectSpeed', tokens.backgroundEffectSpeed, { min: 0, max: 4 });
    validateFiniteRange(issues, atmosphere.id, 'backgroundEffectScale', tokens.backgroundEffectScale, { min: 0.25, max: 4, minExclusive: true });
    validateFiniteRange(issues, atmosphere.id, 'backgroundEffectDepthTravel', tokens.backgroundEffectDepthTravel, { min: 0, max: 20 });

    if (tokens.backgroundImageTextureId !== null) {
      if (typeof tokens.backgroundImageTextureId !== 'string' || tokens.backgroundImageTextureId.trim().length === 0) {
        issues.push({
          atmosphereId: atmosphere.id,
          message: 'tokens.backgroundImageTextureId must be null or a non-empty string.',
        });
      } else if (!textureIds.has(tokens.backgroundImageTextureId)) {
        issues.push({
          atmosphereId: atmosphere.id,
          message: `tokens.backgroundImageTextureId "${tokens.backgroundImageTextureId}" missing from DEFAULT_ASSET_MANIFEST.textures.`,
        });
      }
    }

    if (tokens.backgroundModelId !== null) {
      if (typeof tokens.backgroundModelId !== 'string' || tokens.backgroundModelId.trim().length === 0) {
        issues.push({
          atmosphereId: atmosphere.id,
          message: 'tokens.backgroundModelId must be null or a non-empty string.',
        });
      } else if (!modelIds.has(tokens.backgroundModelId)) {
        issues.push({
          atmosphereId: atmosphere.id,
          message: `tokens.backgroundModelId "${tokens.backgroundModelId}" missing from DEFAULT_ASSET_MANIFEST.models.`,
        });
      }
    }

    if (tokens.backgroundEffectId !== null) {
      if (typeof tokens.backgroundEffectId !== 'string' || tokens.backgroundEffectId.trim().length === 0) {
        issues.push({
          atmosphereId: atmosphere.id,
          message: 'tokens.backgroundEffectId must be null or a non-empty string.',
        });
      } else if (!['wormhole_v1'].includes(tokens.backgroundEffectId)) {
        issues.push({
          atmosphereId: atmosphere.id,
          message: `tokens.backgroundEffectId "${tokens.backgroundEffectId}" is not a supported runtime effect.`,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    atmosphereCount: STAGE_ATMOSPHERES.length,
    atmosphereIds: [...STAGE_ATMOSPHERE_IDS],
    valid: issues.length === 0,
    issues,
  };
}

const report = validate();
const reportPath = writeReport(report);
console.info(`[stage-atmosphere] report written ${reportPath}`);
for (const atmosphere of STAGE_ATMOSPHERES) {
  console.info(`[stage-atmosphere] ${atmosphere.id}: ${atmosphere.label}`);
}

if (!report.valid) {
  for (const issue of report.issues) {
    console.error(`[stage-atmosphere] invalid ${issue.atmosphereId}: ${issue.message}`);
  }
  process.exitCode = 1;
}
