import { COMBAT_VFX_PRESET_LIBRARY } from '../vfx/presets';
import type { AssetManifest, AssetManifestEntryBase } from './types';

export interface AssetBudgetLimits {
  textureBytes: number;
  meshTriangles: number;
  vfxEmitters: number;
}

export interface AssetBudgetUsage {
  textureBytes: number;
  meshTriangles: number;
  vfxEmitters: number;
}

export interface AssetBudgetViolation {
  metric: keyof AssetBudgetUsage;
  usage: number;
  limit: number;
  overBy: number;
}

export interface AssetBudgetReport {
  limits: AssetBudgetLimits;
  usage: AssetBudgetUsage;
  pass: boolean;
  violations: AssetBudgetViolation[];
}

export const DEFAULT_ASSET_BUDGET_LIMITS: AssetBudgetLimits = {
  textureBytes: 64 * 1024 * 1024,
  meshTriangles: 120_000,
  vfxEmitters: 48,
};

function sumBudget(entries: AssetManifestEntryBase[], selector: (entry: AssetManifestEntryBase) => number): number {
  let total = 0;
  for (const entry of entries) {
    total += selector(entry);
  }
  return total;
}

function estimatedBytes(entry: AssetManifestEntryBase): number {
  return entry.budget?.estimatedBytes ?? 0;
}

function estimatedTextureBytes(entry: AssetManifestEntryBase): number {
  return entry.budget?.estimatedTextureBytes ?? estimatedBytes(entry);
}

function estimatedTriangles(entry: AssetManifestEntryBase): number {
  return entry.budget?.estimatedTriangles ?? 0;
}

function estimatedVfxEmitters(entry: AssetManifestEntryBase): number {
  return entry.budget?.estimatedVfxEmitters ?? 0;
}

export function estimatePresetEmitterCount(): number {
  let count = 0;
  for (const preset of Object.values(COMBAT_VFX_PRESET_LIBRARY)) {
    if (preset.particles) {
      count += 1;
    }
    if (preset.trail) {
      count += 1;
    }
    if (preset.flash) {
      count += 1;
    }
  }
  return count;
}

export function buildAssetBudgetUsage(manifest: AssetManifest): AssetBudgetUsage {
  const textureBytes = sumBudget(
    [...manifest.sprites, ...manifest.textures],
    estimatedTextureBytes,
  );
  const meshTriangles = sumBudget(manifest.models, estimatedTriangles);
  const vfxEmitters = sumBudget(manifest.models, estimatedVfxEmitters) + estimatePresetEmitterCount();

  return {
    textureBytes,
    meshTriangles,
    vfxEmitters,
  };
}

export function buildAssetBudgetReport(
  manifest: AssetManifest,
  limits: AssetBudgetLimits = DEFAULT_ASSET_BUDGET_LIMITS,
): AssetBudgetReport {
  const usage = buildAssetBudgetUsage(manifest);
  const violations: AssetBudgetViolation[] = [];
  const metrics: Array<keyof AssetBudgetUsage> = ['textureBytes', 'meshTriangles', 'vfxEmitters'];
  for (const metric of metrics) {
    const usageValue = usage[metric];
    const limitValue = limits[metric];
    if (usageValue > limitValue) {
      violations.push({
        metric,
        usage: usageValue,
        limit: limitValue,
        overBy: usageValue - limitValue,
      });
    }
  }
  return {
    limits,
    usage,
    pass: violations.length === 0,
    violations,
  };
}
