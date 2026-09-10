import * as THREE from 'three';
import type { VfxFlashPreset } from './types';

export function createReadabilityFlashGeometry(preset: VfxFlashPreset): THREE.BufferGeometry {
  const { radius: r, thickness: t, shape = 'ring' } = preset;
  if (shape === 'ring' || shape === 'arc') {
    return new THREE.RingGeometry(Math.max(0.05, r - t), r + t, 36, 1,
      shape === 'arc' ? -Math.PI / 3 : 0, shape === 'arc' ? Math.PI * 2 / 3 : Math.PI * 2);
  }
  const vertices: number[] = [];
  const segment = (x1: number, y1: number, x2: number, y2: number): void => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const nx = -(y2 - y1) / length * t;
    const ny = (x2 - x1) / length * t;
    vertices.push(
      x1 - nx, y1 - ny, 0, x2 - nx, y2 - ny, 0, x2 + nx, y2 + ny, 0,
      x1 - nx, y1 - ny, 0, x2 + nx, y2 + ny, 0, x1 + nx, y1 + ny, 0,
    );
  };
  if (shape === 'chevron') {
    segment(r * 0.55, r * 0.55, r, 0);
    segment(r, 0, r * 0.55, -r * 0.55);
  } else if (shape === 'brackets') {
    for (const side of [-1, 1]) {
      segment(side * r, -r * 0.55, side * r, r * 0.55);
      segment(side * r, r * 0.55, side * r * 0.7, r * 0.55);
      segment(side * r, -r * 0.55, side * r * 0.7, -r * 0.55);
    }
  } else if (shape === 'diamond') {
    segment(r, 0, 0, r);
    segment(0, r, -r, 0);
    segment(-r, 0, 0, -r);
    segment(0, -r, r, 0);
  } else if (shape === 'ticks') {
    segment(-r, -r * 0.25, -r, r * 0.25);
    segment(r, -r * 0.25, r, r * 0.25);
  } else if (shape === 'broken_ring') {
    for (let arc = 0; arc < 4; arc += 1) {
      for (let part = 0; part < 6; part += 1) {
        const a = arc * Math.PI / 2 + Math.PI / 8 + part * Math.PI / 24;
        const b = a + Math.PI / 24;
        segment(Math.cos(a) * r, Math.sin(a) * r, Math.cos(b) * r, Math.sin(b) * r);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}
