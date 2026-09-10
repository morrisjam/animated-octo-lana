import { ARENA_RADIUS, ARENA_WRAP_RADIUS } from '../sim/constants';

interface MutableCameraTrack {
  set(x: number, y: number): unknown;
}

export interface CameraFighterPosition {
  x: number;
  y: number;
}

// Fit a conservative character volume, not just the simulation point. The
// vertical inset also leaves room for the fuel HUD and bottom controls.
export function fitCombatCameraDistance(options: {
  players: readonly CameraFighterPosition[];
  center: CameraFighterPosition;
  pitchDegrees: number;
  verticalFovDegrees: number;
  aspect: number;
  minDistance: number;
  horizontalInset?: number;
  verticalInset?: number;
}): number {
  const pitch = options.pitchDegrees * Math.PI / 180;
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const verticalSlope = Math.tan(options.verticalFovDegrees * Math.PI / 360) * (options.verticalInset ?? 0.66);
  const horizontalSlope = Math.tan(options.verticalFovDegrees * Math.PI / 360)
    * Math.max(0.1, options.aspect) * (options.horizontalInset ?? 0.84);
  let distance = options.minDistance;
  for (const player of options.players) {
    for (const xOffset of [-5, 5]) {
      for (const yOffset of [-5, 5]) {
        for (const z of [-5, 9]) {
          const x = player.x + xOffset - options.center.x;
          const y = player.y + yOffset - options.center.y;
          const forwardOffset = y * sin - z * cos;
          distance = Math.max(distance,
            Math.abs(x) / horizontalSlope - forwardOffset,
            Math.abs(y * cos + z * sin) / verticalSlope - forwardOffset);
        }
      }
    }
  }
  return distance;
}

export function cameraDampingAlpha(deltaSeconds: number, rate = 8): number {
  return 1 - Math.exp(-Math.max(0, deltaSeconds) * rate);
}

export interface CameraZoomState {
  distance: number;
  heldDistance: number;
  holdSeconds: number;
}

// Keep a wide shot through a wrap/re-engagement instead of chasing every
// separation change. The outer safety frame still wins over cosmetic easing.
export function advanceCameraZoom(
  previous: CameraZoomState | null,
  desiredDistance: number,
  safetyDistance: number,
  deltaSeconds: number,
): CameraZoomState {
  if (!previous) {
    const distance = Math.max(desiredDistance, safetyDistance);
    return { distance, heldDistance: distance, holdSeconds: 0.65 };
  }
  const dt = Math.max(0, Math.min(0.1, deltaSeconds));
  let holdSeconds = Math.max(0, previous.holdSeconds - dt);
  let heldDistance = previous.heldDistance;
  if (desiredDistance >= heldDistance * 0.98) {
    heldDistance = Math.max(desiredDistance, heldDistance);
    holdSeconds = 0.65;
  } else if (holdSeconds === 0) {
    heldDistance = desiredDistance;
  }
  const target = Math.max(desiredDistance, heldDistance);
  const rate = target > previous.distance ? 7 : 1.8;
  const eased = previous.distance + (target - previous.distance) * cameraDampingAlpha(dt, rate);
  // Limit apparent scale change, rather than world units, across wide and
  // portrait views. Emergency containment remains the only exception.
  const paced = Math.min(previous.distance * Math.exp(2.4 * dt),
    Math.max(previous.distance * Math.exp(-1.2 * dt), eased));
  const distance = Math.max(safetyDistance, paced);
  // A safety pullback must also get the same settling time as a predicted one.
  if (safetyDistance > heldDistance) {
    heldDistance = safetyDistance;
    holdSeconds = 0.65;
  }
  return { distance, heldDistance, holdSeconds };
}

export interface CameraBoundaryForecast {
  destination: CameraFighterPosition;
  weight: number;
}

export function forecastCameraBoundary(
  position: CameraFighterPosition,
  previous: CameraFighterPosition,
  deltaSeconds: number,
  canWrap: boolean,
): CameraBoundaryForecast | null {
  if (!canWrap || deltaSeconds <= 0 || deltaSeconds > 0.1) return null;
  const dx = position.x - previous.x;
  const dy = position.y - previous.y;
  // A world-coordinate teleport is not a velocity sample.
  if (Math.hypot(dx, dy) > ARENA_RADIUS) return null;
  const vx = dx / deltaSeconds;
  const vy = dy / deltaSeconds;
  const speedSquared = vx * vx + vy * vy;
  const radialSpeed = position.x * vx + position.y * vy;
  if (speedSquared < 1 || radialSpeed <= 0) return null;
  const remaining = ARENA_WRAP_RADIUS ** 2 - position.x ** 2 - position.y ** 2;
  const secondsToEdge = Math.max(0,
    (-radialSpeed + Math.sqrt(Math.max(0, radialSpeed ** 2 + speedSquared * remaining))) / speedSquared);
  const horizonSeconds = 1;
  if (secondsToEdge > horizonSeconds) return null;
  const edgeX = position.x + vx * secondsToEdge;
  const edgeY = position.y + vy * secondsToEdge;
  const scale = -(ARENA_RADIUS - 1) / Math.max(1, Math.hypot(edgeX, edgeY));
  const progress = 1 - secondsToEdge / horizonSeconds;
  return {
    destination: { x: edgeX * scale, y: edgeY * scale },
    weight: progress * progress * (3 - 2 * progress),
  };
}

// The arena is fixed at the simulation origin, so camera framing must use the
// fighter's real post-wrap coordinate rather than a toroidal visual alias.
export function syncCameraTrackToWorld(
  track: MutableCameraTrack,
  actualX: number,
  actualY: number,
): void {
  track.set(actualX, actualY);
}
