import { describe, expect, test } from 'vitest';
import { syncCameraTrackToWorld } from './cameraTracking';

function createTrack(x: number, y: number) {
  return {
    x,
    y,
    set(nextX: number, nextY: number): void {
      this.x = nextX;
      this.y = nextY;
    },
  };
}

describe('camera tracking', () => {
  test.each([
    [{ x: 75, y: 0 }, { x: -71, y: 0 }],
    [{ x: 53, y: 53 }, { x: -50.2, y: -50.2 }],
  ])('rebases a boundary warp from $0 to its fixed-world position', (previous, actual) => {
    const track = createTrack(previous.x, previous.y);

    syncCameraTrackToWorld(track, actual.x, actual.y);

    expect(track).toMatchObject(actual);
  });

  test('continues to follow ordinary movement exactly', () => {
    const track = createTrack(-12, 6);

    syncCameraTrackToWorld(track, -10.5, 7.25);

    expect(track).toMatchObject({ x: -10.5, y: 7.25 });
  });
});
