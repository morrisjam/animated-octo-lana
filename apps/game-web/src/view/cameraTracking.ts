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
}): number {
  const pitch = options.pitchDegrees * Math.PI / 180;
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const verticalSlope = Math.tan(options.verticalFovDegrees * Math.PI / 360) * 0.66;
  const horizontalSlope = Math.tan(options.verticalFovDegrees * Math.PI / 360)
    * Math.max(0.1, options.aspect) * 0.84;
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

// The arena is fixed at the simulation origin, so camera framing must use the
// fighter's real post-wrap coordinate rather than a toroidal visual alias.
export function syncCameraTrackToWorld(
  track: MutableCameraTrack,
  actualX: number,
  actualY: number,
): void {
  track.set(actualX, actualY);
}
