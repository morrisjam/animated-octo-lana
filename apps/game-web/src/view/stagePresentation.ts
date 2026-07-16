export const MAX_STAGE_CAMERA_PITCH_DEGREES = 28;
export const WORMHOLE_NEAR_DEPTH = -14;
export const WORMHOLE_FAR_DEPTH = -198;
export const ARENA_GUIDE_DEPTH = 0.24;

export interface ArenaGuidePoint {
  x: number;
  y: number;
  z: number;
}

export interface ArenaLipShelfVertex extends ArenaGuidePoint {
  band: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function arenaPoint(
  radius: number,
  angle: number,
  depth = ARENA_GUIDE_DEPTH,
): ArenaGuidePoint {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: depth,
  };
}

export function createArenaGuideSegmentPoints(arenaRadius: number): ArenaGuidePoint[] {
  const radius = Math.max(0, finiteOr(arenaRadius, 0));
  if (radius === 0) {
    return [];
  }

  const points: ArenaGuidePoint[] = [];
  const outerTickCount = 64;
  for (let index = 0; index < outerTickCount; index += 1) {
    const angle = (index / outerTickCount) * Math.PI * 2;
    const majorTick = index % 8 === 0;
    points.push(
      arenaPoint(radius * (majorTick ? 0.925 : 0.958), angle),
      arenaPoint(radius * (majorTick ? 1.045 : 1.025), angle),
    );
  }

  // Broken, slightly irregular contours make camera pitch legible without drawing a flat perfect circle.
  const contourRadii = [0.42, 0.62, 0.82];
  const contourSegmentCount = 96;
  contourRadii.forEach((radiusScale, contourIndex) => {
    for (let segment = 0; segment < contourSegmentCount; segment += 1) {
      if ((segment + contourIndex * 5) % 16 >= 10) {
        continue;
      }
      const angleStart = (segment / contourSegmentCount) * Math.PI * 2;
      const angleEnd = ((segment + 1) / contourSegmentCount) * Math.PI * 2;
      const startRadius = radius * radiusScale * (
        1 + Math.sin(angleStart * 3 + contourIndex * 1.7) * 0.008
      );
      const endRadius = radius * radiusScale * (
        1 + Math.sin(angleEnd * 3 + contourIndex * 1.7) * 0.008
      );
      points.push(
        arenaPoint(startRadius, angleStart),
        arenaPoint(endRadius, angleEnd),
      );
    }
  });

  const railRanges: ReadonlyArray<readonly [number, number]> = [
    [0.32, 0.43],
    [0.5, 0.6],
    [0.68, 0.78],
    [0.86, 0.94],
  ];
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + (index % 2 === 0 ? -0.012 : 0.012);
    for (const [innerScale, outerScale] of railRanges) {
      points.push(
        arenaPoint(radius * innerScale, angle),
        arenaPoint(radius * outerScale, angle),
      );
    }
  }

  return points;
}

export function createArenaLipSegmentPoints(arenaRadius: number): ArenaGuidePoint[] {
  const radius = Math.max(0, finiteOr(arenaRadius, 0));
  if (radius === 0) {
    return [];
  }

  const points: ArenaGuidePoint[] = [];
  const contourScales = [0.945, 0.985, 1.025];
  const segmentCount = 144;
  contourScales.forEach((radiusScale, contourIndex) => {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angleStart = (segment / segmentCount) * Math.PI * 2;
      const angleEnd = ((segment + 1) / segmentCount) * Math.PI * 2;
      const angleMid = (angleStart + angleEnd) * 0.5;
      const nearEdge = 0.5 - Math.sin(angleMid) * 0.5;
      const clusterPosition = (segment + contourIndex * 2) % 32;
      const visibleSegments = nearEdge > 0.64 ? 21 : nearEdge > 0.28 ? 15 : 9;
      if (clusterPosition >= visibleSegments) {
        continue;
      }

      const startRadius = radius * radiusScale * (
        1
        + Math.sin(angleStart * 3 + contourIndex * 1.35) * 0.007
        + Math.sin(angleStart * 7 - contourIndex * 0.8) * 0.003
      );
      const endRadius = radius * radiusScale * (
        1
        + Math.sin(angleEnd * 3 + contourIndex * 1.35) * 0.007
        + Math.sin(angleEnd * 7 - contourIndex * 0.8) * 0.003
      );
      points.push(
        arenaPoint(startRadius, angleStart),
        arenaPoint(endRadius, angleEnd),
      );
    }
  });

  // Short near-edge braces imply thickness without closing the lip into a perfect ring.
  for (let index = 0; index < 11; index += 1) {
    const angle = Math.PI * (1.08 + index * 0.084);
    points.push(
      arenaPoint(radius * 0.932, angle),
      arenaPoint(radius * 1.038, angle),
    );
  }

  return points;
}

export function createArenaLipDepthSegmentPoints(arenaRadius: number): ArenaGuidePoint[] {
  const radius = Math.max(0, finiteOr(arenaRadius, 0));
  if (radius === 0) {
    return [];
  }

  const points: ArenaGuidePoint[] = [];
  const contourLayers = [
    { radiusScale: 1.012, depth: -1.1, visibleRun: 12 },
    { radiusScale: 0.982, depth: -2.8, visibleRun: 10 },
    { radiusScale: 0.948, depth: -4.8, visibleRun: 8 },
  ] as const;
  const segmentCount = 84;

  contourLayers.forEach((layer, layerIndex) => {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const clusterPosition = (segment + layerIndex * 5) % 19;
      if (clusterPosition >= layer.visibleRun) {
        continue;
      }

      // Only the camera-facing half receives an underside contour. Leaving the far edge open
      // keeps the arena from resolving into another perfect neon ring.
      const angleStart = Math.PI * (1.035 + (segment / segmentCount) * 0.93);
      const angleEnd = Math.PI * (1.035 + ((segment + 1) / segmentCount) * 0.93);
      const startRadius = radius * layer.radiusScale * (
        1 + Math.sin(angleStart * 4.0 + layerIndex * 1.7) * 0.006
      );
      const endRadius = radius * layer.radiusScale * (
        1 + Math.sin(angleEnd * 4.0 + layerIndex * 1.7) * 0.006
      );
      points.push(
        arenaPoint(startRadius, angleStart, layer.depth + Math.sin(angleStart * 3.0) * 0.12),
        arenaPoint(endRadius, angleEnd, layer.depth + Math.sin(angleEnd * 3.0) * 0.12),
      );
    }
  });

  // Split braces expose the shelf's taper without creating a solid wall beneath the fighters.
  for (let index = 0; index < 13; index += 1) {
    const angle = Math.PI * (1.105 + index * 0.064);
    const topRadius = radius * (1.012 + Math.sin(index * 1.9) * 0.004);
    const bottomRadius = radius * (0.948 + Math.cos(index * 1.3) * 0.005);
    points.push(
      arenaPoint(topRadius, angle, -0.38),
      arenaPoint(radius * 0.987, angle, -1.72),
      arenaPoint(radius * 0.973, angle, -2.34),
      arenaPoint(bottomRadius, angle, -4.68),
    );
  }

  return points;
}

export function createArenaLipShelfTriangleVertices(arenaRadius: number): ArenaLipShelfVertex[] {
  const radius = Math.max(0, finiteOr(arenaRadius, 0));
  if (radius === 0) {
    return [];
  }

  const vertices: ArenaLipShelfVertex[] = [];
  const segmentCount = 72;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    if ((segment + 3) % 17 >= 12) {
      continue;
    }

    const angleStart = Math.PI * (1.025 + (segment / segmentCount) * 0.95);
    const angleEnd = Math.PI * (1.025 + ((segment + 1) / segmentCount) * 0.95);
    const innerStartRadius = radius * (0.89 + Math.sin(angleStart * 3.0) * 0.009);
    const innerEndRadius = radius * (0.89 + Math.sin(angleEnd * 3.0) * 0.009);
    const outerStartRadius = radius * (1.035 + Math.sin(angleStart * 5.0) * 0.004);
    const outerEndRadius = radius * (1.035 + Math.sin(angleEnd * 5.0) * 0.004);
    const innerStart = {
      ...arenaPoint(innerStartRadius, angleStart, -1.42 + Math.sin(angleStart * 4.0) * 0.12),
      band: 0,
    };
    const innerEnd = {
      ...arenaPoint(innerEndRadius, angleEnd, -1.42 + Math.sin(angleEnd * 4.0) * 0.12),
      band: 0,
    };
    const outerStart = {
      ...arenaPoint(outerStartRadius, angleStart, -0.18 + Math.sin(angleStart * 4.0) * 0.06),
      band: 1,
    };
    const outerEnd = {
      ...arenaPoint(outerEndRadius, angleEnd, -0.18 + Math.sin(angleEnd * 4.0) * 0.06),
      band: 1,
    };
    vertices.push(
      innerStart,
      outerStart,
      outerEnd,
      innerStart,
      outerEnd,
      innerEnd,
    );
  }

  return vertices;
}

export function resolveWormholeCoreOpacity(
  effectOpacity: number,
  coreOpacity: number,
  effectTime: number,
): number {
  const effect = clamp(finiteOr(effectOpacity, 0), 0, 1);
  const core = clamp(finiteOr(coreOpacity, 0), 0, 1);
  const time = Math.max(0, finiteOr(effectTime, 0));
  return effect * core * (1 + Math.abs(Math.sin(time * 1.25)) * 0.36);
}

export function resolveStageCameraPitchDegrees(
  authoredPitchDegrees: number,
  launchPitchBoostDegrees: number,
  launchActive: boolean,
): number {
  const authored = finiteOr(authoredPitchDegrees, 0);
  const launchBoost = launchActive ? Math.max(0, finiteOr(launchPitchBoostDegrees, 0)) : 0;
  return clamp(authored + launchBoost, 0, MAX_STAGE_CAMERA_PITCH_DEGREES);
}

export function resolveStageCameraYOffset(
  cameraDistance: number,
  pitchDegrees: number,
): number {
  const safeDistance = Math.max(0, finiteOr(cameraDistance, 0));
  const safePitch = clamp(
    finiteOr(pitchDegrees, 0),
    0,
    MAX_STAGE_CAMERA_PITCH_DEGREES,
  );
  return -Math.tan((safePitch * Math.PI) / 180) * safeDistance;
}

export function resolveWormholeLayerDepth({
  baseDepth,
  layerIndex,
  gameTime,
  effectSpeed,
  depthTravel,
}: {
  baseDepth: number;
  layerIndex: number;
  gameTime: number;
  effectSpeed: number;
  depthTravel: number;
}): number {
  const safeBaseDepth = finiteOr(baseDepth, WORMHOLE_NEAR_DEPTH);
  const time = Math.max(0, finiteOr(gameTime, 0));
  const speed = Math.max(0, finiteOr(effectSpeed, 0));
  const travel = Math.max(0, finiteOr(depthTravel, 0));
  const phase = Math.max(0, finiteOr(layerIndex, 0)) * 0.73;
  return safeBaseDepth + Math.sin(time * speed * 0.22 + phase) * travel * 0.42;
}

export function resolveWormholeParticleDepth({
  baseDepth,
  gameTime,
  effectSpeed,
  depthTravel,
  launchActive,
}: {
  baseDepth: number;
  gameTime: number;
  effectSpeed: number;
  depthTravel: number;
  launchActive: boolean;
}): number {
  const nearDepth = WORMHOLE_NEAR_DEPTH;
  const farDepth = WORMHOLE_FAR_DEPTH;
  const depthSpan = nearDepth - farDepth;
  const clampedBaseDepth = clamp(finiteOr(baseDepth, farDepth), farDepth, nearDepth);
  const baseOffset = nearDepth - clampedBaseDepth;
  const time = Math.max(0, finiteOr(gameTime, 0));
  const speed = Math.max(0, finiteOr(effectSpeed, 0));
  const travel = Math.max(0, finiteOr(depthTravel, 0));
  const launchMultiplier = launchActive ? 1.75 : 1;
  const currentOffset = positiveModulo(
    baseOffset - time * speed * travel * launchMultiplier,
    depthSpan,
  );
  return nearDepth - currentOffset;
}
