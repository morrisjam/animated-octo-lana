import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import {
  advanceCameraZoom, cameraDampingAlpha, fitCombatCameraDistance,
  forecastCameraBoundary, syncCameraTrackToWorld,
} from './cameraTracking';
import { createInitialState, getRenderSnapshot } from '../sim/sim';
import { updateCamera, type CombatCameraContext } from './render';

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

describe('camera transition pacing', () => {
  test('holds a wide shot before easing in rather than bouncing after a wrap', () => {
    let zoom = advanceCameraZoom(null, 180, 150, 0);
    for (let i = 0; i < 30; i += 1) zoom = advanceCameraZoom(zoom, 60, 52, 1 / 60);
    expect(zoom.distance).toBe(180);
    for (let i = 0; i < 60; i += 1) {
      const previous = zoom.distance;
      zoom = advanceCameraZoom(zoom, 60, 52, 1 / 60);
      expect(zoom.distance).toBeLessThanOrEqual(previous);
      expect(previous - zoom.distance).toBeLessThan(4);
    }
    expect(zoom.distance).toBeGreaterThan(60);
    expect(zoom.distance).toBeLessThan(90);
  });

  test('eases expansion but never violates the safety frame', () => {
    const initial = advanceCameraZoom(null, 60, 52, 0);
    const eased = advanceCameraZoom(initial, 120, 55, 1 / 60);
    expect(eased.distance).toBeGreaterThan(60);
    expect(eased.distance).toBeLessThan(70);
    const emergency = advanceCameraZoom(eased, 200, 160, 1 / 60);
    expect(emergency.distance).toBe(160);
    expect(advanceCameraZoom(emergency, 60, 52, 1 / 60).distance).toBeGreaterThanOrEqual(160);
    expect(advanceCameraZoom(null, 60, 52, 0).distance).toBe(60);
  });

  test('anticipates outward travel only, with a gradual lead-in and no false velocity after wrap', () => {
    const early = forecastCameraBoundary({ x: 20, y: 0 }, { x: 19, y: 0 }, 1 / 60, true)!;
    const late = forecastCameraBoundary({ x: 74, y: 0 }, { x: 73, y: 0 }, 1 / 60, true)!;
    expect(early.destination).toEqual({ x: -71, y: -0 });
    expect(early.weight).toBeLessThan(0.1);
    expect(late.weight).toBeGreaterThan(0.99);
    expect(forecastCameraBoundary({ x: 60, y: 0 }, { x: 61, y: 0 }, 1 / 60, true)).toBeNull();
    expect(forecastCameraBoundary({ x: 60, y: 0 }, { x: 59, y: 0 }, 1 / 60, false)).toBeNull();
    expect(forecastCameraBoundary({ x: -71, y: 0 }, { x: 76, y: 0 }, 1 / 60, true)).toBeNull();
    expect(forecastCameraBoundary({ x: 60, y: 0 }, { x: 59, y: 0 }, 0, true)).toBeNull();
  });

  test.each([30, 60, 144])('smooths a real boundary jump and retains fighter visibility at %s fps', (fps) => {
    for (const aspect of [0.5, 1.6]) for (const angle of [0, Math.PI / 2, -Math.PI / 4]) {
      const positionAt = (radius: number) => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      const snapshot = getRenderSnapshot(createInitialState());
      snapshot.players.P1.pos = positionAt(24);
      snapshot.players.P2.pos = positionAt(28);
      snapshot.players.P2.helpless = 2;
      const context: CombatCameraContext = {
        camera: new THREE.PerspectiveCamera(52, aspect, 0.1, 500),
        cameraTarget: new THREE.Vector3(), lookAtTarget: new THREE.Vector3(),
        cameraPlayerTracks: { P1: new THREE.Vector2(), P2: new THREE.Vector2() },
        launchCameraActive: false, cameraZoomState: null, cameraRenderedPitchDegrees: 18,
        cameraPitchDegrees: 18, cameraLaunchPitchBoostDegrees: 5, cameraLookAtYOffset: 2.2,
      };
      updateCamera(context, snapshot, 0, true);
      let distanceBeforeWrap = 0;
      let wrapped = false;
      for (let frame = 1; frame <= fps * 2; frame += 1) {
        const x = 28 + frame * 60 / fps;
        const justWrapped = !wrapped && x > 76;
        if (justWrapped) distanceBeforeWrap = context.cameraZoomState!.distance;
        wrapped ||= justWrapped;
        snapshot.players.P2.pos = positionAt(wrapped ? -71 + (x - 76) : x);
        const previousDistance = context.cameraZoomState!.distance;
        updateCamera(context, snapshot, 1 / fps, false);
        if (justWrapped) {
          expect(context.cameraZoomState!.distance / distanceBeforeWrap).toBeLessThan(1.06);
        }
        if (wrapped && x < 100) {
          expect(context.cameraZoomState!.distance).toBeGreaterThanOrEqual(distanceBeforeWrap * 0.98);
        }
        expect(context.cameraZoomState!.distance).toBeGreaterThan(0);
        expect(Math.abs(context.cameraZoomState!.distance - previousDistance) / previousDistance,
          `aspect=${aspect} angle=${angle} frame=${frame} x=${x}`).toBeLessThan(0.1);
        context.camera.updateMatrixWorld();
        for (const player of Object.values(snapshot.players)) {
          for (const dx of [-5, 5]) for (const dy of [-5, 5]) for (const z of [-5, 9]) {
            const point = new THREE.Vector3(player.pos.x + dx, player.pos.y + dy, z).project(context.camera);
            expect(Math.abs(point.x)).toBeLessThanOrEqual(0.940001);
            expect(Math.abs(point.y)).toBeLessThanOrEqual(0.840001);
          }
        }
      }
      const previousPitch = context.cameraRenderedPitchDegrees;
      snapshot.players.P2.helpless = 0;
      updateCamera(context, snapshot, 1 / fps, false);
      expect(context.cameraRenderedPitchDegrees).toBeLessThan(previousPitch);
      expect(context.cameraRenderedPitchDegrees).toBeGreaterThan(18);
      updateCamera(context, snapshot, 0, true);
      expect(context.cameraRenderedPitchDegrees).toBe(18);
      expect(context.cameraZoomState!.holdSeconds).toBe(0.65);
    }
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
