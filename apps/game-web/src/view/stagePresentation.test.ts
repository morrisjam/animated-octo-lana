import { describe, expect, test } from 'vitest';
import {
  ARENA_GUIDE_DEPTH,
  MAX_STAGE_CAMERA_PITCH_DEGREES,
  WORMHOLE_FAR_DEPTH,
  WORMHOLE_NEAR_DEPTH,
  createArenaGuideSegmentPoints,
  createArenaLipDepthSegmentPoints,
  createArenaLipShelfTriangleVertices,
  createArenaLipSegmentPoints,
  resolveStageCameraPitchDegrees,
  resolveStageCameraYOffset,
  resolveWormholeCoreOpacity,
  resolveWormholeLayerDepth,
  resolveWormholeParticleDepth,
} from './stagePresentation';

describe('stage presentation math', () => {
  test('builds deterministic broken polar guides that stay on the presentation plane', () => {
    const first = createArenaGuideSegmentPoints(60);
    const second = createArenaGuideSegmentPoints(60);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(300);
    expect(first.length % 2).toBe(0);
    expect(first.every((point) => point.z === ARENA_GUIDE_DEPTH)).toBe(true);
    expect(Math.max(...first.map((point) => Math.hypot(point.x, point.y)))).toBeCloseTo(62.7, 8);
    expect(Math.min(...first.map((point) => Math.hypot(point.x, point.y)))).toBeGreaterThanOrEqual(19.1);
    expect(createArenaGuideSegmentPoints(0)).toEqual([]);
    expect(createArenaGuideSegmentPoints(Number.NaN)).toEqual([]);
  });

  test('builds an asymmetric broken arena lip without closing a perfect circle', () => {
    const first = createArenaLipSegmentPoints(60);
    const second = createArenaLipSegmentPoints(60);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(300);
    expect(first.length).toBeLessThan(3 * 144 * 2);
    expect(first.length % 2).toBe(0);
    expect(first.every((point) => point.z === ARENA_GUIDE_DEPTH)).toBe(true);
    expect(Math.max(...first.map((point) => Math.hypot(point.x, point.y)))).toBeLessThan(63);
    expect(Math.min(...first.map((point) => Math.hypot(point.x, point.y)))).toBeGreaterThan(55);
    expect(createArenaLipSegmentPoints(0)).toEqual([]);
    expect(createArenaLipSegmentPoints(Number.NaN)).toEqual([]);
  });

  test('builds a broken near-edge depth shelf below the arena plane', () => {
    const first = createArenaLipDepthSegmentPoints(60);
    const second = createArenaLipDepthSegmentPoints(60);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(250);
    expect(first.length % 2).toBe(0);
    expect(first.every((point) => point.y < 0)).toBe(true);
    expect(Math.max(...first.map((point) => point.z))).toBeLessThan(0);
    expect(Math.min(...first.map((point) => point.z))).toBeGreaterThan(-5);
    expect(Math.max(...first.map((point) => Math.hypot(point.x, point.y)))).toBeLessThan(62);
    expect(Math.min(...first.map((point) => Math.hypot(point.x, point.y)))).toBeGreaterThan(56);
    expect(createArenaLipDepthSegmentPoints(0)).toEqual([]);
    expect(createArenaLipDepthSegmentPoints(Number.NaN)).toEqual([]);
  });

  test('builds a segmented camera-facing lip ribbon without closing the arena', () => {
    const first = createArenaLipShelfTriangleVertices(60);
    const second = createArenaLipShelfTriangleVertices(60);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(250);
    expect(first.length % 6).toBe(0);
    expect(first.every((vertex) => vertex.y < 0)).toBe(true);
    expect(new Set(first.map((vertex) => vertex.band))).toEqual(new Set([0, 1]));
    expect(Math.max(...first.map((vertex) => vertex.z))).toBeLessThan(0);
    expect(Math.min(...first.map((vertex) => vertex.z))).toBeGreaterThan(-1.6);
    expect(Math.max(...first.map((vertex) => Math.hypot(vertex.x, vertex.y)))).toBeLessThan(63);
    expect(Math.min(...first.map((vertex) => Math.hypot(vertex.x, vertex.y)))).toBeGreaterThan(52);
    expect(createArenaLipShelfTriangleVertices(0)).toEqual([]);
    expect(createArenaLipShelfTriangleVertices(Number.NaN)).toEqual([]);
  });

  test('adds launch pitch without exceeding the authored safety bound', () => {
    expect(resolveStageCameraPitchDegrees(22, 3, false)).toBe(22);
    expect(resolveStageCameraPitchDegrees(22, 3, true)).toBe(25);
    expect(resolveStageCameraPitchDegrees(27, 8, true)).toBe(MAX_STAGE_CAMERA_PITCH_DEGREES);
    expect(resolveStageCameraPitchDegrees(Number.NaN, Number.NaN, true)).toBe(0);
  });

  test('converts pitch into a bounded camera offset without moving simulation coordinates', () => {
    expect(resolveStageCameraYOffset(100, 0)).toBeCloseTo(0, 8);
    expect(resolveStageCameraYOffset(100, 22)).toBeCloseTo(-40.4026, 3);
    expect(resolveStageCameraYOffset(-10, 22)).toBeCloseTo(0, 8);
  });

  test('keeps layer drift deterministic and centered on the authored depth', () => {
    const first = resolveWormholeLayerDepth({
      baseDepth: -46,
      layerIndex: 3,
      gameTime: 12.5,
      effectSpeed: 0.9,
      depthTravel: 4.5,
    });
    const second = resolveWormholeLayerDepth({
      baseDepth: -46,
      layerIndex: 3,
      gameTime: 12.5,
      effectSpeed: 0.9,
      depthTravel: 4.5,
    });
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(-47.9);
    expect(first).toBeLessThanOrEqual(-44.1);
  });

  test('preserves an authored zero core opacity through runtime pulsing', () => {
    expect(resolveWormholeCoreOpacity(0.94, 0, 4.25)).toBe(0);
    expect(resolveWormholeCoreOpacity(1, 0.14, 0)).toBeCloseTo(0.14);
    expect(resolveWormholeCoreOpacity(2, 2, Number.NaN)).toBe(1);
  });

  test('wraps particles through the tunnel and accelerates travel during launch', () => {
    const normal = resolveWormholeParticleDepth({
      baseDepth: -90,
      gameTime: 3,
      effectSpeed: 1,
      depthTravel: 4,
      launchActive: false,
    });
    const launch = resolveWormholeParticleDepth({
      baseDepth: -90,
      gameTime: 3,
      effectSpeed: 1,
      depthTravel: 4,
      launchActive: true,
    });
    expect(normal).toBe(-78);
    expect(launch).toBe(-69);
    for (const depth of [normal, launch]) {
      expect(depth).toBeGreaterThanOrEqual(WORMHOLE_FAR_DEPTH);
      expect(depth).toBeLessThanOrEqual(WORMHOLE_NEAR_DEPTH);
    }
  });
});
