import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

// Plan 1.3 F.6 — sweep a thin 2D cross-section along a 3D spine so a curved
// form (hooked blade, handle) reads correctly from EVERY camera angle, not just
// the reference angle a flat extrude happens to match. Uses ExtrudeGeometry's
// native extrudePath; bevelEnabled: false keeps sharp tips (same rule as F.5).
function buildCurveSweepGeometry(
  sweep: { spine: [number, number, number][]; crossSection: { points: [number, number][] }; closed?: boolean },
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const cs = sweep.crossSection.points;
  if (cs.length > 0) {
    shape.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);
    shape.closePath();
  }
  const spine = sweep.spine.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const path = new THREE.CatmullRomCurve3(spine, sweep.closed ?? false);
  return new THREE.ExtrudeGeometry(shape, {
    extrudePath: path,
    steps: Math.max(24, spine.length * 8),
    bevelEnabled: false,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F'),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: Math.max(1, readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: Math.max(1, readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clamp01(readLayerNumber(spec.specularIntensity, ['base'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Gravity Well Arena Rim V1
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createGravityWellArenaRimV1Model(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Gravity Well Arena Rim V1";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Invisible Semantic Node", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000"], "samplingNotes": "Palette sampled from the isolated arena-rim concept; no lighting is baked into runtime albedo."}, "colorVariation": {"palette": ["#000000", "#000000"], "pattern": "low-amplitude directional", "amplitude": 0.07, "heightCorrelation": 0.08}, "textureResolution": 1024, "textureProjection": {"mode": "object-space", "repeat": [2, 2], "anisotropy": 4, "texelDensityIntent": "Stable medium-scale detail with no visible tiling at gameplay distance."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.08, "role": "broad value separation"}, {"id": "meso", "frequency": 8, "amplitude": 0.04, "role": "subtle plate finish variation"}, {"id": "micro", "frequency": 42, "amplitude": 0.015, "role": "grazing highlight breakup only"}], "roughness": {"base": 1, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower on bevels"}, "metalness": {"base": 0, "variation": 0.03}, "normal": {"pattern": "independent subtle brushed field", "strength": 0.16, "scale": 28, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.32, "notes": "Darken true joins and stacked recesses only."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.25, "color": "#03080d"}, "localOverrides": [], "opacity": {"base": 0}, "transparent": true, "emissive": "#000000", "emissiveIntensity": 0, "clearcoat": 0.05, "clearcoatRoughness": 0.55, "shaderNotes": ["Albedo, roughness, normal, and ambient occlusion remain independent.", "Broad geometry and material boundaries provide the visual read; procedural noise stays below gameplay-scale visibility."], "notes": "Single-image source supports approximate material response, not physically exact inverse rendering."},
    options
  );
  materialMap["armor-metal"] = createSculptMaterial(
    "armor-metal",
    {"id": "armor-metal", "name": "Midnight Armor Metal", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#142233", "color": "#142233", "albedo": {"dominant": "#142233", "secondary": ["#293d54"], "samplingNotes": "Palette sampled from the isolated arena-rim concept; no lighting is baked into runtime albedo."}, "colorVariation": {"palette": ["#142233", "#293d54"], "pattern": "low-amplitude directional", "amplitude": 0.07, "heightCorrelation": 0.08}, "textureResolution": 1024, "textureProjection": {"mode": "object-space", "repeat": [2, 2], "anisotropy": 4, "texelDensityIntent": "Stable medium-scale detail with no visible tiling at gameplay distance."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.08, "role": "broad value separation"}, {"id": "meso", "frequency": 8, "amplitude": 0.04, "role": "subtle plate finish variation"}, {"id": "micro", "frequency": 42, "amplitude": 0.015, "role": "grazing highlight breakup only"}], "roughness": {"base": 0.44, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower on bevels"}, "metalness": {"base": 0.78, "variation": 0.03}, "normal": {"pattern": "independent subtle brushed field", "strength": 0.16, "scale": 28, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.32, "notes": "Darken true joins and stacked recesses only."}, "wear": {"edgeWear": 0.12, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.25, "color": "#03080d"}, "localOverrides": [{"id": "edge-wear-response", "region": "top-facing bevels", "roughness": 0.26, "color": "#365776", "geometryEffect": "none", "evidenceRefs": ["full-object"]}], "opacity": {"base": 1}, "transparent": false, "emissive": "#000000", "emissiveIntensity": 0, "clearcoat": 0.05, "clearcoatRoughness": 0.55, "shaderNotes": ["Albedo, roughness, normal, and ambient occlusion remain independent.", "Broad geometry and material boundaries provide the visual read; procedural noise stays below gameplay-scale visibility."], "notes": "Single-image source supports approximate material response, not physically exact inverse rendering."},
    options
  );
  materialMap["support-metal"] = createSculptMaterial(
    "support-metal",
    {"id": "support-metal", "name": "Recessed Support Metal", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#07111c", "color": "#07111c", "albedo": {"dominant": "#07111c", "secondary": ["#102231"], "samplingNotes": "Palette sampled from the isolated arena-rim concept; no lighting is baked into runtime albedo."}, "colorVariation": {"palette": ["#07111c", "#102231"], "pattern": "low-amplitude directional", "amplitude": 0.07, "heightCorrelation": 0.08}, "textureResolution": 1024, "textureProjection": {"mode": "object-space", "repeat": [2, 2], "anisotropy": 4, "texelDensityIntent": "Stable medium-scale detail with no visible tiling at gameplay distance."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.08, "role": "broad value separation"}, {"id": "meso", "frequency": 8, "amplitude": 0.04, "role": "subtle plate finish variation"}, {"id": "micro", "frequency": 42, "amplitude": 0.015, "role": "grazing highlight breakup only"}], "roughness": {"base": 0.68, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower on bevels"}, "metalness": {"base": 0.58, "variation": 0.03}, "normal": {"pattern": "independent subtle brushed field", "strength": 0.16, "scale": 28, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.32, "notes": "Darken true joins and stacked recesses only."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0.08, "cavityBias": 0.75, "color": "#03080d"}, "localOverrides": [], "opacity": {"base": 1}, "transparent": false, "emissive": "#000000", "emissiveIntensity": 0, "clearcoat": 0.05, "clearcoatRoughness": 0.55, "shaderNotes": ["Albedo, roughness, normal, and ambient occlusion remain independent.", "Broad geometry and material boundaries provide the visual read; procedural noise stays below gameplay-scale visibility."], "notes": "Single-image source supports approximate material response, not physically exact inverse rendering."},
    options
  );
  materialMap["emissive-cyan"] = createSculptMaterial(
    "emissive-cyan",
    {"id": "emissive-cyan", "name": "Cyan Energy Inlay", "type": "physical-emissive", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#25daff", "color": "#25daff", "albedo": {"dominant": "#25daff", "secondary": ["#75efff"], "samplingNotes": "Palette sampled from the isolated arena-rim concept; no lighting is baked into runtime albedo."}, "colorVariation": {"palette": ["#25daff", "#75efff"], "pattern": "flat", "amplitude": 0.02, "heightCorrelation": 0.08}, "textureResolution": 1024, "textureProjection": {"mode": "object-space", "repeat": [2, 2], "anisotropy": 4, "texelDensityIntent": "Stable medium-scale detail with no visible tiling at gameplay distance."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.01, "role": "broad value separation"}, {"id": "meso", "frequency": 8, "amplitude": 0.01, "role": "subtle plate finish variation"}, {"id": "micro", "frequency": 42, "amplitude": 0.005, "role": "grazing highlight breakup only"}], "roughness": {"base": 0.2, "variation": 0.02, "map": "independent-procedural-field", "localResponse": "low roughness energy inlay"}, "metalness": {"base": 0.05, "variation": 0.03}, "normal": {"pattern": "none", "strength": 0, "scale": 28, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0, "contactShadowBias": 0.32, "notes": "Darken true joins and stacked recesses only."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.25, "color": "#03080d"}, "localOverrides": [{"id": "arc-channel-layout", "region": "selected outer arcs and inner prongs", "roughness": 0.16, "emissiveIntensity": 0.72, "geometryEffect": "raised inset strip", "evidenceRefs": ["full-object"]}], "opacity": {"base": 1}, "transparent": false, "emissive": "#16c8ff", "emissiveIntensity": 0.72, "clearcoat": 0.16, "clearcoatRoughness": 0.18, "shaderNotes": ["Albedo, roughness, normal, and ambient occlusion remain independent.", "Broad geometry and material boundaries provide the visual read; procedural noise stays below gameplay-scale visibility."], "notes": "Single-image source supports approximate material response, not physically exact inverse rendering."},
    options
  );
  materialMap["emissive-violet"] = createSculptMaterial(
    "emissive-violet",
    {"id": "emissive-violet", "name": "Violet Energy Accent", "type": "physical-emissive", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#8b69ff", "color": "#8b69ff", "albedo": {"dominant": "#8b69ff", "secondary": ["#bf97ff"], "samplingNotes": "Palette sampled from the isolated arena-rim concept; no lighting is baked into runtime albedo."}, "colorVariation": {"palette": ["#8b69ff", "#bf97ff"], "pattern": "flat", "amplitude": 0.02, "heightCorrelation": 0.08}, "textureResolution": 1024, "textureProjection": {"mode": "object-space", "repeat": [2, 2], "anisotropy": 4, "texelDensityIntent": "Stable medium-scale detail with no visible tiling at gameplay distance."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.5, "amplitude": 0.01, "role": "broad value separation"}, {"id": "meso", "frequency": 8, "amplitude": 0.01, "role": "subtle plate finish variation"}, {"id": "micro", "frequency": 42, "amplitude": 0.005, "role": "grazing highlight breakup only"}], "roughness": {"base": 0.22, "variation": 0.02, "map": "independent-procedural-field", "localResponse": "low roughness energy inlay"}, "metalness": {"base": 0.04, "variation": 0.03}, "normal": {"pattern": "none", "strength": 0, "scale": 28, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0, "contactShadowBias": 0.32, "notes": "Darken true joins and stacked recesses only."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.25, "color": "#03080d"}, "localOverrides": [{"id": "accent-channel-layout", "region": "short asymmetric cap and keystone accents", "roughness": 0.18, "emissiveIntensity": 0.58, "geometryEffect": "raised inset strip", "evidenceRefs": ["full-object"]}], "opacity": {"base": 1}, "transparent": false, "emissive": "#7652ff", "emissiveIntensity": 0.58, "clearcoat": 0.16, "clearcoatRoughness": 0.18, "shaderNotes": ["Albedo, roughness, normal, and ambient occlusion remain independent.", "Broad geometry and material boundaries provide the visual read; procedural noise stays below gameplay-scale visibility."], "notes": "Single-image source supports approximate material response, not physically exact inverse rendering."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Arena Rim Runtime Root__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Arena Rim Runtime Root", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "four-primary-breaks", "description": "Top, left, right, and lower negative-space breaks remain open."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_root_0.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Arena Rim Runtime Root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Arena Rim Runtime Root", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "four-primary-breaks", "description": "Top, left, right, and lower negative-space breaks remain open."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const attachment_outer_arc_segments_1 = null;
  const endpoint_outer_arc_segments_1 = makeAttachmentEndpoint(attachment_outer_arc_segments_1);
  const node_outer_arc_segments_1 = new THREE.Group();
  node_outer_arc_segments_1.name = "Outer Arc Segment System__pivot";
  if (endpoint_outer_arc_segments_1) {
    node_outer_arc_segments_1.position.copy(endpoint_outer_arc_segments_1.start);
    node_outer_arc_segments_1.rotation.set(0, 0, 0);
    node_outer_arc_segments_1.scale.set(1, 1, 1);
  } else {
    node_outer_arc_segments_1.position.set(0.0, 0.0, 0.0);
    node_outer_arc_segments_1.rotation.set(0.0, 0.0, 0.0);
    node_outer_arc_segments_1.scale.set(1.0, 1.0, 1.0);
  }
  node_outer_arc_segments_1.userData.sculptComponent = {"id": "outer-arc-segments", "name": "Outer Arc Segment System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-segments", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "beveled-arc-caps", "description": "Each outer arc terminates with a broad chamfered cap."}, {"id": "panel-seams", "description": "Large slabs receive sparse shallow panel seams."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_segments_1.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-segments", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_outer_arc_segments_1);
  nodes["outer-arc-segments"] = node_outer_arc_segments_1;
  const mesh_outer_arc_segments_1Geometry = endpoint_outer_arc_segments_1
    ? new THREE.CylinderGeometry(endpoint_outer_arc_segments_1.endRadius, endpoint_outer_arc_segments_1.baseRadius, endpoint_outer_arc_segments_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_outer_arc_segments_1 = new THREE.Mesh(
    mesh_outer_arc_segments_1Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_outer_arc_segments_1.name = "Outer Arc Segment System";
  if (endpoint_outer_arc_segments_1) {
    mesh_outer_arc_segments_1.position.copy(endpoint_outer_arc_segments_1.midpoint);
    mesh_outer_arc_segments_1.quaternion.copy(endpoint_outer_arc_segments_1.quaternion);
  }
  mesh_outer_arc_segments_1.castShadow = options.castShadow ?? true;
  mesh_outer_arc_segments_1.receiveShadow = options.receiveShadow ?? true;
  mesh_outer_arc_segments_1.userData.sculptComponent = {"id": "outer-arc-segments", "name": "Outer Arc Segment System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-segments", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "beveled-arc-caps", "description": "Each outer arc terminates with a broad chamfered cap."}, {"id": "panel-seams", "description": "Large slabs receive sparse shallow panel seams."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_segments_1.add(mesh_outer_arc_segments_1);
  meshes["outer-arc-segments"] = mesh_outer_arc_segments_1;
  colliders["outer-arc-segments"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["outer-arc-segments"] ??= [];
  destructionGroups["outer-arc-segments"].push(node_outer_arc_segments_1);

  const attachment_inner_prongs_2 = null;
  const endpoint_inner_prongs_2 = makeAttachmentEndpoint(attachment_inner_prongs_2);
  const node_inner_prongs_2 = new THREE.Group();
  node_inner_prongs_2.name = "Crossing Inner Prong System__pivot";
  if (endpoint_inner_prongs_2) {
    node_inner_prongs_2.position.copy(endpoint_inner_prongs_2.start);
    node_inner_prongs_2.rotation.set(0, 0, 0);
    node_inner_prongs_2.scale.set(1, 1, 1);
  } else {
    node_inner_prongs_2.position.set(0.0, 0.0, 0.0);
    node_inner_prongs_2.rotation.set(0.0, 0.0, 0.0);
    node_inner_prongs_2.scale.set(1.0, 1.0, 1.0);
  }
  node_inner_prongs_2.userData.sculptComponent = {"id": "inner-prongs", "name": "Crossing Inner Prong System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prongs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tapered-crossing-profile", "description": "Paired blades curve inward and cross near the lower center."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_inner_prongs_2.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prongs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_inner_prongs_2);
  nodes["inner-prongs"] = node_inner_prongs_2;
  const mesh_inner_prongs_2Geometry = endpoint_inner_prongs_2
    ? new THREE.CylinderGeometry(endpoint_inner_prongs_2.endRadius, endpoint_inner_prongs_2.baseRadius, endpoint_inner_prongs_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_inner_prongs_2 = new THREE.Mesh(
    mesh_inner_prongs_2Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_inner_prongs_2.name = "Crossing Inner Prong System";
  if (endpoint_inner_prongs_2) {
    mesh_inner_prongs_2.position.copy(endpoint_inner_prongs_2.midpoint);
    mesh_inner_prongs_2.quaternion.copy(endpoint_inner_prongs_2.quaternion);
  }
  mesh_inner_prongs_2.castShadow = options.castShadow ?? true;
  mesh_inner_prongs_2.receiveShadow = options.receiveShadow ?? true;
  mesh_inner_prongs_2.userData.sculptComponent = {"id": "inner-prongs", "name": "Crossing Inner Prong System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prongs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tapered-crossing-profile", "description": "Paired blades curve inward and cross near the lower center."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_inner_prongs_2.add(mesh_inner_prongs_2);
  meshes["inner-prongs"] = mesh_inner_prongs_2;
  colliders["inner-prongs"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["inner-prongs"] ??= [];
  destructionGroups["inner-prongs"].push(node_inner_prongs_2);

  const attachment_crown_gate_3 = null;
  const endpoint_crown_gate_3 = makeAttachmentEndpoint(attachment_crown_gate_3);
  const node_crown_gate_3 = new THREE.Group();
  node_crown_gate_3.name = "Split Crown Gate System__pivot";
  if (endpoint_crown_gate_3) {
    node_crown_gate_3.position.copy(endpoint_crown_gate_3.start);
    node_crown_gate_3.rotation.set(0, 0, 0);
    node_crown_gate_3.scale.set(1, 1, 1);
  } else {
    node_crown_gate_3.position.set(0.0, 0.0, 0.0);
    node_crown_gate_3.rotation.set(0.0, 0.0, 0.0);
    node_crown_gate_3.scale.set(1.0, 1.0, 1.0);
  }
  node_crown_gate_3.userData.sculptComponent = {"id": "crown-gate", "name": "Split Crown Gate System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "split-crown-profile", "description": "Small top gate remains split at top and bottom."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_crown_gate_3.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_crown_gate_3);
  nodes["crown-gate"] = node_crown_gate_3;
  const mesh_crown_gate_3Geometry = endpoint_crown_gate_3
    ? new THREE.CylinderGeometry(endpoint_crown_gate_3.endRadius, endpoint_crown_gate_3.baseRadius, endpoint_crown_gate_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_crown_gate_3 = new THREE.Mesh(
    mesh_crown_gate_3Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_crown_gate_3.name = "Split Crown Gate System";
  if (endpoint_crown_gate_3) {
    mesh_crown_gate_3.position.copy(endpoint_crown_gate_3.midpoint);
    mesh_crown_gate_3.quaternion.copy(endpoint_crown_gate_3.quaternion);
  }
  mesh_crown_gate_3.castShadow = options.castShadow ?? true;
  mesh_crown_gate_3.receiveShadow = options.receiveShadow ?? true;
  mesh_crown_gate_3.userData.sculptComponent = {"id": "crown-gate", "name": "Split Crown Gate System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "split-crown-profile", "description": "Small top gate remains split at top and bottom."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_crown_gate_3.add(mesh_crown_gate_3);
  meshes["crown-gate"] = mesh_crown_gate_3;
  colliders["crown-gate"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["crown-gate"] ??= [];
  destructionGroups["crown-gate"].push(node_crown_gate_3);

  const attachment_lower_keystone_4 = null;
  const endpoint_lower_keystone_4 = makeAttachmentEndpoint(attachment_lower_keystone_4);
  const node_lower_keystone_4 = new THREE.Group();
  node_lower_keystone_4.name = "Forked Lower Keystone System__pivot";
  if (endpoint_lower_keystone_4) {
    node_lower_keystone_4.position.copy(endpoint_lower_keystone_4.start);
    node_lower_keystone_4.rotation.set(0, 0, 0);
    node_lower_keystone_4.scale.set(1, 1, 1);
  } else {
    node_lower_keystone_4.position.set(0.0, 0.0, 0.0);
    node_lower_keystone_4.rotation.set(0.0, 0.0, 0.0);
    node_lower_keystone_4.scale.set(1.0, 1.0, 1.0);
  }
  node_lower_keystone_4.userData.sculptComponent = {"id": "lower-keystone", "name": "Forked Lower Keystone System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "forked-keystone-profile", "description": "Heavy lower landmark retains its central V notch."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lower_keystone_4.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lower_keystone_4);
  nodes["lower-keystone"] = node_lower_keystone_4;
  const mesh_lower_keystone_4Geometry = endpoint_lower_keystone_4
    ? new THREE.CylinderGeometry(endpoint_lower_keystone_4.endRadius, endpoint_lower_keystone_4.baseRadius, endpoint_lower_keystone_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_lower_keystone_4 = new THREE.Mesh(
    mesh_lower_keystone_4Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_keystone_4.name = "Forked Lower Keystone System";
  if (endpoint_lower_keystone_4) {
    mesh_lower_keystone_4.position.copy(endpoint_lower_keystone_4.midpoint);
    mesh_lower_keystone_4.quaternion.copy(endpoint_lower_keystone_4.quaternion);
  }
  mesh_lower_keystone_4.castShadow = options.castShadow ?? true;
  mesh_lower_keystone_4.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_keystone_4.userData.sculptComponent = {"id": "lower-keystone", "name": "Forked Lower Keystone System", "level": "macro", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "forked-keystone-profile", "description": "Heavy lower landmark retains its central V notch."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lower_keystone_4.add(mesh_lower_keystone_4);
  meshes["lower-keystone"] = mesh_lower_keystone_4;
  colliders["lower-keystone"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["lower-keystone"] ??= [];
  destructionGroups["lower-keystone"].push(node_lower_keystone_4);

  const attachment_outer_arc_upper_left_5 = null;
  const endpoint_outer_arc_upper_left_5 = makeAttachmentEndpoint(attachment_outer_arc_upper_left_5);
  const node_outer_arc_upper_left_5 = new THREE.Group();
  node_outer_arc_upper_left_5.name = "Outer Arc Upper Left__pivot";
  if (endpoint_outer_arc_upper_left_5) {
    node_outer_arc_upper_left_5.position.copy(endpoint_outer_arc_upper_left_5.start);
    node_outer_arc_upper_left_5.rotation.set(0, 0, 0);
    node_outer_arc_upper_left_5.scale.set(1, 1, 1);
  } else {
    node_outer_arc_upper_left_5.position.set(0.0, 0.0, 0.0);
    node_outer_arc_upper_left_5.rotation.set(0.0, 0.0, 0.0);
    node_outer_arc_upper_left_5.scale.set(1.0, 1.0, 1.0);
  }
  node_outer_arc_upper_left_5.userData.sculptComponent = {"id": "outer-arc-upper-left", "name": "Outer Arc Upper Left", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.7986, 3.459, 0], [-1.185, 3.3464, 0], [-1.5562, 3.1907, 0], [-1.9074, 2.994, 0], [-2.2341, 2.7589, 0], [-2.532, 2.4882, 0], [-2.7974, 2.1856, 0], [-3.0269, 1.8549, 0], [-3.2174, 1.5003, 0], [-3.3665, 1.1264, 0], [-3.4724, 0.7381, 0]], "crossSection": {"points": [[-0.36, -0.17], [0.36, -0.17], [0.36, 0.17], [-0.36, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_upper_left_5.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_outer_arc_upper_left_5);
  nodes["outer-arc-upper-left"] = node_outer_arc_upper_left_5;
  const mesh_outer_arc_upper_left_5Geometry = endpoint_outer_arc_upper_left_5
    ? new THREE.CylinderGeometry(endpoint_outer_arc_upper_left_5.endRadius, endpoint_outer_arc_upper_left_5.baseRadius, endpoint_outer_arc_upper_left_5.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-0.7986, 3.459, 0], [-1.185, 3.3464, 0], [-1.5562, 3.1907, 0], [-1.9074, 2.994, 0], [-2.2341, 2.7589, 0], [-2.532, 2.4882, 0], [-2.7974, 2.1856, 0], [-3.0269, 1.8549, 0], [-3.2174, 1.5003, 0], [-3.3665, 1.1264, 0], [-3.4724, 0.7381, 0]], "crossSection": {"points": [[-0.36, -0.17], [0.36, -0.17], [0.36, 0.17], [-0.36, 0.17]]}, "closed": false});
  const mesh_outer_arc_upper_left_5 = new THREE.Mesh(
    mesh_outer_arc_upper_left_5Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_outer_arc_upper_left_5.name = "Outer Arc Upper Left";
  if (endpoint_outer_arc_upper_left_5) {
    mesh_outer_arc_upper_left_5.position.copy(endpoint_outer_arc_upper_left_5.midpoint);
    mesh_outer_arc_upper_left_5.quaternion.copy(endpoint_outer_arc_upper_left_5.quaternion);
  }
  mesh_outer_arc_upper_left_5.castShadow = options.castShadow ?? true;
  mesh_outer_arc_upper_left_5.receiveShadow = options.receiveShadow ?? true;
  mesh_outer_arc_upper_left_5.userData.sculptComponent = {"id": "outer-arc-upper-left", "name": "Outer Arc Upper Left", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.7986, 3.459, 0], [-1.185, 3.3464, 0], [-1.5562, 3.1907, 0], [-1.9074, 2.994, 0], [-2.2341, 2.7589, 0], [-2.532, 2.4882, 0], [-2.7974, 2.1856, 0], [-3.0269, 1.8549, 0], [-3.2174, 1.5003, 0], [-3.3665, 1.1264, 0], [-3.4724, 0.7381, 0]], "crossSection": {"points": [[-0.36, -0.17], [0.36, -0.17], [0.36, 0.17], [-0.36, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_upper_left_5.add(mesh_outer_arc_upper_left_5);
  meshes["outer-arc-upper-left"] = mesh_outer_arc_upper_left_5;
  colliders["outer-arc-upper-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["outer-arc-upper-left"] ??= [];
  destructionGroups["outer-arc-upper-left"].push(node_outer_arc_upper_left_5);

  const attachment_outer_arc_upper_right_6 = null;
  const endpoint_outer_arc_upper_right_6 = makeAttachmentEndpoint(attachment_outer_arc_upper_right_6);
  const node_outer_arc_upper_right_6 = new THREE.Group();
  node_outer_arc_upper_right_6.name = "Outer Arc Upper Right__pivot";
  if (endpoint_outer_arc_upper_right_6) {
    node_outer_arc_upper_right_6.position.copy(endpoint_outer_arc_upper_right_6.start);
    node_outer_arc_upper_right_6.rotation.set(0, 0, 0);
    node_outer_arc_upper_right_6.scale.set(1, 1, 1);
  } else {
    node_outer_arc_upper_right_6.position.set(0.0, 0.0, 0.0);
    node_outer_arc_upper_right_6.rotation.set(0.0, 0.0, 0.0);
    node_outer_arc_upper_right_6.scale.set(1.0, 1.0, 1.0);
  }
  node_outer_arc_upper_right_6.userData.sculptComponent = {"id": "outer-arc-upper-right", "name": "Outer Arc Upper Right", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[3.4724, 0.7381, 0], [3.3665, 1.1264, 0], [3.2174, 1.5003, 0], [3.0269, 1.8549, 0], [2.7974, 2.1856, 0], [2.532, 2.4882, 0], [2.2341, 2.7589, 0], [1.9074, 2.994, 0], [1.5562, 3.1907, 0], [1.185, 3.3464, 0], [0.7986, 3.459, 0]], "crossSection": {"points": [[-0.36, -0.17], [0.36, -0.17], [0.36, 0.17], [-0.36, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_upper_right_6.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_outer_arc_upper_right_6);
  nodes["outer-arc-upper-right"] = node_outer_arc_upper_right_6;
  const mesh_outer_arc_upper_right_6Geometry = endpoint_outer_arc_upper_right_6
    ? new THREE.CylinderGeometry(endpoint_outer_arc_upper_right_6.endRadius, endpoint_outer_arc_upper_right_6.baseRadius, endpoint_outer_arc_upper_right_6.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[3.4724, 0.7381, 0], [3.3665, 1.1264, 0], [3.2174, 1.5003, 0], [3.0269, 1.8549, 0], [2.7974, 2.1856, 0], [2.532, 2.4882, 0], [2.2341, 2.7589, 0], [1.9074, 2.994, 0], [1.5562, 3.1907, 0], [1.185, 3.3464, 0], [0.7986, 3.459, 0]], "crossSection": {"points": [[-0.36, -0.17], [0.36, -0.17], [0.36, 0.17], [-0.36, 0.17]]}, "closed": false});
  const mesh_outer_arc_upper_right_6 = new THREE.Mesh(
    mesh_outer_arc_upper_right_6Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_outer_arc_upper_right_6.name = "Outer Arc Upper Right";
  if (endpoint_outer_arc_upper_right_6) {
    mesh_outer_arc_upper_right_6.position.copy(endpoint_outer_arc_upper_right_6.midpoint);
    mesh_outer_arc_upper_right_6.quaternion.copy(endpoint_outer_arc_upper_right_6.quaternion);
  }
  mesh_outer_arc_upper_right_6.castShadow = options.castShadow ?? true;
  mesh_outer_arc_upper_right_6.receiveShadow = options.receiveShadow ?? true;
  mesh_outer_arc_upper_right_6.userData.sculptComponent = {"id": "outer-arc-upper-right", "name": "Outer Arc Upper Right", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[3.4724, 0.7381, 0], [3.3665, 1.1264, 0], [3.2174, 1.5003, 0], [3.0269, 1.8549, 0], [2.7974, 2.1856, 0], [2.532, 2.4882, 0], [2.2341, 2.7589, 0], [1.9074, 2.994, 0], [1.5562, 3.1907, 0], [1.185, 3.3464, 0], [0.7986, 3.459, 0]], "crossSection": {"points": [[-0.36, -0.17], [0.36, -0.17], [0.36, 0.17], [-0.36, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_upper_right_6.add(mesh_outer_arc_upper_right_6);
  meshes["outer-arc-upper-right"] = mesh_outer_arc_upper_right_6;
  colliders["outer-arc-upper-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["outer-arc-upper-right"] ??= [];
  destructionGroups["outer-arc-upper-right"].push(node_outer_arc_upper_right_6);

  const attachment_outer_arc_lower_left_7 = null;
  const endpoint_outer_arc_lower_left_7 = makeAttachmentEndpoint(attachment_outer_arc_lower_left_7);
  const node_outer_arc_lower_left_7 = new THREE.Group();
  node_outer_arc_lower_left_7.name = "Outer Arc Lower Left__pivot";
  if (endpoint_outer_arc_lower_left_7) {
    node_outer_arc_lower_left_7.position.copy(endpoint_outer_arc_lower_left_7.start);
    node_outer_arc_lower_left_7.rotation.set(0, 0, 0);
    node_outer_arc_lower_left_7.scale.set(1, 1, 1);
  } else {
    node_outer_arc_lower_left_7.position.set(0.0, 0.0, 0.0);
    node_outer_arc_lower_left_7.rotation.set(0.0, 0.0, 0.0);
    node_outer_arc_lower_left_7.scale.set(1.0, 1.0, 1.0);
  }
  node_outer_arc_lower_left_7.userData.sculptComponent = {"id": "outer-arc-lower-left", "name": "Outer Arc Lower Left", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-3.4724, -0.7381, 0], [-3.3763, -1.097, 0], [-3.2431, -1.4439, 0], [-3.0744, -1.775, 0], [-2.872, -2.0866, 0], [-2.6382, -2.3754, 0], [-2.3754, -2.6382, 0], [-2.0866, -2.872, 0], [-1.775, -3.0744, 0], [-1.4439, -3.2431, 0], [-1.097, -3.3763, 0]], "crossSection": {"points": [[-0.43, -0.21], [0.43, -0.21], [0.43, 0.21], [-0.43, 0.21]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_lower_left_7.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_outer_arc_lower_left_7);
  nodes["outer-arc-lower-left"] = node_outer_arc_lower_left_7;
  const mesh_outer_arc_lower_left_7Geometry = endpoint_outer_arc_lower_left_7
    ? new THREE.CylinderGeometry(endpoint_outer_arc_lower_left_7.endRadius, endpoint_outer_arc_lower_left_7.baseRadius, endpoint_outer_arc_lower_left_7.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-3.4724, -0.7381, 0], [-3.3763, -1.097, 0], [-3.2431, -1.4439, 0], [-3.0744, -1.775, 0], [-2.872, -2.0866, 0], [-2.6382, -2.3754, 0], [-2.3754, -2.6382, 0], [-2.0866, -2.872, 0], [-1.775, -3.0744, 0], [-1.4439, -3.2431, 0], [-1.097, -3.3763, 0]], "crossSection": {"points": [[-0.43, -0.21], [0.43, -0.21], [0.43, 0.21], [-0.43, 0.21]]}, "closed": false});
  const mesh_outer_arc_lower_left_7 = new THREE.Mesh(
    mesh_outer_arc_lower_left_7Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_outer_arc_lower_left_7.name = "Outer Arc Lower Left";
  if (endpoint_outer_arc_lower_left_7) {
    mesh_outer_arc_lower_left_7.position.copy(endpoint_outer_arc_lower_left_7.midpoint);
    mesh_outer_arc_lower_left_7.quaternion.copy(endpoint_outer_arc_lower_left_7.quaternion);
  }
  mesh_outer_arc_lower_left_7.castShadow = options.castShadow ?? true;
  mesh_outer_arc_lower_left_7.receiveShadow = options.receiveShadow ?? true;
  mesh_outer_arc_lower_left_7.userData.sculptComponent = {"id": "outer-arc-lower-left", "name": "Outer Arc Lower Left", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-3.4724, -0.7381, 0], [-3.3763, -1.097, 0], [-3.2431, -1.4439, 0], [-3.0744, -1.775, 0], [-2.872, -2.0866, 0], [-2.6382, -2.3754, 0], [-2.3754, -2.6382, 0], [-2.0866, -2.872, 0], [-1.775, -3.0744, 0], [-1.4439, -3.2431, 0], [-1.097, -3.3763, 0]], "crossSection": {"points": [[-0.43, -0.21], [0.43, -0.21], [0.43, 0.21], [-0.43, 0.21]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_lower_left_7.add(mesh_outer_arc_lower_left_7);
  meshes["outer-arc-lower-left"] = mesh_outer_arc_lower_left_7;
  colliders["outer-arc-lower-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["outer-arc-lower-left"] ??= [];
  destructionGroups["outer-arc-lower-left"].push(node_outer_arc_lower_left_7);

  const attachment_outer_arc_lower_right_8 = null;
  const endpoint_outer_arc_lower_right_8 = makeAttachmentEndpoint(attachment_outer_arc_lower_right_8);
  const node_outer_arc_lower_right_8 = new THREE.Group();
  node_outer_arc_lower_right_8.name = "Outer Arc Lower Right__pivot";
  if (endpoint_outer_arc_lower_right_8) {
    node_outer_arc_lower_right_8.position.copy(endpoint_outer_arc_lower_right_8.start);
    node_outer_arc_lower_right_8.rotation.set(0, 0, 0);
    node_outer_arc_lower_right_8.scale.set(1, 1, 1);
  } else {
    node_outer_arc_lower_right_8.position.set(0.0, 0.0, 0.0);
    node_outer_arc_lower_right_8.rotation.set(0.0, 0.0, 0.0);
    node_outer_arc_lower_right_8.scale.set(1.0, 1.0, 1.0);
  }
  node_outer_arc_lower_right_8.userData.sculptComponent = {"id": "outer-arc-lower-right", "name": "Outer Arc Lower Right", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[1.097, -3.3763, 0], [1.4439, -3.2431, 0], [1.775, -3.0744, 0], [2.0866, -2.872, 0], [2.3754, -2.6382, 0], [2.6382, -2.3754, 0], [2.872, -2.0866, 0], [3.0744, -1.775, 0], [3.2431, -1.4439, 0], [3.3763, -1.097, 0], [3.4724, -0.7381, 0]], "crossSection": {"points": [[-0.43, -0.21], [0.43, -0.21], [0.43, 0.21], [-0.43, 0.21]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_lower_right_8.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_outer_arc_lower_right_8);
  nodes["outer-arc-lower-right"] = node_outer_arc_lower_right_8;
  const mesh_outer_arc_lower_right_8Geometry = endpoint_outer_arc_lower_right_8
    ? new THREE.CylinderGeometry(endpoint_outer_arc_lower_right_8.endRadius, endpoint_outer_arc_lower_right_8.baseRadius, endpoint_outer_arc_lower_right_8.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[1.097, -3.3763, 0], [1.4439, -3.2431, 0], [1.775, -3.0744, 0], [2.0866, -2.872, 0], [2.3754, -2.6382, 0], [2.6382, -2.3754, 0], [2.872, -2.0866, 0], [3.0744, -1.775, 0], [3.2431, -1.4439, 0], [3.3763, -1.097, 0], [3.4724, -0.7381, 0]], "crossSection": {"points": [[-0.43, -0.21], [0.43, -0.21], [0.43, 0.21], [-0.43, 0.21]]}, "closed": false});
  const mesh_outer_arc_lower_right_8 = new THREE.Mesh(
    mesh_outer_arc_lower_right_8Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_outer_arc_lower_right_8.name = "Outer Arc Lower Right";
  if (endpoint_outer_arc_lower_right_8) {
    mesh_outer_arc_lower_right_8.position.copy(endpoint_outer_arc_lower_right_8.midpoint);
    mesh_outer_arc_lower_right_8.quaternion.copy(endpoint_outer_arc_lower_right_8.quaternion);
  }
  mesh_outer_arc_lower_right_8.castShadow = options.castShadow ?? true;
  mesh_outer_arc_lower_right_8.receiveShadow = options.receiveShadow ?? true;
  mesh_outer_arc_lower_right_8.userData.sculptComponent = {"id": "outer-arc-lower-right", "name": "Outer Arc Lower Right", "level": "macro", "role": "shell", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[1.097, -3.3763, 0], [1.4439, -3.2431, 0], [1.775, -3.0744, 0], [2.0866, -2.872, 0], [2.3754, -2.6382, 0], [2.6382, -2.3754, 0], [2.872, -2.0866, 0], [3.0744, -1.775, 0], [3.2431, -1.4439, 0], [3.3763, -1.097, 0], [3.4724, -0.7381, 0]], "crossSection": {"points": [[-0.43, -0.21], [0.43, -0.21], [0.43, 0.21], [-0.43, 0.21]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.1, "height": 7.1, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "outer-arc-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_outer_arc_lower_right_8.add(mesh_outer_arc_lower_right_8);
  meshes["outer-arc-lower-right"] = mesh_outer_arc_lower_right_8;
  colliders["outer-arc-lower-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.1, 7.1, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["outer-arc-lower-right"] ??= [];
  destructionGroups["outer-arc-lower-right"].push(node_outer_arc_lower_right_8);

  const attachment_inner_prong_left_9 = null;
  const endpoint_inner_prong_left_9 = makeAttachmentEndpoint(attachment_inner_prong_left_9);
  const node_inner_prong_left_9 = new THREE.Group();
  node_inner_prong_left_9.name = "Inner Prong Left__pivot";
  if (endpoint_inner_prong_left_9) {
    node_inner_prong_left_9.position.copy(endpoint_inner_prong_left_9.start);
    node_inner_prong_left_9.rotation.set(0, 0, 0);
    node_inner_prong_left_9.scale.set(1, 1, 1);
  } else {
    node_inner_prong_left_9.position.set(0.0, 0.0, 0.0);
    node_inner_prong_left_9.rotation.set(0.0, 0.0, 0.0);
    node_inner_prong_left_9.scale.set(1.0, 1.0, 1.0);
  }
  node_inner_prong_left_9.userData.sculptComponent = {"id": "inner-prong-left", "name": "Inner Prong Left", "level": "macro", "role": "landmark", "importance": 0.9, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.74, 2.7, 0.08], [-0.98, 1.78, 0.05], [-0.74, 0.75, 0.04], [-0.2, -0.15, 0.03], [0.36, -1.1, 0.02]], "crossSection": {"points": [[-0.17, -0.18], [0.17, -0.18], [0.17, 0.18], [-0.17, 0.18]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.36, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prong-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_inner_prong_left_9.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prong-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_inner_prong_left_9);
  nodes["inner-prong-left"] = node_inner_prong_left_9;
  const mesh_inner_prong_left_9Geometry = endpoint_inner_prong_left_9
    ? new THREE.CylinderGeometry(endpoint_inner_prong_left_9.endRadius, endpoint_inner_prong_left_9.baseRadius, endpoint_inner_prong_left_9.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-0.74, 2.7, 0.08], [-0.98, 1.78, 0.05], [-0.74, 0.75, 0.04], [-0.2, -0.15, 0.03], [0.36, -1.1, 0.02]], "crossSection": {"points": [[-0.17, -0.18], [0.17, -0.18], [0.17, 0.18], [-0.17, 0.18]]}, "closed": false});
  const mesh_inner_prong_left_9 = new THREE.Mesh(
    mesh_inner_prong_left_9Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_inner_prong_left_9.name = "Inner Prong Left";
  if (endpoint_inner_prong_left_9) {
    mesh_inner_prong_left_9.position.copy(endpoint_inner_prong_left_9.midpoint);
    mesh_inner_prong_left_9.quaternion.copy(endpoint_inner_prong_left_9.quaternion);
  }
  mesh_inner_prong_left_9.castShadow = options.castShadow ?? true;
  mesh_inner_prong_left_9.receiveShadow = options.receiveShadow ?? true;
  mesh_inner_prong_left_9.userData.sculptComponent = {"id": "inner-prong-left", "name": "Inner Prong Left", "level": "macro", "role": "landmark", "importance": 0.9, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.74, 2.7, 0.08], [-0.98, 1.78, 0.05], [-0.74, 0.75, 0.04], [-0.2, -0.15, 0.03], [0.36, -1.1, 0.02]], "crossSection": {"points": [[-0.17, -0.18], [0.17, -0.18], [0.17, 0.18], [-0.17, 0.18]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.36, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prong-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_inner_prong_left_9.add(mesh_inner_prong_left_9);
  meshes["inner-prong-left"] = mesh_inner_prong_left_9;
  colliders["inner-prong-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["inner-prong-left"] ??= [];
  destructionGroups["inner-prong-left"].push(node_inner_prong_left_9);

  const attachment_inner_prong_right_10 = null;
  const endpoint_inner_prong_right_10 = makeAttachmentEndpoint(attachment_inner_prong_right_10);
  const node_inner_prong_right_10 = new THREE.Group();
  node_inner_prong_right_10.name = "Inner Prong Right__pivot";
  if (endpoint_inner_prong_right_10) {
    node_inner_prong_right_10.position.copy(endpoint_inner_prong_right_10.start);
    node_inner_prong_right_10.rotation.set(0, 0, 0);
    node_inner_prong_right_10.scale.set(1, 1, 1);
  } else {
    node_inner_prong_right_10.position.set(0.0, 0.0, 0.0);
    node_inner_prong_right_10.rotation.set(0.0, 0.0, 0.0);
    node_inner_prong_right_10.scale.set(1.0, 1.0, 1.0);
  }
  node_inner_prong_right_10.userData.sculptComponent = {"id": "inner-prong-right", "name": "Inner Prong Right", "level": "macro", "role": "landmark", "importance": 0.9, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.74, 2.7, 0.08], [0.98, 1.78, 0.05], [0.74, 0.75, 0.04], [0.2, -0.15, 0.03], [-0.36, -1.1, 0.02]], "crossSection": {"points": [[-0.17, -0.18], [0.17, -0.18], [0.17, 0.18], [-0.17, 0.18]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.36, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prong-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_inner_prong_right_10.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prong-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_inner_prong_right_10);
  nodes["inner-prong-right"] = node_inner_prong_right_10;
  const mesh_inner_prong_right_10Geometry = endpoint_inner_prong_right_10
    ? new THREE.CylinderGeometry(endpoint_inner_prong_right_10.endRadius, endpoint_inner_prong_right_10.baseRadius, endpoint_inner_prong_right_10.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[0.74, 2.7, 0.08], [0.98, 1.78, 0.05], [0.74, 0.75, 0.04], [0.2, -0.15, 0.03], [-0.36, -1.1, 0.02]], "crossSection": {"points": [[-0.17, -0.18], [0.17, -0.18], [0.17, 0.18], [-0.17, 0.18]]}, "closed": false});
  const mesh_inner_prong_right_10 = new THREE.Mesh(
    mesh_inner_prong_right_10Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_inner_prong_right_10.name = "Inner Prong Right";
  if (endpoint_inner_prong_right_10) {
    mesh_inner_prong_right_10.position.copy(endpoint_inner_prong_right_10.midpoint);
    mesh_inner_prong_right_10.quaternion.copy(endpoint_inner_prong_right_10.quaternion);
  }
  mesh_inner_prong_right_10.castShadow = options.castShadow ?? true;
  mesh_inner_prong_right_10.receiveShadow = options.receiveShadow ?? true;
  mesh_inner_prong_right_10.userData.sculptComponent = {"id": "inner-prong-right", "name": "Inner Prong Right", "level": "macro", "role": "landmark", "importance": 0.9, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.74, 2.7, 0.08], [0.98, 1.78, 0.05], [0.74, 0.75, 0.04], [0.2, -0.15, 0.03], [-0.36, -1.1, 0.02]], "crossSection": {"points": [[-0.17, -0.18], [0.17, -0.18], [0.17, 0.18], [-0.17, 0.18]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.36, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "inner-prong-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_inner_prong_right_10.add(mesh_inner_prong_right_10);
  meshes["inner-prong-right"] = mesh_inner_prong_right_10;
  colliders["inner-prong-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.36], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["inner-prong-right"] ??= [];
  destructionGroups["inner-prong-right"].push(node_inner_prong_right_10);

  const attachment_crown_gate_left_11 = null;
  const endpoint_crown_gate_left_11 = makeAttachmentEndpoint(attachment_crown_gate_left_11);
  const node_crown_gate_left_11 = new THREE.Group();
  node_crown_gate_left_11.name = "Crown Gate Left__pivot";
  if (endpoint_crown_gate_left_11) {
    node_crown_gate_left_11.position.copy(endpoint_crown_gate_left_11.start);
    node_crown_gate_left_11.rotation.set(0, 0, 0);
    node_crown_gate_left_11.scale.set(1, 1, 1);
  } else {
    node_crown_gate_left_11.position.set(0.0, 0.0, 0.0);
    node_crown_gate_left_11.rotation.set(0.0, 0.0, 0.0);
    node_crown_gate_left_11.scale.set(1.0, 1.0, 1.0);
  }
  node_crown_gate_left_11.userData.sculptComponent = {"id": "crown-gate-left", "name": "Crown Gate Left", "level": "macro", "role": "shell", "importance": 0.92, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.2122, 3.4421, 0.08], [-0.41, 3.3601, 0.08], [-0.5798, 3.2298, 0.08], [-0.7101, 3.06, 0.08], [-0.7921, 2.8622, 0.08], [-0.82, 2.65, 0.08], [-0.7921, 2.4378, 0.08], [-0.7101, 2.24, 0.08], [-0.5798, 2.0702, 0.08], [-0.41, 1.9399, 0.08], [-0.2122, 1.8579, 0.08]], "crossSection": {"points": [[-0.17, -0.19], [0.17, -0.19], [0.17, 0.19], [-0.17, 0.19]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.64, "height": 1.64, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_crown_gate_left_11.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_crown_gate_left_11);
  nodes["crown-gate-left"] = node_crown_gate_left_11;
  const mesh_crown_gate_left_11Geometry = endpoint_crown_gate_left_11
    ? new THREE.CylinderGeometry(endpoint_crown_gate_left_11.endRadius, endpoint_crown_gate_left_11.baseRadius, endpoint_crown_gate_left_11.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-0.2122, 3.4421, 0.08], [-0.41, 3.3601, 0.08], [-0.5798, 3.2298, 0.08], [-0.7101, 3.06, 0.08], [-0.7921, 2.8622, 0.08], [-0.82, 2.65, 0.08], [-0.7921, 2.4378, 0.08], [-0.7101, 2.24, 0.08], [-0.5798, 2.0702, 0.08], [-0.41, 1.9399, 0.08], [-0.2122, 1.8579, 0.08]], "crossSection": {"points": [[-0.17, -0.19], [0.17, -0.19], [0.17, 0.19], [-0.17, 0.19]]}, "closed": false});
  const mesh_crown_gate_left_11 = new THREE.Mesh(
    mesh_crown_gate_left_11Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_crown_gate_left_11.name = "Crown Gate Left";
  if (endpoint_crown_gate_left_11) {
    mesh_crown_gate_left_11.position.copy(endpoint_crown_gate_left_11.midpoint);
    mesh_crown_gate_left_11.quaternion.copy(endpoint_crown_gate_left_11.quaternion);
  }
  mesh_crown_gate_left_11.castShadow = options.castShadow ?? true;
  mesh_crown_gate_left_11.receiveShadow = options.receiveShadow ?? true;
  mesh_crown_gate_left_11.userData.sculptComponent = {"id": "crown-gate-left", "name": "Crown Gate Left", "level": "macro", "role": "shell", "importance": 0.92, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.2122, 3.4421, 0.08], [-0.41, 3.3601, 0.08], [-0.5798, 3.2298, 0.08], [-0.7101, 3.06, 0.08], [-0.7921, 2.8622, 0.08], [-0.82, 2.65, 0.08], [-0.7921, 2.4378, 0.08], [-0.7101, 2.24, 0.08], [-0.5798, 2.0702, 0.08], [-0.41, 1.9399, 0.08], [-0.2122, 1.8579, 0.08]], "crossSection": {"points": [[-0.17, -0.19], [0.17, -0.19], [0.17, 0.19], [-0.17, 0.19]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.64, "height": 1.64, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_crown_gate_left_11.add(mesh_crown_gate_left_11);
  meshes["crown-gate-left"] = mesh_crown_gate_left_11;
  colliders["crown-gate-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["crown-gate-left"] ??= [];
  destructionGroups["crown-gate-left"].push(node_crown_gate_left_11);

  const attachment_crown_gate_right_12 = null;
  const endpoint_crown_gate_right_12 = makeAttachmentEndpoint(attachment_crown_gate_right_12);
  const node_crown_gate_right_12 = new THREE.Group();
  node_crown_gate_right_12.name = "Crown Gate Right__pivot";
  if (endpoint_crown_gate_right_12) {
    node_crown_gate_right_12.position.copy(endpoint_crown_gate_right_12.start);
    node_crown_gate_right_12.rotation.set(0, 0, 0);
    node_crown_gate_right_12.scale.set(1, 1, 1);
  } else {
    node_crown_gate_right_12.position.set(0.0, 0.0, 0.0);
    node_crown_gate_right_12.rotation.set(0.0, 0.0, 0.0);
    node_crown_gate_right_12.scale.set(1.0, 1.0, 1.0);
  }
  node_crown_gate_right_12.userData.sculptComponent = {"id": "crown-gate-right", "name": "Crown Gate Right", "level": "macro", "role": "shell", "importance": 0.92, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.2122, 1.8579, 0.08], [0.41, 1.9399, 0.08], [0.5798, 2.0702, 0.08], [0.7101, 2.24, 0.08], [0.7921, 2.4378, 0.08], [0.82, 2.65, 0.08], [0.7921, 2.8622, 0.08], [0.7101, 3.06, 0.08], [0.5798, 3.2298, 0.08], [0.41, 3.3601, 0.08], [0.2122, 3.4421, 0.08]], "crossSection": {"points": [[-0.17, -0.19], [0.17, -0.19], [0.17, 0.19], [-0.17, 0.19]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.64, "height": 1.64, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_crown_gate_right_12.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_crown_gate_right_12);
  nodes["crown-gate-right"] = node_crown_gate_right_12;
  const mesh_crown_gate_right_12Geometry = endpoint_crown_gate_right_12
    ? new THREE.CylinderGeometry(endpoint_crown_gate_right_12.endRadius, endpoint_crown_gate_right_12.baseRadius, endpoint_crown_gate_right_12.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[0.2122, 1.8579, 0.08], [0.41, 1.9399, 0.08], [0.5798, 2.0702, 0.08], [0.7101, 2.24, 0.08], [0.7921, 2.4378, 0.08], [0.82, 2.65, 0.08], [0.7921, 2.8622, 0.08], [0.7101, 3.06, 0.08], [0.5798, 3.2298, 0.08], [0.41, 3.3601, 0.08], [0.2122, 3.4421, 0.08]], "crossSection": {"points": [[-0.17, -0.19], [0.17, -0.19], [0.17, 0.19], [-0.17, 0.19]]}, "closed": false});
  const mesh_crown_gate_right_12 = new THREE.Mesh(
    mesh_crown_gate_right_12Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_crown_gate_right_12.name = "Crown Gate Right";
  if (endpoint_crown_gate_right_12) {
    mesh_crown_gate_right_12.position.copy(endpoint_crown_gate_right_12.midpoint);
    mesh_crown_gate_right_12.quaternion.copy(endpoint_crown_gate_right_12.quaternion);
  }
  mesh_crown_gate_right_12.castShadow = options.castShadow ?? true;
  mesh_crown_gate_right_12.receiveShadow = options.receiveShadow ?? true;
  mesh_crown_gate_right_12.userData.sculptComponent = {"id": "crown-gate-right", "name": "Crown Gate Right", "level": "macro", "role": "shell", "importance": 0.92, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.2122, 1.8579, 0.08], [0.41, 1.9399, 0.08], [0.5798, 2.0702, 0.08], [0.7101, 2.24, 0.08], [0.7921, 2.4378, 0.08], [0.82, 2.65, 0.08], [0.7921, 2.8622, 0.08], [0.7101, 3.06, 0.08], [0.5798, 3.2298, 0.08], [0.41, 3.3601, 0.08], [0.2122, 3.4421, 0.08]], "crossSection": {"points": [[-0.17, -0.19], [0.17, -0.19], [0.17, 0.19], [-0.17, 0.19]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.64, "height": 1.64, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "crown-gate-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_crown_gate_right_12.add(mesh_crown_gate_right_12);
  meshes["crown-gate-right"] = mesh_crown_gate_right_12;
  colliders["crown-gate-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.64, 1.64, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["crown-gate-right"] ??= [];
  destructionGroups["crown-gate-right"].push(node_crown_gate_right_12);

  const attachment_lower_keystone_left_13 = null;
  const endpoint_lower_keystone_left_13 = makeAttachmentEndpoint(attachment_lower_keystone_left_13);
  const node_lower_keystone_left_13 = new THREE.Group();
  node_lower_keystone_left_13.name = "Lower Keystone Left__pivot";
  if (endpoint_lower_keystone_left_13) {
    node_lower_keystone_left_13.position.copy(endpoint_lower_keystone_left_13.start);
    node_lower_keystone_left_13.rotation.set(0, 0, 0);
    node_lower_keystone_left_13.scale.set(1, 1, 1);
  } else {
    node_lower_keystone_left_13.position.set(0.0, 0.0, 0.0);
    node_lower_keystone_left_13.rotation.set(0.0, 0.0, 0.0);
    node_lower_keystone_left_13.scale.set(1.0, 1.0, 1.0);
  }
  node_lower_keystone_left_13.userData.sculptComponent = {"id": "lower-keystone-left", "name": "Lower Keystone Left", "level": "macro", "role": "landmark", "importance": 0.85, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-1.45, -2.75], [-0.55, -2.45], [-0.08, -2.62], [-0.12, -3.12], [-0.14, -3.82], [-0.48, -4.12], [-0.98, -3.6]], "depth": 0.48}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 1.3699999999999999, "height": 1.67, "depth": 0.48, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lower_keystone_left_13.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["lower-keystone"] ?? root).add(node_lower_keystone_left_13);
  nodes["lower-keystone-left"] = node_lower_keystone_left_13;
  const mesh_lower_keystone_left_13Geometry = endpoint_lower_keystone_left_13
    ? new THREE.CylinderGeometry(endpoint_lower_keystone_left_13.endRadius, endpoint_lower_keystone_left_13.baseRadius, endpoint_lower_keystone_left_13.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.45, -2.75], [-0.55, -2.45], [-0.08, -2.62], [-0.12, -3.12], [-0.14, -3.82], [-0.48, -4.12], [-0.98, -3.6]], "depth": 0.48});
  const mesh_lower_keystone_left_13 = new THREE.Mesh(
    mesh_lower_keystone_left_13Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_keystone_left_13.name = "Lower Keystone Left";
  if (endpoint_lower_keystone_left_13) {
    mesh_lower_keystone_left_13.position.copy(endpoint_lower_keystone_left_13.midpoint);
    mesh_lower_keystone_left_13.quaternion.copy(endpoint_lower_keystone_left_13.quaternion);
  }
  mesh_lower_keystone_left_13.castShadow = options.castShadow ?? true;
  mesh_lower_keystone_left_13.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_keystone_left_13.userData.sculptComponent = {"id": "lower-keystone-left", "name": "Lower Keystone Left", "level": "macro", "role": "landmark", "importance": 0.85, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-1.45, -2.75], [-0.55, -2.45], [-0.08, -2.62], [-0.12, -3.12], [-0.14, -3.82], [-0.48, -4.12], [-0.98, -3.6]], "depth": 0.48}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 1.3699999999999999, "height": 1.67, "depth": 0.48, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lower_keystone_left_13.add(mesh_lower_keystone_left_13);
  meshes["lower-keystone-left"] = mesh_lower_keystone_left_13;
  colliders["lower-keystone-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["lower-keystone-left"] ??= [];
  destructionGroups["lower-keystone-left"].push(node_lower_keystone_left_13);

  const attachment_lower_keystone_right_14 = null;
  const endpoint_lower_keystone_right_14 = makeAttachmentEndpoint(attachment_lower_keystone_right_14);
  const node_lower_keystone_right_14 = new THREE.Group();
  node_lower_keystone_right_14.name = "Lower Keystone Right__pivot";
  if (endpoint_lower_keystone_right_14) {
    node_lower_keystone_right_14.position.copy(endpoint_lower_keystone_right_14.start);
    node_lower_keystone_right_14.rotation.set(0, 0, 0);
    node_lower_keystone_right_14.scale.set(1, 1, 1);
  } else {
    node_lower_keystone_right_14.position.set(0.0, 0.0, 0.0);
    node_lower_keystone_right_14.rotation.set(0.0, 0.0, 0.0);
    node_lower_keystone_right_14.scale.set(1.0, 1.0, 1.0);
  }
  node_lower_keystone_right_14.userData.sculptComponent = {"id": "lower-keystone-right", "name": "Lower Keystone Right", "level": "macro", "role": "landmark", "importance": 0.85, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[1.45, -2.75], [0.55, -2.45], [0.08, -2.62], [0.12, -3.12], [0.14, -3.82], [0.48, -4.12], [0.98, -3.6]], "depth": 0.48}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 1.3699999999999999, "height": 1.67, "depth": 0.48, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lower_keystone_right_14.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["lower-keystone"] ?? root).add(node_lower_keystone_right_14);
  nodes["lower-keystone-right"] = node_lower_keystone_right_14;
  const mesh_lower_keystone_right_14Geometry = endpoint_lower_keystone_right_14
    ? new THREE.CylinderGeometry(endpoint_lower_keystone_right_14.endRadius, endpoint_lower_keystone_right_14.baseRadius, endpoint_lower_keystone_right_14.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.45, -2.75], [0.55, -2.45], [0.08, -2.62], [0.12, -3.12], [0.14, -3.82], [0.48, -4.12], [0.98, -3.6]], "depth": 0.48});
  const mesh_lower_keystone_right_14 = new THREE.Mesh(
    mesh_lower_keystone_right_14Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_keystone_right_14.name = "Lower Keystone Right";
  if (endpoint_lower_keystone_right_14) {
    mesh_lower_keystone_right_14.position.copy(endpoint_lower_keystone_right_14.midpoint);
    mesh_lower_keystone_right_14.quaternion.copy(endpoint_lower_keystone_right_14.quaternion);
  }
  mesh_lower_keystone_right_14.castShadow = options.castShadow ?? true;
  mesh_lower_keystone_right_14.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_keystone_right_14.userData.sculptComponent = {"id": "lower-keystone-right", "name": "Lower Keystone Right", "level": "macro", "role": "landmark", "importance": 0.85, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[1.45, -2.75], [0.55, -2.45], [0.08, -2.62], [0.12, -3.12], [0.14, -3.82], [0.48, -4.12], [0.98, -3.6]], "depth": 0.48}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 1.3699999999999999, "height": 1.67, "depth": 0.48, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "lower-keystone-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lower_keystone_right_14.add(mesh_lower_keystone_right_14);
  meshes["lower-keystone-right"] = mesh_lower_keystone_right_14;
  colliders["lower-keystone-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.3699999999999999, 1.67, 0.48], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["lower-keystone-right"] ??= [];
  destructionGroups["lower-keystone-right"].push(node_lower_keystone_right_14);

  const attachment_understructure_15 = null;
  const endpoint_understructure_15 = makeAttachmentEndpoint(attachment_understructure_15);
  const node_understructure_15 = new THREE.Group();
  node_understructure_15.name = "Stacked Understructure System__pivot";
  if (endpoint_understructure_15) {
    node_understructure_15.position.copy(endpoint_understructure_15.start);
    node_understructure_15.rotation.set(0, 0, 0);
    node_understructure_15.scale.set(1, 1, 1);
  } else {
    node_understructure_15.position.set(0.0, 0.0, 0.0);
    node_understructure_15.rotation.set(0.0, 0.0, 0.0);
    node_understructure_15.scale.set(1.0, 1.0, 1.0);
  }
  node_understructure_15.userData.sculptComponent = {"id": "understructure", "name": "Stacked Understructure System", "level": "meso", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "understructure", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stacked-ribs", "description": "Recessed structural arc and radial supports sit beneath armor."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_understructure_15.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "understructure", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_understructure_15);
  nodes["understructure"] = node_understructure_15;
  const mesh_understructure_15Geometry = endpoint_understructure_15
    ? new THREE.CylinderGeometry(endpoint_understructure_15.endRadius, endpoint_understructure_15.baseRadius, endpoint_understructure_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_understructure_15 = new THREE.Mesh(
    mesh_understructure_15Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_understructure_15.name = "Stacked Understructure System";
  if (endpoint_understructure_15) {
    mesh_understructure_15.position.copy(endpoint_understructure_15.midpoint);
    mesh_understructure_15.quaternion.copy(endpoint_understructure_15.quaternion);
  }
  mesh_understructure_15.castShadow = options.castShadow ?? true;
  mesh_understructure_15.receiveShadow = options.receiveShadow ?? true;
  mesh_understructure_15.userData.sculptComponent = {"id": "understructure", "name": "Stacked Understructure System", "level": "meso", "role": "metadata-group", "importance": 0.2, "confidence": 1, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "This node is intentionally invisible and exists to expose semantic runtime grouping.", "geometryDescriptor": {"topologyIntent": "Invisible semantic pivot for review, visibility, and future stage-state control.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "arena-radius-relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "understructure", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stacked-ribs", "description": "Recessed structural arc and radial supports sit beneath armor."}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_understructure_15.add(mesh_understructure_15);
  meshes["understructure"] = mesh_understructure_15;
  colliders["understructure"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 0.1, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["understructure"] ??= [];
  destructionGroups["understructure"].push(node_understructure_15);

  const attachment_under_arc_upper_left_16 = null;
  const endpoint_under_arc_upper_left_16 = makeAttachmentEndpoint(attachment_under_arc_upper_left_16);
  const node_under_arc_upper_left_16 = new THREE.Group();
  node_under_arc_upper_left_16.name = "Under Arc Upper Left__pivot";
  if (endpoint_under_arc_upper_left_16) {
    node_under_arc_upper_left_16.position.copy(endpoint_under_arc_upper_left_16.start);
    node_under_arc_upper_left_16.rotation.set(0, 0, 0);
    node_under_arc_upper_left_16.scale.set(1, 1, 1);
  } else {
    node_under_arc_upper_left_16.position.set(0.0, 0.0, 0.0);
    node_under_arc_upper_left_16.rotation.set(0.0, 0.0, 0.0);
    node_under_arc_upper_left_16.scale.set(1.0, 1.0, 1.0);
  }
  node_under_arc_upper_left_16.userData.sculptComponent = {"id": "under-arc-upper-left", "name": "Under Arc Upper Left", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.8201, 3.2893, -0.3], [-1.1761, 3.1794, -0.3], [-1.5179, 3.0312, -0.3], [-1.8414, 2.8463, -0.3], [-2.1426, 2.6271, -0.3], [-2.4179, 2.3761, -0.3], [-2.6641, 2.0964, -0.3], [-2.878, 1.7914, -0.3], [-3.0572, 1.4648, -0.3], [-3.1995, 1.1204, -0.3], [-3.3031, 0.7626, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_upper_left_16.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}};
  (nodes["root"] ?? root).add(node_under_arc_upper_left_16);
  nodes["under-arc-upper-left"] = node_under_arc_upper_left_16;
  const mesh_under_arc_upper_left_16Geometry = endpoint_under_arc_upper_left_16
    ? new THREE.CylinderGeometry(endpoint_under_arc_upper_left_16.endRadius, endpoint_under_arc_upper_left_16.baseRadius, endpoint_under_arc_upper_left_16.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-0.8201, 3.2893, -0.3], [-1.1761, 3.1794, -0.3], [-1.5179, 3.0312, -0.3], [-1.8414, 2.8463, -0.3], [-2.1426, 2.6271, -0.3], [-2.4179, 2.3761, -0.3], [-2.6641, 2.0964, -0.3], [-2.878, 1.7914, -0.3], [-3.0572, 1.4648, -0.3], [-3.1995, 1.1204, -0.3], [-3.3031, 0.7626, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false});
  const mesh_under_arc_upper_left_16 = new THREE.Mesh(
    mesh_under_arc_upper_left_16Geometry,
    materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_under_arc_upper_left_16.name = "Under Arc Upper Left";
  if (endpoint_under_arc_upper_left_16) {
    mesh_under_arc_upper_left_16.position.copy(endpoint_under_arc_upper_left_16.midpoint);
    mesh_under_arc_upper_left_16.quaternion.copy(endpoint_under_arc_upper_left_16.quaternion);
  }
  mesh_under_arc_upper_left_16.castShadow = options.castShadow ?? true;
  mesh_under_arc_upper_left_16.receiveShadow = options.receiveShadow ?? true;
  mesh_under_arc_upper_left_16.userData.sculptComponent = {"id": "under-arc-upper-left", "name": "Under Arc Upper Left", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.8201, 3.2893, -0.3], [-1.1761, 3.1794, -0.3], [-1.5179, 3.0312, -0.3], [-1.8414, 2.8463, -0.3], [-2.1426, 2.6271, -0.3], [-2.4179, 2.3761, -0.3], [-2.6641, 2.0964, -0.3], [-2.878, 1.7914, -0.3], [-3.0572, 1.4648, -0.3], [-3.1995, 1.1204, -0.3], [-3.3031, 0.7626, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_upper_left_16.add(mesh_under_arc_upper_left_16);
  meshes["under-arc-upper-left"] = mesh_under_arc_upper_left_16;
  colliders["under-arc-upper-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["under-arc-upper-left"] ??= [];
  destructionGroups["under-arc-upper-left"].push(node_under_arc_upper_left_16);

  const attachment_under_arc_upper_right_17 = null;
  const endpoint_under_arc_upper_right_17 = makeAttachmentEndpoint(attachment_under_arc_upper_right_17);
  const node_under_arc_upper_right_17 = new THREE.Group();
  node_under_arc_upper_right_17.name = "Under Arc Upper Right__pivot";
  if (endpoint_under_arc_upper_right_17) {
    node_under_arc_upper_right_17.position.copy(endpoint_under_arc_upper_right_17.start);
    node_under_arc_upper_right_17.rotation.set(0, 0, 0);
    node_under_arc_upper_right_17.scale.set(1, 1, 1);
  } else {
    node_under_arc_upper_right_17.position.set(0.0, 0.0, 0.0);
    node_under_arc_upper_right_17.rotation.set(0.0, 0.0, 0.0);
    node_under_arc_upper_right_17.scale.set(1.0, 1.0, 1.0);
  }
  node_under_arc_upper_right_17.userData.sculptComponent = {"id": "under-arc-upper-right", "name": "Under Arc Upper Right", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[3.3031, 0.7626, -0.3], [3.1995, 1.1204, -0.3], [3.0572, 1.4648, -0.3], [2.878, 1.7914, -0.3], [2.6641, 2.0964, -0.3], [2.4179, 2.3761, -0.3], [2.1426, 2.6271, -0.3], [1.8414, 2.8463, -0.3], [1.5179, 3.0312, -0.3], [1.1761, 3.1794, -0.3], [0.8201, 3.2893, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_upper_right_17.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}};
  (nodes["root"] ?? root).add(node_under_arc_upper_right_17);
  nodes["under-arc-upper-right"] = node_under_arc_upper_right_17;
  const mesh_under_arc_upper_right_17Geometry = endpoint_under_arc_upper_right_17
    ? new THREE.CylinderGeometry(endpoint_under_arc_upper_right_17.endRadius, endpoint_under_arc_upper_right_17.baseRadius, endpoint_under_arc_upper_right_17.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[3.3031, 0.7626, -0.3], [3.1995, 1.1204, -0.3], [3.0572, 1.4648, -0.3], [2.878, 1.7914, -0.3], [2.6641, 2.0964, -0.3], [2.4179, 2.3761, -0.3], [2.1426, 2.6271, -0.3], [1.8414, 2.8463, -0.3], [1.5179, 3.0312, -0.3], [1.1761, 3.1794, -0.3], [0.8201, 3.2893, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false});
  const mesh_under_arc_upper_right_17 = new THREE.Mesh(
    mesh_under_arc_upper_right_17Geometry,
    materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_under_arc_upper_right_17.name = "Under Arc Upper Right";
  if (endpoint_under_arc_upper_right_17) {
    mesh_under_arc_upper_right_17.position.copy(endpoint_under_arc_upper_right_17.midpoint);
    mesh_under_arc_upper_right_17.quaternion.copy(endpoint_under_arc_upper_right_17.quaternion);
  }
  mesh_under_arc_upper_right_17.castShadow = options.castShadow ?? true;
  mesh_under_arc_upper_right_17.receiveShadow = options.receiveShadow ?? true;
  mesh_under_arc_upper_right_17.userData.sculptComponent = {"id": "under-arc-upper-right", "name": "Under Arc Upper Right", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[3.3031, 0.7626, -0.3], [3.1995, 1.1204, -0.3], [3.0572, 1.4648, -0.3], [2.878, 1.7914, -0.3], [2.6641, 2.0964, -0.3], [2.4179, 2.3761, -0.3], [2.1426, 2.6271, -0.3], [1.8414, 2.8463, -0.3], [1.5179, 3.0312, -0.3], [1.1761, 3.1794, -0.3], [0.8201, 3.2893, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_upper_right_17.add(mesh_under_arc_upper_right_17);
  meshes["under-arc-upper-right"] = mesh_under_arc_upper_right_17;
  colliders["under-arc-upper-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["under-arc-upper-right"] ??= [];
  destructionGroups["under-arc-upper-right"].push(node_under_arc_upper_right_17);

  const attachment_under_arc_lower_left_18 = null;
  const endpoint_under_arc_lower_left_18 = makeAttachmentEndpoint(attachment_under_arc_lower_left_18);
  const node_under_arc_lower_left_18 = new THREE.Group();
  node_under_arc_lower_left_18.name = "Under Arc Lower Left__pivot";
  if (endpoint_under_arc_lower_left_18) {
    node_under_arc_lower_left_18.position.copy(endpoint_under_arc_lower_left_18.start);
    node_under_arc_lower_left_18.rotation.set(0, 0, 0);
    node_under_arc_lower_left_18.scale.set(1, 1, 1);
  } else {
    node_under_arc_lower_left_18.position.set(0.0, 0.0, 0.0);
    node_under_arc_lower_left_18.rotation.set(0.0, 0.0, 0.0);
    node_under_arc_lower_left_18.scale.set(1.0, 1.0, 1.0);
  }
  node_under_arc_lower_left_18.userData.sculptComponent = {"id": "under-arc-lower-left", "name": "Under Arc Lower Left", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-3.3031, -0.7626, -0.3], [-3.2091, -1.0925, -0.3], [-3.0823, -1.4112, -0.3], [-2.9239, -1.7155, -0.3], [-2.7356, -2.0022, -0.3], [-2.5193, -2.2684, -0.3], [-2.2771, -2.5113, -0.3], [-2.0117, -2.7286, -0.3], [-1.7257, -2.9179, -0.3], [-1.4219, -3.0774, -0.3], [-1.1037, -3.2053, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_lower_left_18.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}};
  (nodes["root"] ?? root).add(node_under_arc_lower_left_18);
  nodes["under-arc-lower-left"] = node_under_arc_lower_left_18;
  const mesh_under_arc_lower_left_18Geometry = endpoint_under_arc_lower_left_18
    ? new THREE.CylinderGeometry(endpoint_under_arc_lower_left_18.endRadius, endpoint_under_arc_lower_left_18.baseRadius, endpoint_under_arc_lower_left_18.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-3.3031, -0.7626, -0.3], [-3.2091, -1.0925, -0.3], [-3.0823, -1.4112, -0.3], [-2.9239, -1.7155, -0.3], [-2.7356, -2.0022, -0.3], [-2.5193, -2.2684, -0.3], [-2.2771, -2.5113, -0.3], [-2.0117, -2.7286, -0.3], [-1.7257, -2.9179, -0.3], [-1.4219, -3.0774, -0.3], [-1.1037, -3.2053, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false});
  const mesh_under_arc_lower_left_18 = new THREE.Mesh(
    mesh_under_arc_lower_left_18Geometry,
    materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_under_arc_lower_left_18.name = "Under Arc Lower Left";
  if (endpoint_under_arc_lower_left_18) {
    mesh_under_arc_lower_left_18.position.copy(endpoint_under_arc_lower_left_18.midpoint);
    mesh_under_arc_lower_left_18.quaternion.copy(endpoint_under_arc_lower_left_18.quaternion);
  }
  mesh_under_arc_lower_left_18.castShadow = options.castShadow ?? true;
  mesh_under_arc_lower_left_18.receiveShadow = options.receiveShadow ?? true;
  mesh_under_arc_lower_left_18.userData.sculptComponent = {"id": "under-arc-lower-left", "name": "Under Arc Lower Left", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-3.3031, -0.7626, -0.3], [-3.2091, -1.0925, -0.3], [-3.0823, -1.4112, -0.3], [-2.9239, -1.7155, -0.3], [-2.7356, -2.0022, -0.3], [-2.5193, -2.2684, -0.3], [-2.2771, -2.5113, -0.3], [-2.0117, -2.7286, -0.3], [-1.7257, -2.9179, -0.3], [-1.4219, -3.0774, -0.3], [-1.1037, -3.2053, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_lower_left_18.add(mesh_under_arc_lower_left_18);
  meshes["under-arc-lower-left"] = mesh_under_arc_lower_left_18;
  colliders["under-arc-lower-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["under-arc-lower-left"] ??= [];
  destructionGroups["under-arc-lower-left"].push(node_under_arc_lower_left_18);

  const attachment_under_arc_lower_right_19 = null;
  const endpoint_under_arc_lower_right_19 = makeAttachmentEndpoint(attachment_under_arc_lower_right_19);
  const node_under_arc_lower_right_19 = new THREE.Group();
  node_under_arc_lower_right_19.name = "Under Arc Lower Right__pivot";
  if (endpoint_under_arc_lower_right_19) {
    node_under_arc_lower_right_19.position.copy(endpoint_under_arc_lower_right_19.start);
    node_under_arc_lower_right_19.rotation.set(0, 0, 0);
    node_under_arc_lower_right_19.scale.set(1, 1, 1);
  } else {
    node_under_arc_lower_right_19.position.set(0.0, 0.0, 0.0);
    node_under_arc_lower_right_19.rotation.set(0.0, 0.0, 0.0);
    node_under_arc_lower_right_19.scale.set(1.0, 1.0, 1.0);
  }
  node_under_arc_lower_right_19.userData.sculptComponent = {"id": "under-arc-lower-right", "name": "Under Arc Lower Right", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[1.1037, -3.2053, -0.3], [1.4219, -3.0774, -0.3], [1.7257, -2.9179, -0.3], [2.0117, -2.7286, -0.3], [2.2771, -2.5113, -0.3], [2.5193, -2.2684, -0.3], [2.7356, -2.0022, -0.3], [2.9239, -1.7155, -0.3], [3.0823, -1.4112, -0.3], [3.2091, -1.0925, -0.3], [3.3031, -0.7626, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_lower_right_19.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}};
  (nodes["root"] ?? root).add(node_under_arc_lower_right_19);
  nodes["under-arc-lower-right"] = node_under_arc_lower_right_19;
  const mesh_under_arc_lower_right_19Geometry = endpoint_under_arc_lower_right_19
    ? new THREE.CylinderGeometry(endpoint_under_arc_lower_right_19.endRadius, endpoint_under_arc_lower_right_19.baseRadius, endpoint_under_arc_lower_right_19.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[1.1037, -3.2053, -0.3], [1.4219, -3.0774, -0.3], [1.7257, -2.9179, -0.3], [2.0117, -2.7286, -0.3], [2.2771, -2.5113, -0.3], [2.5193, -2.2684, -0.3], [2.7356, -2.0022, -0.3], [2.9239, -1.7155, -0.3], [3.0823, -1.4112, -0.3], [3.2091, -1.0925, -0.3], [3.3031, -0.7626, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false});
  const mesh_under_arc_lower_right_19 = new THREE.Mesh(
    mesh_under_arc_lower_right_19Geometry,
    materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_under_arc_lower_right_19.name = "Under Arc Lower Right";
  if (endpoint_under_arc_lower_right_19) {
    mesh_under_arc_lower_right_19.position.copy(endpoint_under_arc_lower_right_19.midpoint);
    mesh_under_arc_lower_right_19.quaternion.copy(endpoint_under_arc_lower_right_19.quaternion);
  }
  mesh_under_arc_lower_right_19.castShadow = options.castShadow ?? true;
  mesh_under_arc_lower_right_19.receiveShadow = options.receiveShadow ?? true;
  mesh_under_arc_lower_right_19.userData.sculptComponent = {"id": "under-arc-lower-right", "name": "Under Arc Lower Right", "level": "meso", "role": "understructure-shell", "importance": 0.74, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[1.1037, -3.2053, -0.3], [1.4219, -3.0774, -0.3], [1.7257, -2.9179, -0.3], [2.0117, -2.7286, -0.3], [2.2771, -2.5113, -0.3], [2.5193, -2.2684, -0.3], [2.7356, -2.0022, -0.3], [2.9239, -1.7155, -0.3], [3.0823, -1.4112, -0.3], [3.2091, -1.0925, -0.3], [3.3031, -0.7626, -0.3]], "crossSection": {"points": [[-0.525, -0.17], [0.525, -0.17], [0.525, 0.17], [-0.525, 0.17]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 6.78, "height": 6.78, "depth": 0.34, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "under-arc-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_under_arc_lower_right_19.add(mesh_under_arc_lower_right_19);
  meshes["under-arc-lower-right"] = mesh_under_arc_lower_right_19;
  colliders["under-arc-lower-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [6.78, 6.78, 0.34], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["under-arc-lower-right"] ??= [];
  destructionGroups["under-arc-lower-right"].push(node_under_arc_lower_right_19);

  const attachment_cap_upper_left_20 = null;
  const endpoint_cap_upper_left_20 = makeAttachmentEndpoint(attachment_cap_upper_left_20);
  const node_cap_upper_left_20 = new THREE.Group();
  node_cap_upper_left_20.name = "Upper Left Inward Cap__pivot";
  if (endpoint_cap_upper_left_20) {
    node_cap_upper_left_20.position.copy(endpoint_cap_upper_left_20.start);
    node_cap_upper_left_20.rotation.set(0, 0, 0);
    node_cap_upper_left_20.scale.set(1, 1, 1);
  } else {
    node_cap_upper_left_20.position.set(0.0, 0.0, 0.0);
    node_cap_upper_left_20.rotation.set(0.0, 0.0, 0.0);
    node_cap_upper_left_20.scale.set(1.0, 1.0, 1.0);
  }
  node_cap_upper_left_20.userData.sculptComponent = {"id": "cap-upper-left", "name": "Upper Left Inward Cap", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-1.38, 3.18], [-0.78, 3.4], [-0.66, 3.08], [-1.18, 2.88]], "depth": 0.38}}, "parent": null, "attachment": null, "dimensions": {"width": 0.7199999999999999, "height": 0.52, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_upper_left_20.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_cap_upper_left_20);
  nodes["cap-upper-left"] = node_cap_upper_left_20;
  const mesh_cap_upper_left_20Geometry = endpoint_cap_upper_left_20
    ? new THREE.CylinderGeometry(endpoint_cap_upper_left_20.endRadius, endpoint_cap_upper_left_20.baseRadius, endpoint_cap_upper_left_20.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.38, 3.18], [-0.78, 3.4], [-0.66, 3.08], [-1.18, 2.88]], "depth": 0.38});
  const mesh_cap_upper_left_20 = new THREE.Mesh(
    mesh_cap_upper_left_20Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_upper_left_20.name = "Upper Left Inward Cap";
  if (endpoint_cap_upper_left_20) {
    mesh_cap_upper_left_20.position.copy(endpoint_cap_upper_left_20.midpoint);
    mesh_cap_upper_left_20.quaternion.copy(endpoint_cap_upper_left_20.quaternion);
  }
  mesh_cap_upper_left_20.castShadow = options.castShadow ?? true;
  mesh_cap_upper_left_20.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_upper_left_20.userData.sculptComponent = {"id": "cap-upper-left", "name": "Upper Left Inward Cap", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-1.38, 3.18], [-0.78, 3.4], [-0.66, 3.08], [-1.18, 2.88]], "depth": 0.38}}, "parent": null, "attachment": null, "dimensions": {"width": 0.7199999999999999, "height": 0.52, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_upper_left_20.add(mesh_cap_upper_left_20);
  meshes["cap-upper-left"] = mesh_cap_upper_left_20;
  colliders["cap-upper-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cap-upper-left"] ??= [];
  destructionGroups["cap-upper-left"].push(node_cap_upper_left_20);

  const attachment_cap_upper_right_21 = null;
  const endpoint_cap_upper_right_21 = makeAttachmentEndpoint(attachment_cap_upper_right_21);
  const node_cap_upper_right_21 = new THREE.Group();
  node_cap_upper_right_21.name = "Upper Right Inward Cap__pivot";
  if (endpoint_cap_upper_right_21) {
    node_cap_upper_right_21.position.copy(endpoint_cap_upper_right_21.start);
    node_cap_upper_right_21.rotation.set(0, 0, 0);
    node_cap_upper_right_21.scale.set(1, 1, 1);
  } else {
    node_cap_upper_right_21.position.set(0.0, 0.0, 0.0);
    node_cap_upper_right_21.rotation.set(0.0, 0.0, 0.0);
    node_cap_upper_right_21.scale.set(1.0, 1.0, 1.0);
  }
  node_cap_upper_right_21.userData.sculptComponent = {"id": "cap-upper-right", "name": "Upper Right Inward Cap", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[1.38, 3.18], [0.78, 3.4], [0.66, 3.08], [1.18, 2.88]], "depth": 0.38}}, "parent": null, "attachment": null, "dimensions": {"width": 0.7199999999999999, "height": 0.52, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_upper_right_21.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_cap_upper_right_21);
  nodes["cap-upper-right"] = node_cap_upper_right_21;
  const mesh_cap_upper_right_21Geometry = endpoint_cap_upper_right_21
    ? new THREE.CylinderGeometry(endpoint_cap_upper_right_21.endRadius, endpoint_cap_upper_right_21.baseRadius, endpoint_cap_upper_right_21.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.38, 3.18], [0.78, 3.4], [0.66, 3.08], [1.18, 2.88]], "depth": 0.38});
  const mesh_cap_upper_right_21 = new THREE.Mesh(
    mesh_cap_upper_right_21Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_upper_right_21.name = "Upper Right Inward Cap";
  if (endpoint_cap_upper_right_21) {
    mesh_cap_upper_right_21.position.copy(endpoint_cap_upper_right_21.midpoint);
    mesh_cap_upper_right_21.quaternion.copy(endpoint_cap_upper_right_21.quaternion);
  }
  mesh_cap_upper_right_21.castShadow = options.castShadow ?? true;
  mesh_cap_upper_right_21.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_upper_right_21.userData.sculptComponent = {"id": "cap-upper-right", "name": "Upper Right Inward Cap", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[1.38, 3.18], [0.78, 3.4], [0.66, 3.08], [1.18, 2.88]], "depth": 0.38}}, "parent": null, "attachment": null, "dimensions": {"width": 0.7199999999999999, "height": 0.52, "depth": 0.38, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_upper_right_21.add(mesh_cap_upper_right_21);
  meshes["cap-upper-right"] = mesh_cap_upper_right_21;
  colliders["cap-upper-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.7199999999999999, 0.52, 0.38], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cap-upper-right"] ??= [];
  destructionGroups["cap-upper-right"].push(node_cap_upper_right_21);

  const attachment_cap_lower_left_22 = null;
  const endpoint_cap_lower_left_22 = makeAttachmentEndpoint(attachment_cap_lower_left_22);
  const node_cap_lower_left_22 = new THREE.Group();
  node_cap_lower_left_22.name = "Lower Left Inward Cap__pivot";
  if (endpoint_cap_lower_left_22) {
    node_cap_lower_left_22.position.copy(endpoint_cap_lower_left_22.start);
    node_cap_lower_left_22.rotation.set(0, 0, 0);
    node_cap_lower_left_22.scale.set(1, 1, 1);
  } else {
    node_cap_lower_left_22.position.set(0.0, 0.0, 0.0);
    node_cap_lower_left_22.rotation.set(0.0, 0.0, 0.0);
    node_cap_lower_left_22.scale.set(1.0, 1.0, 1.0);
  }
  node_cap_lower_left_22.userData.sculptComponent = {"id": "cap-lower-left", "name": "Lower Left Inward Cap", "level": "meso", "role": "landmark", "importance": 0.72, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-2.7, -2.05], [-2, -2.35], [-1.48, -2.92], [-2.35, -2.72]], "depth": 0.42}}, "parent": null, "attachment": null, "dimensions": {"width": 1.2200000000000002, "height": 0.8700000000000001, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_lower_left_22.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_cap_lower_left_22);
  nodes["cap-lower-left"] = node_cap_lower_left_22;
  const mesh_cap_lower_left_22Geometry = endpoint_cap_lower_left_22
    ? new THREE.CylinderGeometry(endpoint_cap_lower_left_22.endRadius, endpoint_cap_lower_left_22.baseRadius, endpoint_cap_lower_left_22.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.7, -2.05], [-2, -2.35], [-1.48, -2.92], [-2.35, -2.72]], "depth": 0.42});
  const mesh_cap_lower_left_22 = new THREE.Mesh(
    mesh_cap_lower_left_22Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_lower_left_22.name = "Lower Left Inward Cap";
  if (endpoint_cap_lower_left_22) {
    mesh_cap_lower_left_22.position.copy(endpoint_cap_lower_left_22.midpoint);
    mesh_cap_lower_left_22.quaternion.copy(endpoint_cap_lower_left_22.quaternion);
  }
  mesh_cap_lower_left_22.castShadow = options.castShadow ?? true;
  mesh_cap_lower_left_22.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_lower_left_22.userData.sculptComponent = {"id": "cap-lower-left", "name": "Lower Left Inward Cap", "level": "meso", "role": "landmark", "importance": 0.72, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-2.7, -2.05], [-2, -2.35], [-1.48, -2.92], [-2.35, -2.72]], "depth": 0.42}}, "parent": null, "attachment": null, "dimensions": {"width": 1.2200000000000002, "height": 0.8700000000000001, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_lower_left_22.add(mesh_cap_lower_left_22);
  meshes["cap-lower-left"] = mesh_cap_lower_left_22;
  colliders["cap-lower-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cap-lower-left"] ??= [];
  destructionGroups["cap-lower-left"].push(node_cap_lower_left_22);

  const attachment_cap_lower_right_23 = null;
  const endpoint_cap_lower_right_23 = makeAttachmentEndpoint(attachment_cap_lower_right_23);
  const node_cap_lower_right_23 = new THREE.Group();
  node_cap_lower_right_23.name = "Lower Right Inward Cap__pivot";
  if (endpoint_cap_lower_right_23) {
    node_cap_lower_right_23.position.copy(endpoint_cap_lower_right_23.start);
    node_cap_lower_right_23.rotation.set(0, 0, 0);
    node_cap_lower_right_23.scale.set(1, 1, 1);
  } else {
    node_cap_lower_right_23.position.set(0.0, 0.0, 0.0);
    node_cap_lower_right_23.rotation.set(0.0, 0.0, 0.0);
    node_cap_lower_right_23.scale.set(1.0, 1.0, 1.0);
  }
  node_cap_lower_right_23.userData.sculptComponent = {"id": "cap-lower-right", "name": "Lower Right Inward Cap", "level": "meso", "role": "landmark", "importance": 0.72, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[2.7, -2.05], [2, -2.35], [1.48, -2.92], [2.35, -2.72]], "depth": 0.42}}, "parent": null, "attachment": null, "dimensions": {"width": 1.2200000000000002, "height": 0.8700000000000001, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_lower_right_23.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}};
  (nodes["root"] ?? root).add(node_cap_lower_right_23);
  nodes["cap-lower-right"] = node_cap_lower_right_23;
  const mesh_cap_lower_right_23Geometry = endpoint_cap_lower_right_23
    ? new THREE.CylinderGeometry(endpoint_cap_lower_right_23.endRadius, endpoint_cap_lower_right_23.baseRadius, endpoint_cap_lower_right_23.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.7, -2.05], [2, -2.35], [1.48, -2.92], [2.35, -2.72]], "depth": 0.42});
  const mesh_cap_lower_right_23 = new THREE.Mesh(
    mesh_cap_lower_right_23Geometry,
    materialMap["armor-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_lower_right_23.name = "Lower Right Inward Cap";
  if (endpoint_cap_lower_right_23) {
    mesh_cap_lower_right_23.position.copy(endpoint_cap_lower_right_23.midpoint);
    mesh_cap_lower_right_23.quaternion.copy(endpoint_cap_lower_right_23.quaternion);
  }
  mesh_cap_lower_right_23.castShadow = options.castShadow ?? true;
  mesh_cap_lower_right_23.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_lower_right_23.userData.sculptComponent = {"id": "cap-lower-right", "name": "Lower Right Inward Cap", "level": "meso", "role": "landmark", "importance": 0.72, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[2.7, -2.05], [2, -2.35], [1.48, -2.92], [2.35, -2.72]], "depth": 0.42}}, "parent": null, "attachment": null, "dimensions": {"width": 1.2200000000000002, "height": 0.8700000000000001, "depth": 0.42, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cap-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "armor-metal"}}, "material": "armor-metal", "materialLayers": ["armor-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 34, 51, 1)", "secondaryAlbedo": "rgba(41, 61, 84, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(20, 34, 51, 1)"}, {"position": 1, "color": "rgba(41, 61, 84, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.012, "normalPattern": "subtle directional brushed-metal breakup", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "restrained blue-grey bevel response", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_cap_lower_right_23.add(mesh_cap_lower_right_23);
  meshes["cap-lower-right"] = mesh_cap_lower_right_23;
  colliders["cap-lower-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.2200000000000002, 0.8700000000000001, 0.42], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cap-lower-right"] ??= [];
  destructionGroups["cap-lower-right"].push(node_cap_lower_right_23);

  const attachment_prong_backing_left_24 = null;
  const endpoint_prong_backing_left_24 = makeAttachmentEndpoint(attachment_prong_backing_left_24);
  const node_prong_backing_left_24 = new THREE.Group();
  node_prong_backing_left_24.name = "Prong Backing Left__pivot";
  if (endpoint_prong_backing_left_24) {
    node_prong_backing_left_24.position.copy(endpoint_prong_backing_left_24.start);
    node_prong_backing_left_24.rotation.set(0, 0, 0);
    node_prong_backing_left_24.scale.set(1, 1, 1);
  } else {
    node_prong_backing_left_24.position.set(0.0, 0.0, 0.0);
    node_prong_backing_left_24.rotation.set(0.0, 0.0, 0.0);
    node_prong_backing_left_24.scale.set(1.0, 1.0, 1.0);
  }
  node_prong_backing_left_24.userData.sculptComponent = {"id": "prong-backing-left", "name": "Prong Backing Left", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.85, 2.72, -0.25], [-1.05, 1.8, -0.27], [-0.8, 0.78, -0.28], [-0.22, -0.35, -0.28]], "crossSection": {"points": [[-0.26, -0.15], [0.26, -0.15], [0.26, 0.15], [-0.26, 0.15]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.3, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "prong-backing-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_prong_backing_left_24.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "prong-backing-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}};
  (nodes["root"] ?? root).add(node_prong_backing_left_24);
  nodes["prong-backing-left"] = node_prong_backing_left_24;
  const mesh_prong_backing_left_24Geometry = endpoint_prong_backing_left_24
    ? new THREE.CylinderGeometry(endpoint_prong_backing_left_24.endRadius, endpoint_prong_backing_left_24.baseRadius, endpoint_prong_backing_left_24.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-0.85, 2.72, -0.25], [-1.05, 1.8, -0.27], [-0.8, 0.78, -0.28], [-0.22, -0.35, -0.28]], "crossSection": {"points": [[-0.26, -0.15], [0.26, -0.15], [0.26, 0.15], [-0.26, 0.15]]}, "closed": false});
  const mesh_prong_backing_left_24 = new THREE.Mesh(
    mesh_prong_backing_left_24Geometry,
    materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_prong_backing_left_24.name = "Prong Backing Left";
  if (endpoint_prong_backing_left_24) {
    mesh_prong_backing_left_24.position.copy(endpoint_prong_backing_left_24.midpoint);
    mesh_prong_backing_left_24.quaternion.copy(endpoint_prong_backing_left_24.quaternion);
  }
  mesh_prong_backing_left_24.castShadow = options.castShadow ?? true;
  mesh_prong_backing_left_24.receiveShadow = options.receiveShadow ?? true;
  mesh_prong_backing_left_24.userData.sculptComponent = {"id": "prong-backing-left", "name": "Prong Backing Left", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.85, 2.72, -0.25], [-1.05, 1.8, -0.27], [-0.8, 0.78, -0.28], [-0.22, -0.35, -0.28]], "crossSection": {"points": [[-0.26, -0.15], [0.26, -0.15], [0.26, 0.15], [-0.26, 0.15]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.3, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "prong-backing-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_prong_backing_left_24.add(mesh_prong_backing_left_24);
  meshes["prong-backing-left"] = mesh_prong_backing_left_24;
  colliders["prong-backing-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["prong-backing-left"] ??= [];
  destructionGroups["prong-backing-left"].push(node_prong_backing_left_24);

  const attachment_prong_backing_right_25 = null;
  const endpoint_prong_backing_right_25 = makeAttachmentEndpoint(attachment_prong_backing_right_25);
  const node_prong_backing_right_25 = new THREE.Group();
  node_prong_backing_right_25.name = "Prong Backing Right__pivot";
  if (endpoint_prong_backing_right_25) {
    node_prong_backing_right_25.position.copy(endpoint_prong_backing_right_25.start);
    node_prong_backing_right_25.rotation.set(0, 0, 0);
    node_prong_backing_right_25.scale.set(1, 1, 1);
  } else {
    node_prong_backing_right_25.position.set(0.0, 0.0, 0.0);
    node_prong_backing_right_25.rotation.set(0.0, 0.0, 0.0);
    node_prong_backing_right_25.scale.set(1.0, 1.0, 1.0);
  }
  node_prong_backing_right_25.userData.sculptComponent = {"id": "prong-backing-right", "name": "Prong Backing Right", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.85, 2.72, -0.25], [1.05, 1.8, -0.27], [0.8, 0.78, -0.28], [0.22, -0.35, -0.28]], "crossSection": {"points": [[-0.26, -0.15], [0.26, -0.15], [0.26, 0.15], [-0.26, 0.15]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.3, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "prong-backing-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_prong_backing_right_25.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "prong-backing-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}};
  (nodes["root"] ?? root).add(node_prong_backing_right_25);
  nodes["prong-backing-right"] = node_prong_backing_right_25;
  const mesh_prong_backing_right_25Geometry = endpoint_prong_backing_right_25
    ? new THREE.CylinderGeometry(endpoint_prong_backing_right_25.endRadius, endpoint_prong_backing_right_25.baseRadius, endpoint_prong_backing_right_25.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[0.85, 2.72, -0.25], [1.05, 1.8, -0.27], [0.8, 0.78, -0.28], [0.22, -0.35, -0.28]], "crossSection": {"points": [[-0.26, -0.15], [0.26, -0.15], [0.26, 0.15], [-0.26, 0.15]]}, "closed": false});
  const mesh_prong_backing_right_25 = new THREE.Mesh(
    mesh_prong_backing_right_25Geometry,
    materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_prong_backing_right_25.name = "Prong Backing Right";
  if (endpoint_prong_backing_right_25) {
    mesh_prong_backing_right_25.position.copy(endpoint_prong_backing_right_25.midpoint);
    mesh_prong_backing_right_25.quaternion.copy(endpoint_prong_backing_right_25.quaternion);
  }
  mesh_prong_backing_right_25.castShadow = options.castShadow ?? true;
  mesh_prong_backing_right_25.receiveShadow = options.receiveShadow ?? true;
  mesh_prong_backing_right_25.userData.sculptComponent = {"id": "prong-backing-right", "name": "Prong Backing Right", "level": "meso", "role": "landmark", "importance": 0.7, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.85, 2.72, -0.25], [1.05, 1.8, -0.27], [0.8, 0.78, -0.28], [0.22, -0.35, -0.28]], "crossSection": {"points": [[-0.26, -0.15], [0.26, -0.15], [0.26, 0.15], [-0.26, 0.15]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.3, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "prong-backing-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "support-metal"}}, "material": "support-metal", "materialLayers": ["support-metal"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(7, 17, 28, 1)", "secondaryAlbedo": "rgba(16, 34, 49, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(7, 17, 28, 1)"}, {"position": 1, "color": "rgba(16, 34, 49, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "darken stacked recesses", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass"};
  node_prong_backing_right_25.add(mesh_prong_backing_right_25);
  meshes["prong-backing-right"] = mesh_prong_backing_right_25;
  colliders["prong-backing-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.3], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["prong-backing-right"] ??= [];
  destructionGroups["prong-backing-right"].push(node_prong_backing_right_25);

  const attachment_cyan_channel_upper_left_26 = null;
  const endpoint_cyan_channel_upper_left_26 = makeAttachmentEndpoint(attachment_cyan_channel_upper_left_26);
  const node_cyan_channel_upper_left_26 = new THREE.Group();
  node_cyan_channel_upper_left_26.name = "Cyan Channel Upper Left__pivot";
  if (endpoint_cyan_channel_upper_left_26) {
    node_cyan_channel_upper_left_26.position.copy(endpoint_cyan_channel_upper_left_26.start);
    node_cyan_channel_upper_left_26.rotation.set(0, 0, 0);
    node_cyan_channel_upper_left_26.scale.set(1, 1, 1);
  } else {
    node_cyan_channel_upper_left_26.position.set(0.0, 0.0, 0.0);
    node_cyan_channel_upper_left_26.rotation.set(0.0, 0.0, 0.0);
    node_cyan_channel_upper_left_26.scale.set(1.0, 1.0, 1.0);
  }
  node_cyan_channel_upper_left_26.userData.sculptComponent = {"id": "cyan-channel-upper-left", "name": "Cyan Channel Upper Left", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-1.1125, 3.4238, 0.5], [-2.4552, 2.6329, 0.5], [-3.3379, 1.3486, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.2, "height": 7.2, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_upper_left_26.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["root"] ?? root).add(node_cyan_channel_upper_left_26);
  nodes["cyan-channel-upper-left"] = node_cyan_channel_upper_left_26;
  const mesh_cyan_channel_upper_left_26Geometry = endpoint_cyan_channel_upper_left_26
    ? new THREE.CylinderGeometry(endpoint_cyan_channel_upper_left_26.endRadius, endpoint_cyan_channel_upper_left_26.baseRadius, endpoint_cyan_channel_upper_left_26.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-1.1125, 3.4238, 0.5], [-2.4552, 2.6329, 0.5], [-3.3379, 1.3486, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false});
  const mesh_cyan_channel_upper_left_26 = new THREE.Mesh(
    mesh_cyan_channel_upper_left_26Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cyan_channel_upper_left_26.name = "Cyan Channel Upper Left";
  if (endpoint_cyan_channel_upper_left_26) {
    mesh_cyan_channel_upper_left_26.position.copy(endpoint_cyan_channel_upper_left_26.midpoint);
    mesh_cyan_channel_upper_left_26.quaternion.copy(endpoint_cyan_channel_upper_left_26.quaternion);
  }
  mesh_cyan_channel_upper_left_26.castShadow = options.castShadow ?? true;
  mesh_cyan_channel_upper_left_26.receiveShadow = options.receiveShadow ?? true;
  mesh_cyan_channel_upper_left_26.userData.sculptComponent = {"id": "cyan-channel-upper-left", "name": "Cyan Channel Upper Left", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-1.1125, 3.4238, 0.5], [-2.4552, 2.6329, 0.5], [-3.3379, 1.3486, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.2, "height": 7.2, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-upper-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_upper_left_26.add(mesh_cyan_channel_upper_left_26);
  meshes["cyan-channel-upper-left"] = mesh_cyan_channel_upper_left_26;
  colliders["cyan-channel-upper-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cyan-channel-upper-left"] ??= [];
  destructionGroups["cyan-channel-upper-left"].push(node_cyan_channel_upper_left_26);

  const attachment_cyan_channel_upper_right_27 = null;
  const endpoint_cyan_channel_upper_right_27 = makeAttachmentEndpoint(attachment_cyan_channel_upper_right_27);
  const node_cyan_channel_upper_right_27 = new THREE.Group();
  node_cyan_channel_upper_right_27.name = "Cyan Channel Upper Right__pivot";
  if (endpoint_cyan_channel_upper_right_27) {
    node_cyan_channel_upper_right_27.position.copy(endpoint_cyan_channel_upper_right_27.start);
    node_cyan_channel_upper_right_27.rotation.set(0, 0, 0);
    node_cyan_channel_upper_right_27.scale.set(1, 1, 1);
  } else {
    node_cyan_channel_upper_right_27.position.set(0.0, 0.0, 0.0);
    node_cyan_channel_upper_right_27.rotation.set(0.0, 0.0, 0.0);
    node_cyan_channel_upper_right_27.scale.set(1.0, 1.0, 1.0);
  }
  node_cyan_channel_upper_right_27.userData.sculptComponent = {"id": "cyan-channel-upper-right", "name": "Cyan Channel Upper Right", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[3.3379, 1.3486, 0.5], [2.5008, 2.5896, 0.5], [1.2313, 3.3829, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.2, "height": 7.2, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_upper_right_27.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["root"] ?? root).add(node_cyan_channel_upper_right_27);
  nodes["cyan-channel-upper-right"] = node_cyan_channel_upper_right_27;
  const mesh_cyan_channel_upper_right_27Geometry = endpoint_cyan_channel_upper_right_27
    ? new THREE.CylinderGeometry(endpoint_cyan_channel_upper_right_27.endRadius, endpoint_cyan_channel_upper_right_27.baseRadius, endpoint_cyan_channel_upper_right_27.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[3.3379, 1.3486, 0.5], [2.5008, 2.5896, 0.5], [1.2313, 3.3829, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false});
  const mesh_cyan_channel_upper_right_27 = new THREE.Mesh(
    mesh_cyan_channel_upper_right_27Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cyan_channel_upper_right_27.name = "Cyan Channel Upper Right";
  if (endpoint_cyan_channel_upper_right_27) {
    mesh_cyan_channel_upper_right_27.position.copy(endpoint_cyan_channel_upper_right_27.midpoint);
    mesh_cyan_channel_upper_right_27.quaternion.copy(endpoint_cyan_channel_upper_right_27.quaternion);
  }
  mesh_cyan_channel_upper_right_27.castShadow = options.castShadow ?? true;
  mesh_cyan_channel_upper_right_27.receiveShadow = options.receiveShadow ?? true;
  mesh_cyan_channel_upper_right_27.userData.sculptComponent = {"id": "cyan-channel-upper-right", "name": "Cyan Channel Upper Right", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[3.3379, 1.3486, 0.5], [2.5008, 2.5896, 0.5], [1.2313, 3.3829, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.2, "height": 7.2, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-upper-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_upper_right_27.add(mesh_cyan_channel_upper_right_27);
  meshes["cyan-channel-upper-right"] = mesh_cyan_channel_upper_right_27;
  colliders["cyan-channel-upper-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.2, 7.2, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cyan-channel-upper-right"] ??= [];
  destructionGroups["cyan-channel-upper-right"].push(node_cyan_channel_upper_right_27);

  const attachment_cyan_channel_lower_left_28 = null;
  const endpoint_cyan_channel_lower_left_28 = makeAttachmentEndpoint(attachment_cyan_channel_lower_left_28);
  const node_cyan_channel_lower_left_28 = new THREE.Group();
  node_cyan_channel_lower_left_28.name = "Cyan Channel Lower Left__pivot";
  if (endpoint_cyan_channel_lower_left_28) {
    node_cyan_channel_lower_left_28.position.copy(endpoint_cyan_channel_lower_left_28.start);
    node_cyan_channel_lower_left_28.rotation.set(0, 0, 0);
    node_cyan_channel_lower_left_28.scale.set(1, 1, 1);
  } else {
    node_cyan_channel_lower_left_28.position.set(0.0, 0.0, 0.0);
    node_cyan_channel_lower_left_28.rotation.set(0.0, 0.0, 0.0);
    node_cyan_channel_lower_left_28.scale.set(1.0, 1.0, 1.0);
  }
  node_cyan_channel_lower_left_28.userData.sculptComponent = {"id": "cyan-channel-lower-left", "name": "Cyan Channel Lower Left", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-3.2446, -1.513, 0.5], [-2.6395, -2.4186, 0.5], [-1.79, -3.1004, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.16, "height": 7.16, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_lower_left_28.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["root"] ?? root).add(node_cyan_channel_lower_left_28);
  nodes["cyan-channel-lower-left"] = node_cyan_channel_lower_left_28;
  const mesh_cyan_channel_lower_left_28Geometry = endpoint_cyan_channel_lower_left_28
    ? new THREE.CylinderGeometry(endpoint_cyan_channel_lower_left_28.endRadius, endpoint_cyan_channel_lower_left_28.baseRadius, endpoint_cyan_channel_lower_left_28.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-3.2446, -1.513, 0.5], [-2.6395, -2.4186, 0.5], [-1.79, -3.1004, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false});
  const mesh_cyan_channel_lower_left_28 = new THREE.Mesh(
    mesh_cyan_channel_lower_left_28Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cyan_channel_lower_left_28.name = "Cyan Channel Lower Left";
  if (endpoint_cyan_channel_lower_left_28) {
    mesh_cyan_channel_lower_left_28.position.copy(endpoint_cyan_channel_lower_left_28.midpoint);
    mesh_cyan_channel_lower_left_28.quaternion.copy(endpoint_cyan_channel_lower_left_28.quaternion);
  }
  mesh_cyan_channel_lower_left_28.castShadow = options.castShadow ?? true;
  mesh_cyan_channel_lower_left_28.receiveShadow = options.receiveShadow ?? true;
  mesh_cyan_channel_lower_left_28.userData.sculptComponent = {"id": "cyan-channel-lower-left", "name": "Cyan Channel Lower Left", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-3.2446, -1.513, 0.5], [-2.6395, -2.4186, 0.5], [-1.79, -3.1004, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.16, "height": 7.16, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-lower-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_lower_left_28.add(mesh_cyan_channel_lower_left_28);
  meshes["cyan-channel-lower-left"] = mesh_cyan_channel_lower_left_28;
  colliders["cyan-channel-lower-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cyan-channel-lower-left"] ??= [];
  destructionGroups["cyan-channel-lower-left"].push(node_cyan_channel_lower_left_28);

  const attachment_cyan_channel_lower_right_29 = null;
  const endpoint_cyan_channel_lower_right_29 = makeAttachmentEndpoint(attachment_cyan_channel_lower_right_29);
  const node_cyan_channel_lower_right_29 = new THREE.Group();
  node_cyan_channel_lower_right_29.name = "Cyan Channel Lower Right__pivot";
  if (endpoint_cyan_channel_lower_right_29) {
    node_cyan_channel_lower_right_29.position.copy(endpoint_cyan_channel_lower_right_29.start);
    node_cyan_channel_lower_right_29.rotation.set(0, 0, 0);
    node_cyan_channel_lower_right_29.scale.set(1, 1, 1);
  } else {
    node_cyan_channel_lower_right_29.position.set(0.0, 0.0, 0.0);
    node_cyan_channel_lower_right_29.rotation.set(0.0, 0.0, 0.0);
    node_cyan_channel_lower_right_29.scale.set(1.0, 1.0, 1.0);
  }
  node_cyan_channel_lower_right_29.userData.sculptComponent = {"id": "cyan-channel-lower-right", "name": "Cyan Channel Lower Right", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[1.79, -3.1004, 0.5], [2.7019, -2.3487, 0.5], [3.3193, -1.3411, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.16, "height": 7.16, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_lower_right_29.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["root"] ?? root).add(node_cyan_channel_lower_right_29);
  nodes["cyan-channel-lower-right"] = node_cyan_channel_lower_right_29;
  const mesh_cyan_channel_lower_right_29Geometry = endpoint_cyan_channel_lower_right_29
    ? new THREE.CylinderGeometry(endpoint_cyan_channel_lower_right_29.endRadius, endpoint_cyan_channel_lower_right_29.baseRadius, endpoint_cyan_channel_lower_right_29.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[1.79, -3.1004, 0.5], [2.7019, -2.3487, 0.5], [3.3193, -1.3411, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false});
  const mesh_cyan_channel_lower_right_29 = new THREE.Mesh(
    mesh_cyan_channel_lower_right_29Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cyan_channel_lower_right_29.name = "Cyan Channel Lower Right";
  if (endpoint_cyan_channel_lower_right_29) {
    mesh_cyan_channel_lower_right_29.position.copy(endpoint_cyan_channel_lower_right_29.midpoint);
    mesh_cyan_channel_lower_right_29.quaternion.copy(endpoint_cyan_channel_lower_right_29.quaternion);
  }
  mesh_cyan_channel_lower_right_29.castShadow = options.castShadow ?? true;
  mesh_cyan_channel_lower_right_29.receiveShadow = options.receiveShadow ?? true;
  mesh_cyan_channel_lower_right_29.userData.sculptComponent = {"id": "cyan-channel-lower-right", "name": "Cyan Channel Lower Right", "level": "micro", "role": "energy-inlay", "importance": 0.62, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[1.79, -3.1004, 0.5], [2.7019, -2.3487, 0.5], [3.3193, -1.3411, 0.5]], "crossSection": {"points": [[-0.0375, -0.0275], [0.0375, -0.0275], [0.0375, 0.0275], [-0.0375, 0.0275]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.16, "height": 7.16, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-channel-lower-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_channel_lower_right_29.add(mesh_cyan_channel_lower_right_29);
  meshes["cyan-channel-lower-right"] = mesh_cyan_channel_lower_right_29;
  colliders["cyan-channel-lower-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.16, 7.16, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cyan-channel-lower-right"] ??= [];
  destructionGroups["cyan-channel-lower-right"].push(node_cyan_channel_lower_right_29);

  const attachment_cyan_prong_left_30 = null;
  const endpoint_cyan_prong_left_30 = makeAttachmentEndpoint(attachment_cyan_prong_left_30);
  const node_cyan_prong_left_30 = new THREE.Group();
  node_cyan_prong_left_30.name = "Cyan Prong Channel Left__pivot";
  if (endpoint_cyan_prong_left_30) {
    node_cyan_prong_left_30.position.copy(endpoint_cyan_prong_left_30.start);
    node_cyan_prong_left_30.rotation.set(0, 0, 0);
    node_cyan_prong_left_30.scale.set(1, 1, 1);
  } else {
    node_cyan_prong_left_30.position.set(0.0, 0.0, 0.0);
    node_cyan_prong_left_30.rotation.set(0.0, 0.0, 0.0);
    node_cyan_prong_left_30.scale.set(1.0, 1.0, 1.0);
  }
  node_cyan_prong_left_30.userData.sculptComponent = {"id": "cyan-prong-left", "name": "Cyan Prong Channel Left", "level": "micro", "role": "energy-inlay", "importance": 0.68, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.65, 2.55, 0.27], [-0.74, 1.4, 0.27], [-0.4, 0.28, 0.27], [0.15, -0.55, 0.27]], "crossSection": {"points": [[-0.0225, -0.0175], [0.0225, -0.0175], [0.0225, 0.0175], [-0.0225, 0.0175]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.035, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-prong-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_prong_left_30.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-prong-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["root"] ?? root).add(node_cyan_prong_left_30);
  nodes["cyan-prong-left"] = node_cyan_prong_left_30;
  const mesh_cyan_prong_left_30Geometry = endpoint_cyan_prong_left_30
    ? new THREE.CylinderGeometry(endpoint_cyan_prong_left_30.endRadius, endpoint_cyan_prong_left_30.baseRadius, endpoint_cyan_prong_left_30.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-0.65, 2.55, 0.27], [-0.74, 1.4, 0.27], [-0.4, 0.28, 0.27], [0.15, -0.55, 0.27]], "crossSection": {"points": [[-0.0225, -0.0175], [0.0225, -0.0175], [0.0225, 0.0175], [-0.0225, 0.0175]]}, "closed": false});
  const mesh_cyan_prong_left_30 = new THREE.Mesh(
    mesh_cyan_prong_left_30Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cyan_prong_left_30.name = "Cyan Prong Channel Left";
  if (endpoint_cyan_prong_left_30) {
    mesh_cyan_prong_left_30.position.copy(endpoint_cyan_prong_left_30.midpoint);
    mesh_cyan_prong_left_30.quaternion.copy(endpoint_cyan_prong_left_30.quaternion);
  }
  mesh_cyan_prong_left_30.castShadow = options.castShadow ?? true;
  mesh_cyan_prong_left_30.receiveShadow = options.receiveShadow ?? true;
  mesh_cyan_prong_left_30.userData.sculptComponent = {"id": "cyan-prong-left", "name": "Cyan Prong Channel Left", "level": "micro", "role": "energy-inlay", "importance": 0.68, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-0.65, 2.55, 0.27], [-0.74, 1.4, 0.27], [-0.4, 0.28, 0.27], [0.15, -0.55, 0.27]], "crossSection": {"points": [[-0.0225, -0.0175], [0.0225, -0.0175], [0.0225, 0.0175], [-0.0225, 0.0175]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.035, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-prong-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_prong_left_30.add(mesh_cyan_prong_left_30);
  meshes["cyan-prong-left"] = mesh_cyan_prong_left_30;
  colliders["cyan-prong-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cyan-prong-left"] ??= [];
  destructionGroups["cyan-prong-left"].push(node_cyan_prong_left_30);

  const attachment_cyan_prong_right_31 = null;
  const endpoint_cyan_prong_right_31 = makeAttachmentEndpoint(attachment_cyan_prong_right_31);
  const node_cyan_prong_right_31 = new THREE.Group();
  node_cyan_prong_right_31.name = "Cyan Prong Channel Right__pivot";
  if (endpoint_cyan_prong_right_31) {
    node_cyan_prong_right_31.position.copy(endpoint_cyan_prong_right_31.start);
    node_cyan_prong_right_31.rotation.set(0, 0, 0);
    node_cyan_prong_right_31.scale.set(1, 1, 1);
  } else {
    node_cyan_prong_right_31.position.set(0.0, 0.0, 0.0);
    node_cyan_prong_right_31.rotation.set(0.0, 0.0, 0.0);
    node_cyan_prong_right_31.scale.set(1.0, 1.0, 1.0);
  }
  node_cyan_prong_right_31.userData.sculptComponent = {"id": "cyan-prong-right", "name": "Cyan Prong Channel Right", "level": "micro", "role": "energy-inlay", "importance": 0.68, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.65, 2.55, 0.27], [0.74, 1.4, 0.27], [0.4, 0.28, 0.27], [-0.15, -0.55, 0.27]], "crossSection": {"points": [[-0.0225, -0.0175], [0.0225, -0.0175], [0.0225, 0.0175], [-0.0225, 0.0175]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.035, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-prong-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_prong_right_31.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-prong-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["root"] ?? root).add(node_cyan_prong_right_31);
  nodes["cyan-prong-right"] = node_cyan_prong_right_31;
  const mesh_cyan_prong_right_31Geometry = endpoint_cyan_prong_right_31
    ? new THREE.CylinderGeometry(endpoint_cyan_prong_right_31.endRadius, endpoint_cyan_prong_right_31.baseRadius, endpoint_cyan_prong_right_31.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[0.65, 2.55, 0.27], [0.74, 1.4, 0.27], [0.4, 0.28, 0.27], [-0.15, -0.55, 0.27]], "crossSection": {"points": [[-0.0225, -0.0175], [0.0225, -0.0175], [0.0225, 0.0175], [-0.0225, 0.0175]]}, "closed": false});
  const mesh_cyan_prong_right_31 = new THREE.Mesh(
    mesh_cyan_prong_right_31Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cyan_prong_right_31.name = "Cyan Prong Channel Right";
  if (endpoint_cyan_prong_right_31) {
    mesh_cyan_prong_right_31.position.copy(endpoint_cyan_prong_right_31.midpoint);
    mesh_cyan_prong_right_31.quaternion.copy(endpoint_cyan_prong_right_31.quaternion);
  }
  mesh_cyan_prong_right_31.castShadow = options.castShadow ?? true;
  mesh_cyan_prong_right_31.receiveShadow = options.receiveShadow ?? true;
  mesh_cyan_prong_right_31.userData.sculptComponent = {"id": "cyan-prong-right", "name": "Cyan Prong Channel Right", "level": "micro", "role": "energy-inlay", "importance": 0.68, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.", "geometryDescriptor": {"topologyIntent": "Taper-like curved landmark represented by a compact swept hard-surface profile.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[0.65, 2.55, 0.27], [0.74, 1.4, 0.27], [0.4, 0.28, 0.27], [-0.15, -0.55, 0.27]], "crossSection": {"points": [[-0.0225, -0.0175], [0.0225, -0.0175], [0.0225, 0.0175], [-0.0225, 0.0175]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 1.4, "height": 3.5, "depth": 0.035, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "cyan-prong-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_cyan_prong_right_31.add(mesh_cyan_prong_right_31);
  meshes["cyan-prong-right"] = mesh_cyan_prong_right_31;
  colliders["cyan-prong-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.4, 3.5, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["cyan-prong-right"] ??= [];
  destructionGroups["cyan-prong-right"].push(node_cyan_prong_right_31);

  const attachment_violet_accent_left_32 = null;
  const endpoint_violet_accent_left_32 = makeAttachmentEndpoint(attachment_violet_accent_left_32);
  const node_violet_accent_left_32 = new THREE.Group();
  node_violet_accent_left_32.name = "Violet Accent Left__pivot";
  if (endpoint_violet_accent_left_32) {
    node_violet_accent_left_32.position.copy(endpoint_violet_accent_left_32.start);
    node_violet_accent_left_32.rotation.set(0, 0, 0);
    node_violet_accent_left_32.scale.set(1, 1, 1);
  } else {
    node_violet_accent_left_32.position.set(0.0, 0.0, 0.0);
    node_violet_accent_left_32.rotation.set(0.0, 0.0, 0.0);
    node_violet_accent_left_32.scale.set(1.0, 1.0, 1.0);
  }
  node_violet_accent_left_32.userData.sculptComponent = {"id": "violet-accent-left", "name": "Violet Accent Left", "level": "micro", "role": "energy-inlay", "importance": 0.5, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-2.0763, 2.9653, 0.5], [-2.6902, 2.4223, 0.5], [-3.1661, 1.755, 0.5]], "crossSection": {"points": [[-0.0325, -0.025], [0.0325, -0.025], [0.0325, 0.025], [-0.0325, 0.025]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.24, "height": 7.24, "depth": 0.05, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "violet-accent-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}}, "material": "emissive-violet", "materialLayers": ["emissive-violet"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 105, 255, 1)", "secondaryAlbedo": "rgba(191, 151, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(139, 105, 255, 1)"}, {"position": 1, "color": "rgba(191, 151, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_violet_accent_left_32.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "violet-accent-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}};
  (nodes["root"] ?? root).add(node_violet_accent_left_32);
  nodes["violet-accent-left"] = node_violet_accent_left_32;
  const mesh_violet_accent_left_32Geometry = endpoint_violet_accent_left_32
    ? new THREE.CylinderGeometry(endpoint_violet_accent_left_32.endRadius, endpoint_violet_accent_left_32.baseRadius, endpoint_violet_accent_left_32.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[-2.0763, 2.9653, 0.5], [-2.6902, 2.4223, 0.5], [-3.1661, 1.755, 0.5]], "crossSection": {"points": [[-0.0325, -0.025], [0.0325, -0.025], [0.0325, 0.025], [-0.0325, 0.025]]}, "closed": false});
  const mesh_violet_accent_left_32 = new THREE.Mesh(
    mesh_violet_accent_left_32Geometry,
    materialMap["emissive-violet"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_violet_accent_left_32.name = "Violet Accent Left";
  if (endpoint_violet_accent_left_32) {
    mesh_violet_accent_left_32.position.copy(endpoint_violet_accent_left_32.midpoint);
    mesh_violet_accent_left_32.quaternion.copy(endpoint_violet_accent_left_32.quaternion);
  }
  mesh_violet_accent_left_32.castShadow = options.castShadow ?? true;
  mesh_violet_accent_left_32.receiveShadow = options.receiveShadow ?? true;
  mesh_violet_accent_left_32.userData.sculptComponent = {"id": "violet-accent-left", "name": "Violet Accent Left", "level": "micro", "role": "energy-inlay", "importance": 0.5, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[-2.0763, 2.9653, 0.5], [-2.6902, 2.4223, 0.5], [-3.1661, 1.755, 0.5]], "crossSection": {"points": [[-0.0325, -0.025], [0.0325, -0.025], [0.0325, 0.025], [-0.0325, 0.025]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.24, "height": 7.24, "depth": 0.05, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "violet-accent-left", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}}, "material": "emissive-violet", "materialLayers": ["emissive-violet"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 105, 255, 1)", "secondaryAlbedo": "rgba(191, 151, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(139, 105, 255, 1)"}, {"position": 1, "color": "rgba(191, 151, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_violet_accent_left_32.add(mesh_violet_accent_left_32);
  meshes["violet-accent-left"] = mesh_violet_accent_left_32;
  colliders["violet-accent-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["violet-accent-left"] ??= [];
  destructionGroups["violet-accent-left"].push(node_violet_accent_left_32);

  const attachment_violet_accent_right_33 = null;
  const endpoint_violet_accent_right_33 = makeAttachmentEndpoint(attachment_violet_accent_right_33);
  const node_violet_accent_right_33 = new THREE.Group();
  node_violet_accent_right_33.name = "Violet Accent Right__pivot";
  if (endpoint_violet_accent_right_33) {
    node_violet_accent_right_33.position.copy(endpoint_violet_accent_right_33.start);
    node_violet_accent_right_33.rotation.set(0, 0, 0);
    node_violet_accent_right_33.scale.set(1, 1, 1);
  } else {
    node_violet_accent_right_33.position.set(0.0, 0.0, 0.0);
    node_violet_accent_right_33.rotation.set(0.0, 0.0, 0.0);
    node_violet_accent_right_33.scale.set(1.0, 1.0, 1.0);
  }
  node_violet_accent_right_33.userData.sculptComponent = {"id": "violet-accent-right", "name": "Violet Accent Right", "level": "micro", "role": "energy-inlay", "importance": 0.5, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[2.4223, -2.6902, 0.5], [2.9286, -2.1278, 0.5], [3.307, -1.4724, 0.5]], "crossSection": {"points": [[-0.0325, -0.025], [0.0325, -0.025], [0.0325, 0.025], [-0.0325, 0.025]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.24, "height": 7.24, "depth": 0.05, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "violet-accent-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}}, "material": "emissive-violet", "materialLayers": ["emissive-violet"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 105, 255, 1)", "secondaryAlbedo": "rgba(191, 151, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(139, 105, 255, 1)"}, {"position": 1, "color": "rgba(191, 151, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_violet_accent_right_33.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "violet-accent-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}};
  (nodes["root"] ?? root).add(node_violet_accent_right_33);
  nodes["violet-accent-right"] = node_violet_accent_right_33;
  const mesh_violet_accent_right_33Geometry = endpoint_violet_accent_right_33
    ? new THREE.CylinderGeometry(endpoint_violet_accent_right_33.endRadius, endpoint_violet_accent_right_33.baseRadius, endpoint_violet_accent_right_33.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[2.4223, -2.6902, 0.5], [2.9286, -2.1278, 0.5], [3.307, -1.4724, 0.5]], "crossSection": {"points": [[-0.0325, -0.025], [0.0325, -0.025], [0.0325, 0.025], [-0.0325, 0.025]]}, "closed": false});
  const mesh_violet_accent_right_33 = new THREE.Mesh(
    mesh_violet_accent_right_33Geometry,
    materialMap["emissive-violet"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_violet_accent_right_33.name = "Violet Accent Right";
  if (endpoint_violet_accent_right_33) {
    mesh_violet_accent_right_33.position.copy(endpoint_violet_accent_right_33.midpoint);
    mesh_violet_accent_right_33.quaternion.copy(endpoint_violet_accent_right_33.quaternion);
  }
  mesh_violet_accent_right_33.castShadow = options.castShadow ?? true;
  mesh_violet_accent_right_33.receiveShadow = options.receiveShadow ?? true;
  mesh_violet_accent_right_33.userData.sculptComponent = {"id": "violet-accent-right", "name": "Violet Accent Right", "level": "micro", "role": "energy-inlay", "importance": 0.5, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.", "geometryDescriptor": {"topologyIntent": "Rectangular armor or inlay profile swept along a measured open radial spine.", "edgeTreatment": {"type": "profile-chamfer", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "curveSweep": {"spine": [[2.4223, -2.6902, 0.5], [2.9286, -2.1278, 0.5], [3.307, -1.4724, 0.5]], "crossSection": {"points": [[-0.0325, -0.025], [0.0325, -0.025], [0.0325, 0.025], [-0.0325, 0.025]]}, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 7.24, "height": 7.24, "depth": 0.05, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "violet-accent-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}}, "material": "emissive-violet", "materialLayers": ["emissive-violet"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 105, 255, 1)", "secondaryAlbedo": "rgba(191, 151, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(139, 105, 255, 1)"}, {"position": 1, "color": "rgba(191, 151, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_violet_accent_right_33.add(mesh_violet_accent_right_33);
  meshes["violet-accent-right"] = mesh_violet_accent_right_33;
  colliders["violet-accent-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [7.24, 7.24, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["violet-accent-right"] ??= [];
  destructionGroups["violet-accent-right"].push(node_violet_accent_right_33);

  const attachment_keystone_cyan_inlay_34 = null;
  const endpoint_keystone_cyan_inlay_34 = makeAttachmentEndpoint(attachment_keystone_cyan_inlay_34);
  const node_keystone_cyan_inlay_34 = new THREE.Group();
  node_keystone_cyan_inlay_34.name = "Keystone Cyan Inlay__pivot";
  if (endpoint_keystone_cyan_inlay_34) {
    node_keystone_cyan_inlay_34.position.copy(endpoint_keystone_cyan_inlay_34.start);
    node_keystone_cyan_inlay_34.rotation.set(0, 0, 0);
    node_keystone_cyan_inlay_34.scale.set(1, 1, 1);
  } else {
    node_keystone_cyan_inlay_34.position.set(0.0, 0.0, 0.5);
    node_keystone_cyan_inlay_34.rotation.set(0.0, 0.0, 0.0);
    node_keystone_cyan_inlay_34.scale.set(1.0, 1.0, 1.0);
  }
  node_keystone_cyan_inlay_34.userData.sculptComponent = {"id": "keystone-cyan-inlay", "name": "Keystone Cyan Inlay", "level": "micro", "role": "landmark", "importance": 0.62, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-0.5, -2.66], [-0.38, -2.64], [-0.1, -3.08], [-0.16, -3.78], [-0.26, -3.82], [-0.24, -3.1]], "depth": 0.055}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 0.4, "height": 1.1799999999999997, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-cyan-inlay", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_keystone_cyan_inlay_34.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-cyan-inlay", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["lower-keystone"] ?? root).add(node_keystone_cyan_inlay_34);
  nodes["keystone-cyan-inlay"] = node_keystone_cyan_inlay_34;
  const mesh_keystone_cyan_inlay_34Geometry = endpoint_keystone_cyan_inlay_34
    ? new THREE.CylinderGeometry(endpoint_keystone_cyan_inlay_34.endRadius, endpoint_keystone_cyan_inlay_34.baseRadius, endpoint_keystone_cyan_inlay_34.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.5, -2.66], [-0.38, -2.64], [-0.1, -3.08], [-0.16, -3.78], [-0.26, -3.82], [-0.24, -3.1]], "depth": 0.055});
  const mesh_keystone_cyan_inlay_34 = new THREE.Mesh(
    mesh_keystone_cyan_inlay_34Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keystone_cyan_inlay_34.name = "Keystone Cyan Inlay";
  if (endpoint_keystone_cyan_inlay_34) {
    mesh_keystone_cyan_inlay_34.position.copy(endpoint_keystone_cyan_inlay_34.midpoint);
    mesh_keystone_cyan_inlay_34.quaternion.copy(endpoint_keystone_cyan_inlay_34.quaternion);
  }
  mesh_keystone_cyan_inlay_34.castShadow = options.castShadow ?? true;
  mesh_keystone_cyan_inlay_34.receiveShadow = options.receiveShadow ?? true;
  mesh_keystone_cyan_inlay_34.userData.sculptComponent = {"id": "keystone-cyan-inlay", "name": "Keystone Cyan Inlay", "level": "micro", "role": "landmark", "importance": 0.62, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[-0.5, -2.66], [-0.38, -2.64], [-0.1, -3.08], [-0.16, -3.78], [-0.26, -3.82], [-0.24, -3.1]], "depth": 0.055}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 0.4, "height": 1.1799999999999997, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-cyan-inlay", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_keystone_cyan_inlay_34.add(mesh_keystone_cyan_inlay_34);
  meshes["keystone-cyan-inlay"] = mesh_keystone_cyan_inlay_34;
  colliders["keystone-cyan-inlay"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["keystone-cyan-inlay"] ??= [];
  destructionGroups["keystone-cyan-inlay"].push(node_keystone_cyan_inlay_34);

  const attachment_keystone_cyan_inlay_right_35 = null;
  const endpoint_keystone_cyan_inlay_right_35 = makeAttachmentEndpoint(attachment_keystone_cyan_inlay_right_35);
  const node_keystone_cyan_inlay_right_35 = new THREE.Group();
  node_keystone_cyan_inlay_right_35.name = "Keystone Cyan Inlay Right__pivot";
  if (endpoint_keystone_cyan_inlay_right_35) {
    node_keystone_cyan_inlay_right_35.position.copy(endpoint_keystone_cyan_inlay_right_35.start);
    node_keystone_cyan_inlay_right_35.rotation.set(0, 0, 0);
    node_keystone_cyan_inlay_right_35.scale.set(1, 1, 1);
  } else {
    node_keystone_cyan_inlay_right_35.position.set(0.0, 0.0, 0.5);
    node_keystone_cyan_inlay_right_35.rotation.set(0.0, 0.0, 0.0);
    node_keystone_cyan_inlay_right_35.scale.set(1.0, 1.0, 1.0);
  }
  node_keystone_cyan_inlay_right_35.userData.sculptComponent = {"id": "keystone-cyan-inlay-right", "name": "Keystone Cyan Inlay Right", "level": "micro", "role": "landmark", "importance": 0.62, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[0.5, -2.66], [0.38, -2.64], [0.1, -3.08], [0.16, -3.78], [0.26, -3.82], [0.24, -3.1]], "depth": 0.055}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 0.4, "height": 1.1799999999999997, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-cyan-inlay-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_keystone_cyan_inlay_right_35.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-cyan-inlay-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}};
  (nodes["lower-keystone"] ?? root).add(node_keystone_cyan_inlay_right_35);
  nodes["keystone-cyan-inlay-right"] = node_keystone_cyan_inlay_right_35;
  const mesh_keystone_cyan_inlay_right_35Geometry = endpoint_keystone_cyan_inlay_right_35
    ? new THREE.CylinderGeometry(endpoint_keystone_cyan_inlay_right_35.endRadius, endpoint_keystone_cyan_inlay_right_35.baseRadius, endpoint_keystone_cyan_inlay_right_35.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.5, -2.66], [0.38, -2.64], [0.1, -3.08], [0.16, -3.78], [0.26, -3.82], [0.24, -3.1]], "depth": 0.055});
  const mesh_keystone_cyan_inlay_right_35 = new THREE.Mesh(
    mesh_keystone_cyan_inlay_right_35Geometry,
    materialMap["emissive-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keystone_cyan_inlay_right_35.name = "Keystone Cyan Inlay Right";
  if (endpoint_keystone_cyan_inlay_right_35) {
    mesh_keystone_cyan_inlay_right_35.position.copy(endpoint_keystone_cyan_inlay_right_35.midpoint);
    mesh_keystone_cyan_inlay_right_35.quaternion.copy(endpoint_keystone_cyan_inlay_right_35.quaternion);
  }
  mesh_keystone_cyan_inlay_right_35.castShadow = options.castShadow ?? true;
  mesh_keystone_cyan_inlay_right_35.receiveShadow = options.receiveShadow ?? true;
  mesh_keystone_cyan_inlay_right_35.userData.sculptComponent = {"id": "keystone-cyan-inlay-right", "name": "Keystone Cyan Inlay Right", "level": "micro", "role": "landmark", "importance": 0.62, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[0.5, -2.66], [0.38, -2.64], [0.1, -3.08], [0.16, -3.78], [0.26, -3.82], [0.24, -3.1]], "depth": 0.055}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 0.4, "height": 1.1799999999999997, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-cyan-inlay-right", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-cyan"}}, "material": "emissive-cyan", "materialLayers": ["emissive-cyan"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 218, 255, 1)", "secondaryAlbedo": "rgba(117, 239, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(37, 218, 255, 1)"}, {"position": 1, "color": "rgba(117, 239, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_keystone_cyan_inlay_right_35.add(mesh_keystone_cyan_inlay_right_35);
  meshes["keystone-cyan-inlay-right"] = mesh_keystone_cyan_inlay_right_35;
  colliders["keystone-cyan-inlay-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.4, 1.1799999999999997, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["keystone-cyan-inlay-right"] ??= [];
  destructionGroups["keystone-cyan-inlay-right"].push(node_keystone_cyan_inlay_right_35);

  const attachment_keystone_violet_inlay_36 = null;
  const endpoint_keystone_violet_inlay_36 = makeAttachmentEndpoint(attachment_keystone_violet_inlay_36);
  const node_keystone_violet_inlay_36 = new THREE.Group();
  node_keystone_violet_inlay_36.name = "Keystone Violet Inlay__pivot";
  if (endpoint_keystone_violet_inlay_36) {
    node_keystone_violet_inlay_36.position.copy(endpoint_keystone_violet_inlay_36.start);
    node_keystone_violet_inlay_36.rotation.set(0, 0, 0);
    node_keystone_violet_inlay_36.scale.set(1, 1, 1);
  } else {
    node_keystone_violet_inlay_36.position.set(0.0, 0.0, 0.51);
    node_keystone_violet_inlay_36.rotation.set(0.0, 0.0, 0.0);
    node_keystone_violet_inlay_36.scale.set(1.0, 1.0, 1.0);
  }
  node_keystone_violet_inlay_36.userData.sculptComponent = {"id": "keystone-violet-inlay", "name": "Keystone Violet Inlay", "level": "micro", "role": "landmark", "importance": 0.48, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[0.36, -2.82], [0.44, -2.8], [0.47, -3.46], [0.38, -3.66]], "depth": 0.055}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 0.10999999999999999, "height": 0.8600000000000003, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0.51], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.10999999999999999, 0.8600000000000003, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-violet-inlay", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}}, "material": "emissive-violet", "materialLayers": ["emissive-violet"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 105, 255, 1)", "secondaryAlbedo": "rgba(191, 151, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(139, 105, 255, 1)"}, {"position": 1, "color": "rgba(191, 151, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_keystone_violet_inlay_36.userData.actionProfile = {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.10999999999999999, 0.8600000000000003, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-violet-inlay", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}};
  (nodes["lower-keystone"] ?? root).add(node_keystone_violet_inlay_36);
  nodes["keystone-violet-inlay"] = node_keystone_violet_inlay_36;
  const mesh_keystone_violet_inlay_36Geometry = endpoint_keystone_violet_inlay_36
    ? new THREE.CylinderGeometry(endpoint_keystone_violet_inlay_36.endRadius, endpoint_keystone_violet_inlay_36.baseRadius, endpoint_keystone_violet_inlay_36.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.36, -2.82], [0.44, -2.8], [0.47, -3.46], [0.38, -3.66]], "depth": 0.055});
  const mesh_keystone_violet_inlay_36 = new THREE.Mesh(
    mesh_keystone_violet_inlay_36Geometry,
    materialMap["emissive-violet"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keystone_violet_inlay_36.name = "Keystone Violet Inlay";
  if (endpoint_keystone_violet_inlay_36) {
    mesh_keystone_violet_inlay_36.position.copy(endpoint_keystone_violet_inlay_36.midpoint);
    mesh_keystone_violet_inlay_36.quaternion.copy(endpoint_keystone_violet_inlay_36.quaternion);
  }
  mesh_keystone_violet_inlay_36.castShadow = options.castShadow ?? true;
  mesh_keystone_violet_inlay_36.receiveShadow = options.receiveShadow ?? true;
  mesh_keystone_violet_inlay_36.userData.sculptComponent = {"id": "keystone-violet-inlay", "name": "Keystone Violet Inlay", "level": "micro", "role": "landmark", "importance": 0.48, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The reference shows a plate-like landmark with a custom silhouette and finite depth.", "geometryDescriptor": {"topologyIntent": "Planar armor profile extruded into a beveled hard-surface plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.045, "segments": 2}, "deformationStack": [], "uvStrategy": "generated object-space coordinates", "normalStrategy": "smooth path normals with deliberate hard material boundaries", "profile2D": {"points": [[0.36, -2.82], [0.44, -2.8], [0.47, -3.46], [0.38, -3.66]], "depth": 0.055}}, "parent": "lower-keystone", "attachment": null, "dimensions": {"width": 0.10999999999999999, "height": 0.8600000000000003, "depth": 0.055, "units": "arena-radius-relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0.51], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-stage-structure", "pivot": {"mode": "object-origin", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.96}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.10999999999999999, 0.8600000000000003, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."}, "constraints": ["Static during normal play", "May be hidden as one stage-detail group"], "destruction": {"breakable": false, "fractureGroup": "keystone-violet-inlay", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "emissive-violet"}}, "material": "emissive-violet", "materialLayers": ["emissive-violet"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(139, 105, 255, 1)", "secondaryAlbedo": "rgba(191, 151, 255, 1)", "materialClass": "glass", "materialClassConfidence": 0.72, "colorGradient": {"type": "linear", "axis": [0, 1, 0], "stops": [{"position": 0, "color": "rgba(139, 105, 255, 1)"}, {"position": 1, "color": "rgba(191, 151, 255, 1)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.025, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Keep broad faces clean at gameplay distance; avoid micro-greeble noise."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement"};
  node_keystone_violet_inlay_36.add(mesh_keystone_violet_inlay_36);
  meshes["keystone-violet-inlay"] = mesh_keystone_violet_inlay_36;
  colliders["keystone-violet-inlay"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.10999999999999999, 0.8600000000000003, 0.1], "isTrigger": true, "notes": "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate."};
  destructionGroups["keystone-violet-inlay"] ??= [];
  destructionGroups["keystone-violet-inlay"].push(node_keystone_violet_inlay_36);

  // repetition system: radial-support-ribs (InstancedMesh, radial, count=16, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
    const mat = materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.11, 0.42, 0.18];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 6.55;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 16);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 16; i++) {
      const ang = ((11.25) + (i * 360) / 16) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "radial-support-ribs";
    parent.add(cluster);
  }

  // repetition system: recessed-seam-tabs (InstancedMesh, radial, count=12, level=micro)
  {
    const parent = nodes["root"] ?? root;
    const geo = buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
    const mat = materialMap["support-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.08, 0.22, 0.06];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 7.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 12);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 12; i++) {
      const ang = ((15.0) + (i * 360) / 12) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "recessed-seam-tabs";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 512, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": false, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "The source is a generated concept with baked studio lighting; runtime materials use measured palette and authored PBR values rather than claiming inverse-rendered accuracy."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createGravityWellArenaRimV1LookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Gravity Well Arena Rim V1 look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Reference key light: cool-white area or directional key from upper-left, intensity 2.2, soft shadow.", "Reference fill light: deep blue hemisphere fill at approximately 0.55 intensity.", "Reference rim light: cyan rear-right rim at approximately 1.1 intensity to separate dark support layers.", "Exposure and tone mapping: ACES filmic, exposure near 1.0, preserve cyan and violet below clipping.", "Contact shadow: soft ambient occlusion only beneath overlapping armor; no ground-plane shadow because the prop floats around the well."];
  lights.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 512, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": false, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "The source is a generated concept with baked studio lighting; runtime materials use measured palette and authored PBR values rather than claiming inverse-rendered accuracy."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createGravityWellArenaRimV1Environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameGravityWellArenaRimV1Camera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createGravityWellArenaRimV1PresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}
