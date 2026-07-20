interface MutableCameraTrack {
  set(x: number, y: number): unknown;
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
