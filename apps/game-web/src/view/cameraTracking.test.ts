import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { cameraDampingAlpha, fitCombatCameraDistance, syncCameraTrackToWorld } from './cameraTracking';

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

describe('combat camera containment', () => {
  test.each([0, 18, 30, 34])('fits fighter volumes at %s degrees, including edges and portrait screens', (pitchDegrees) => {
    const encounters = [
      [{ x: 65, y: 0 }, { x: 58, y: 0 }],
      [{ x: 0, y: 65 }, { x: 7, y: 59 }],
      [{ x: 0, y: -65 }, { x: 7, y: -59 }],
      [{ x: -65, y: 0 }, { x: -58, y: 0 }],
      [{ x: 0, y: -65 }, { x: 0, y: 65 }],
      [{ x: -72, y: 0 }, { x: 72, y: 0 }],
    ];
    for (const aspect of [0.45, 1, 1.6, 2.4]) {
      for (const players of encounters) {
        // An origin-centered target also covers camera lag after an edge warp.
        for (const center of [{ x: 0, y: 0 }, {
          x: (players[0].x + players[1].x) / 2,
          y: (players[0].y + players[1].y) / 2 - 3.4,
        }]) {
          const distance = fitCombatCameraDistance({ players, center, aspect,
            verticalFovDegrees: 52, pitchDegrees, minDistance: 52 });
          const pitch = pitchDegrees * Math.PI / 180;
          const camera = new THREE.PerspectiveCamera(52, aspect, 0.1, distance + 400);
          camera.position.set(center.x, center.y - Math.sin(pitch) * distance, Math.cos(pitch) * distance);
          camera.lookAt(center.x, center.y, 0);
          camera.updateMatrixWorld();
          for (const player of players) {
            for (const dx of [-5, 5]) for (const dy of [-5, 5]) for (const z of [-5, 9]) {
              const point = new THREE.Vector3(player.x + dx, player.y + dy, z).project(camera);
              expect(Math.abs(point.x)).toBeLessThanOrEqual(0.840001);
              expect(Math.abs(point.y)).toBeLessThanOrEqual(0.660001);
              expect(Math.abs(point.z)).toBeLessThan(1);
            }
          }
        }
      }
    }
  });

  test('damping is independent of display refresh rate', () => {
    const advance = (fps: number) => {
      let value = 0;
      for (let frame = 0; frame < fps; frame += 1) value += (100 - value) * cameraDampingAlpha(1 / fps);
      return value;
    };
    expect(advance(30)).toBeCloseTo(advance(144), 10);
    expect(cameraDampingAlpha(0)).toBe(0);
  });
});
