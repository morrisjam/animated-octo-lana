import { describe, expect, test } from 'vitest';
import type { AssetManifest } from './types';
import {
  buildAssetBudgetReport,
  buildAssetBudgetUsage,
  DEFAULT_ASSET_BUDGET_LIMITS,
  estimatePresetEmitterCount,
} from './budget';

function makeManifest(): AssetManifest {
  return {
    models: [
      {
        id: 'model_alpha',
        src: 'https://assets.example.com/model_alpha.bin',
        budget: {
          estimatedTriangles: 4_000,
          estimatedVfxEmitters: 3,
        },
      },
    ],
    sprites: [
      {
        id: 'sprite_alpha',
        src: 'https://assets.example.com/sprite_alpha.png',
        budget: {
          estimatedTextureBytes: 2 * 1024 * 1024,
        },
      },
    ],
    textures: [
      {
        id: 'texture_alpha',
        src: 'https://assets.example.com/texture_alpha.png',
        budget: {
          estimatedTextureBytes: 6 * 1024 * 1024,
        },
      },
    ],
    audio: [],
    shaders: [],
  };
}

describe('asset budget reports', () => {
  test('computes texture, mesh, and VFX usage totals', () => {
    const manifest = makeManifest();
    const usage = buildAssetBudgetUsage(manifest);

    expect(usage.textureBytes).toBe(8 * 1024 * 1024);
    expect(usage.meshTriangles).toBe(4_000);
    expect(usage.vfxEmitters).toBe(3 + estimatePresetEmitterCount());
  });

  test('reports violations for exceeded budget limits', () => {
    const manifest = makeManifest();
    const report = buildAssetBudgetReport(manifest, {
      textureBytes: 1 * 1024 * 1024,
      meshTriangles: 1_000,
      vfxEmitters: 2,
    });

    expect(report.pass).toBe(false);
    expect(report.violations.map((entry) => entry.metric)).toContain('textureBytes');
    expect(report.violations.map((entry) => entry.metric)).toContain('meshTriangles');
    expect(report.violations.map((entry) => entry.metric)).toContain('vfxEmitters');
  });

  test('passes under default limits for lightweight placeholder manifests', () => {
    const report = buildAssetBudgetReport(makeManifest(), DEFAULT_ASSET_BUDGET_LIMITS);
    expect(report.pass).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

