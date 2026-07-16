import * as THREE from 'three';
import {
  CHARACTER_BY_ID,
  type CharacterId,
  type CharacterVisualPresentation,
  type CharacterVisualProfile,
} from '../sim/characters';
import type { PlayerId, PlayerRenderSnapshot } from '../sim/types';
import {
  getSpriteAnimationSets,
  resolveSpriteAnimationSet,
  resolveSpriteClip,
  resolveSpriteFrame,
  type SpriteAnimationSet,
  type SpriteClipId,
} from './sprites/atlasDefinitions';

interface CharacterPalette {
  body: string;
  accent: string;
  emissive: string;
  detail: string;
}

interface CharacterStyle {
  silhouette: 'vanguard' | 'duelist' | 'ace' | 'warden';
  spriteShape: 'diamond' | 'spear' | 'crest' | 'hex';
  accentShape: 'slash' | 'ring' | 'chevron';
}

export interface CharacterVisualHandle {
  characterId: CharacterId;
  profile: CharacterVisualProfile;
  adapter: CharacterVisualAdapter;
  node: THREE.Object3D;
}

interface CharacterVisualUpdateContext {
  own: PlayerRenderSnapshot;
  opponent: PlayerRenderSnapshot;
  gameTime: number;
}

interface CharacterVisualAdapter {
  presentation: CharacterVisualPresentation;
  createNode: (profile: CharacterVisualProfile, playerId: PlayerId, characterId: CharacterId) => THREE.Object3D;
  updateNode: (node: THREE.Object3D, context: CharacterVisualUpdateContext) => void;
}

interface SpriteVisualRuntime {
  animationSet: SpriteAnimationSet;
  body: THREE.Sprite;
  rim: THREE.Sprite;
  contactShadow: THREE.Mesh;
  groundGlow: THREE.Mesh;
  clipId: SpriteClipId;
  clipStartedAt: number;
  phase: number;
}

export type RequiredPackagedAtlasRuntimeState = 'loading' | 'ready' | 'failed';

export interface RequiredPackagedAtlasRuntimeSnapshot {
  state: RequiredPackagedAtlasRuntimeState;
  requiredIds: string[];
  loadingIds: string[];
  readyIds: string[];
  failedIds: string[];
  fallbackIds: string[];
}

interface SpriteAtlasRuntimeRecord {
  animationSet: SpriteAnimationSet;
  state: RequiredPackagedAtlasRuntimeState;
  image: HTMLImageElement | null;
  error: Error | null;
  fallbackTextures: Set<THREE.Texture>;
  ready: Promise<void>;
}

const SPRITE_TEXTURE_CACHE = new Map<string, THREE.Texture>();
const SPRITE_ATLAS_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();
const REQUIRED_PACKAGED_SPRITE_ANIMATION_SETS = getSpriteAnimationSets()
  .sort((left, right) => left.id.localeCompare(right.id));
const REQUIRED_PACKAGED_SPRITE_ANIMATION_SET_IDS = REQUIRED_PACKAGED_SPRITE_ANIMATION_SETS
  .map((animationSet) => animationSet.id);
const SPRITE_ATLAS_RUNTIME_BY_ID = new Map<string, SpriteAtlasRuntimeRecord>();
let requiredPackagedAtlasRuntimeReady: Promise<RequiredPackagedAtlasRuntimeSnapshot> | null = null;

function getPalette(playerId: PlayerId): CharacterPalette {
  if (playerId === 'P1') {
    return {
      body: '#58b6ff',
      accent: '#8fe0ff',
      emissive: '#58b6ff',
      detail: '#ffffff',
    };
  }
  return {
    body: '#ff74b8',
    accent: '#ffc0dc',
    emissive: '#ff74b8',
    detail: '#fff0f7',
  };
}

function getCharacterStyle(characterId: CharacterId): CharacterStyle {
  switch (characterId) {
    case 'duelist':
      return { silhouette: 'duelist', spriteShape: 'spear', accentShape: 'slash' };
    case 'ace':
      return { silhouette: 'ace', spriteShape: 'crest', accentShape: 'chevron' };
    case 'warden':
      return { silhouette: 'warden', spriteShape: 'hex', accentShape: 'ring' };
    case 'vanguard':
    default:
      return { silhouette: 'vanguard', spriteShape: 'diamond', accentShape: 'ring' };
  }
}

function alphaForShape(
  shape: CharacterStyle['spriteShape'] | CharacterStyle['accentShape'],
  x: number,
  y: number,
): number {
  const nx = x * 2 - 1;
  const ny = y * 2 - 1;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);

  switch (shape) {
    case 'diamond':
      return ax + ay <= 0.86 ? 1 : 0;
    case 'spear':
      if (ay <= 0.14 && ax <= 0.76) {
        return 1;
      }
      return ax + Math.max(0, ny) * 0.8 <= 0.72 && ny >= -0.72 ? 1 : 0;
    case 'crest':
      if (ax + ay <= 0.8) {
        return 1;
      }
      return ay <= 0.16 && ax <= 0.92 ? 1 : 0;
    case 'hex':
      return ax * 0.82 + ay <= 0.9 && ay * 0.82 + ax <= 0.9 ? 1 : 0;
    case 'slash':
      return Math.abs(ny - nx * 0.72) <= 0.16 && ax <= 0.84 && ay <= 0.84 ? 1 : 0;
    case 'ring': {
      const r = Math.hypot(nx, ny);
      return r >= 0.5 && r <= 0.82 ? 1 : 0;
    }
    case 'chevron':
      return ny >= -0.72 && ny <= 0.46 && ay + ax * 0.68 >= 0.32 && ay + ax * 0.68 <= 0.74 ? 1 : 0;
    default:
      return 0;
  }
}

function getShapeTexture(shape: CharacterStyle['spriteShape'] | CharacterStyle['accentShape']): THREE.Texture {
  const cached = SPRITE_TEXTURE_CACHE.get(shape);
  if (cached) {
    return cached;
  }

  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const index = (py * size + px) * 4;
      const alpha = alphaForShape(shape, (px + 0.5) / size, (py + 0.5) / size);
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  SPRITE_TEXTURE_CACHE.set(shape, texture);
  return texture;
}

function createMaterial(color: string, emissive?: string, emissiveIntensity = 0.25): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: emissive ?? color,
    emissiveIntensity,
    metalness: 0.22,
    roughness: 0.58,
  });
}

function createMechBody(characterId: CharacterId, palette: CharacterPalette): THREE.Group {
  const style = getCharacterStyle(characterId);
  const mech = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.25, 2.5, 8, 14),
    createMaterial(palette.body, palette.emissive, 0.35),
  );
  body.rotation.z = Math.PI / 2;
  mech.add(body);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(style.silhouette === 'warden' ? 0.34 : 0.46, 16, 16),
    createMaterial(palette.detail, palette.emissive, 1.9),
  );
  core.name = 'core';
  core.position.z = 1;
  mech.add(core);

  if (style.silhouette === 'vanguard') {
    const shoulderGeo = new THREE.BoxGeometry(0.65, 1.7, 1);
    const shoulderMat = createMaterial(palette.accent, palette.emissive, 0.5);
    const leftShoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
    leftShoulder.position.set(-0.45, 0, 1.1);
    leftShoulder.rotation.z = 0.28;
    mech.add(leftShoulder);
    const rightShoulder = leftShoulder.clone();
    rightShoulder.position.x *= -1;
    rightShoulder.rotation.z *= -1;
    mech.add(rightShoulder);

    const shield = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.18, 14, 44),
      new THREE.MeshBasicMaterial({
        color: palette.accent,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    shield.name = 'aura';
    shield.rotation.x = Math.PI / 2;
    mech.add(shield);
  } else if (style.silhouette === 'warden') {
    const fin = new THREE.Mesh(
      new THREE.ConeGeometry(0.56, 2.8, 4),
      createMaterial(palette.accent, palette.emissive, 0.42),
    );
    fin.position.set(0, 0, 1.6);
    fin.rotation.x = Math.PI / 2;
    fin.rotation.z = Math.PI / 4;
    mech.add(fin);

    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 10, 10),
        createMaterial(palette.detail, palette.emissive, 0.8),
      );
      pod.position.set(side * 1.9, 0, 0.1);
      pod.name = 'pod';
      mech.add(pod);
    }
  } else if (style.silhouette === 'ace') {
    const wingGeo = new THREE.ConeGeometry(1.05, 3.3, 3);
    const wingMat = createMaterial(palette.accent, palette.emissive, 0.34);
    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(-0.75, 0, -0.1);
    leftWing.rotation.set(Math.PI / 2, 0, Math.PI * 0.2);
    mech.add(leftWing);
    const rightWing = leftWing.clone();
    rightWing.position.x *= -1;
    rightWing.rotation.z *= -1;
    mech.add(rightWing);
  }

  return mech;
}

function configureAtlasTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.userData.ownedByCharacterVisual = true;
  return texture;
}

function createFallbackAtlasTexture(animationSet: SpriteAnimationSet): THREE.Texture {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = animationSet.atlasWidthPixels;
    canvas.height = animationSet.atlasHeightPixels;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#ffffff';
      for (let row = 0; row < animationSet.rows; row += 1) {
        for (let column = 0; column < animationSet.columns; column += 1) {
          const frameX = animationSet.marginPixels
            + column * (animationSet.frameWidthPixels + animationSet.spacingPixels);
          const frameY = animationSet.marginPixels
            + row * (animationSet.frameHeightPixels + animationSet.spacingPixels);
          context.beginPath();
          context.ellipse(
            frameX + animationSet.frameWidthPixels * 0.5,
            frameY + animationSet.frameHeightPixels * 0.52,
            animationSet.frameWidthPixels * 0.3,
            animationSet.frameHeightPixels * 0.42,
            0,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
    }
    return configureAtlasTexture(new THREE.CanvasTexture(canvas));
  }

  const data = new Uint8Array(animationSet.columns * animationSet.rows * 4);
  data.fill(255);
  const texture = new THREE.DataTexture(
    data,
    animationSet.columns,
    animationSet.rows,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return configureAtlasTexture(texture);
}

function loadAtlasImage(textureUrl: string): Promise<HTMLImageElement> {
  const cached = SPRITE_ATLAS_IMAGE_CACHE.get(textureUrl);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    if (typeof Image === 'undefined') {
      throw new Error(`Browser image decoding is unavailable for sprite atlas ${textureUrl}.`);
    }
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.src = textureUrl;
    if (typeof image.decode !== 'function') {
      throw new Error(`Browser image decoding is unavailable for sprite atlas ${textureUrl}.`);
    }
    try {
      await image.decode();
    } catch {
      throw new Error(`Unable to decode sprite atlas ${textureUrl}.`);
    }
    return image;
  })();
  SPRITE_ATLAS_IMAGE_CACHE.set(textureUrl, pending);
  return pending;
}

export function getRequiredPackagedAtlasRuntimeSnapshot(): RequiredPackagedAtlasRuntimeSnapshot {
  const loadingIds: string[] = [];
  const readyIds: string[] = [];
  const failedIds: string[] = [];
  const fallbackIds: string[] = [];

  for (const animationSet of REQUIRED_PACKAGED_SPRITE_ANIMATION_SETS) {
    const runtime = SPRITE_ATLAS_RUNTIME_BY_ID.get(animationSet.id);
    if (!runtime || runtime.state === 'loading') {
      loadingIds.push(animationSet.id);
    } else if (runtime.state === 'ready') {
      readyIds.push(animationSet.id);
    } else {
      failedIds.push(animationSet.id);
    }
    if (!runtime || runtime.fallbackTextures.size > 0) {
      fallbackIds.push(animationSet.id);
    }
  }

  return {
    state: failedIds.length > 0
      ? 'failed'
      : readyIds.length === REQUIRED_PACKAGED_SPRITE_ANIMATION_SET_IDS.length && fallbackIds.length === 0
        ? 'ready'
        : 'loading',
    requiredIds: [...REQUIRED_PACKAGED_SPRITE_ANIMATION_SET_IDS],
    loadingIds,
    readyIds,
    failedIds,
    fallbackIds,
  };
}

function publishRequiredPackagedAtlasRuntimeSnapshot(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const snapshot = getRequiredPackagedAtlasRuntimeSnapshot();
  const dataset = document.documentElement.dataset;
  dataset.characterAssetState = snapshot.state;
  dataset.characterAssetRequiredIds = snapshot.requiredIds.join(',');
  dataset.characterAssetLoadingIds = snapshot.loadingIds.join(',');
  dataset.characterAssetReadyIds = snapshot.readyIds.join(',');
  dataset.characterAssetFailedIds = snapshot.failedIds.join(',');
  dataset.characterAssetFallbackIds = snapshot.fallbackIds.join(',');
}

function ensureSpriteAtlasRuntime(animationSet: SpriteAnimationSet): SpriteAtlasRuntimeRecord {
  const existing = SPRITE_ATLAS_RUNTIME_BY_ID.get(animationSet.id);
  if (existing) {
    return existing;
  }

  const runtime: SpriteAtlasRuntimeRecord = {
    animationSet,
    state: 'loading',
    image: null,
    error: null,
    fallbackTextures: new Set(),
    ready: Promise.resolve(),
  };
  SPRITE_ATLAS_RUNTIME_BY_ID.set(animationSet.id, runtime);
  publishRequiredPackagedAtlasRuntimeSnapshot();

  runtime.ready = loadAtlasImage(animationSet.textureUrl).then((image) => {
    if (
      image.naturalWidth !== animationSet.atlasWidthPixels
      || image.naturalHeight !== animationSet.atlasHeightPixels
    ) {
      throw new Error(
        `Decoded sprite atlas ${animationSet.id} is ${image.naturalWidth}x${image.naturalHeight}; `
          + `expected ${animationSet.atlasWidthPixels}x${animationSet.atlasHeightPixels}.`,
      );
    }

    for (const texture of runtime.fallbackTextures) {
      texture.image = image;
      texture.needsUpdate = true;
    }
    if ([...runtime.fallbackTextures].some((texture) => texture.image !== image)) {
      throw new Error(`Unable to replace every fallback texture for sprite atlas ${animationSet.id}.`);
    }
    runtime.fallbackTextures.clear();
    runtime.image = image;
    runtime.state = 'ready';
    publishRequiredPackagedAtlasRuntimeSnapshot();
  }).catch((error: unknown) => {
    runtime.error = error instanceof Error ? error : new Error(String(error));
    runtime.state = 'failed';
    publishRequiredPackagedAtlasRuntimeSnapshot();
    throw runtime.error;
  });
  void runtime.ready.catch((error) => {
    console.error(
      `[character-assets] required atlas ${animationSet.id} failed; gameplay remains gated`,
      error,
    );
  });
  return runtime;
}

export function getRequiredPackagedAtlasRuntimeReadyPromise(): Promise<RequiredPackagedAtlasRuntimeSnapshot> {
  if (!requiredPackagedAtlasRuntimeReady) {
    const runtimes = REQUIRED_PACKAGED_SPRITE_ANIMATION_SETS.map(ensureSpriteAtlasRuntime);
    requiredPackagedAtlasRuntimeReady = Promise.all(runtimes.map((runtime) => runtime.ready)).then(() => {
      const snapshot = getRequiredPackagedAtlasRuntimeSnapshot();
      if (snapshot.state !== 'ready') {
        throw new Error(
          `Required packaged sprite atlases did not become ready: ${snapshot.fallbackIds.join(',')}.`,
        );
      }
      return snapshot;
    });
  }
  return requiredPackagedAtlasRuntimeReady;
}

function createDecodedAtlasTexture(image: HTMLImageElement): THREE.Texture {
  const texture = configureAtlasTexture(new THREE.Texture(image));
  texture.needsUpdate = true;
  return texture;
}

function loadAtlasTexture(animationSet: SpriteAnimationSet): THREE.Texture {
  if (typeof Image === 'undefined') {
    return createFallbackAtlasTexture(animationSet);
  }

  const runtime = ensureSpriteAtlasRuntime(animationSet);
  if (runtime.state === 'ready') {
    if (!runtime.image) {
      throw new Error(`Sprite atlas ${animationSet.id} reached ready without a decoded image.`);
    }
    return createDecodedAtlasTexture(runtime.image);
  }

  const texture = createFallbackAtlasTexture(animationSet);
  runtime.fallbackTextures.add(texture);
  publishRequiredPackagedAtlasRuntimeSnapshot();
  return texture;
}

function applyAtlasFrame(texture: THREE.Texture, animationSet: SpriteAnimationSet, frame: number): void {
  const column = frame % animationSet.columns;
  const row = Math.floor(frame / animationSet.columns);
  const frameX = animationSet.marginPixels
    + column * (animationSet.frameWidthPixels + animationSet.spacingPixels);
  const frameY = animationSet.marginPixels
    + row * (animationSet.frameHeightPixels + animationSet.spacingPixels);
  texture.repeat.set(
    animationSet.frameWidthPixels / animationSet.atlasWidthPixels,
    animationSet.frameHeightPixels / animationSet.atlasHeightPixels,
  );
  texture.offset.set(
    frameX / animationSet.atlasWidthPixels,
    1 - (frameY + animationSet.frameHeightPixels) / animationSet.atlasHeightPixels,
  );
}

function createSpriteNode(
  profile: CharacterVisualProfile,
  characterId: CharacterId,
  palette: CharacterPalette,
  playerId: PlayerId,
): THREE.Group {
  if (!profile.animationSetId) {
    throw new Error(`Missing sprite animation set id for ${characterId}.`);
  }
  const animationSet = resolveSpriteAnimationSet(profile.animationSetId);
  if (!animationSet) {
    throw new Error(`Missing sprite animation set "${profile.animationSetId}" for ${characterId}.`);
  }
  const group = new THREE.Group();
  group.name = `${profile.animationSetId}:sprite`;

  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshBasicMaterial({
      color: '#01040c',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );
  contactShadow.name = 'sprite-contact-shadow';
  contactShadow.position.z = 0.08;
  contactShadow.scale.set(animationSet.worldWidth * 0.38, animationSet.worldWidth * 0.12, 1);
  group.add(contactShadow);

  const groundGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 1, 48),
    new THREE.MeshBasicMaterial({
      color: palette.body,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  groundGlow.name = 'sprite-ground-glow';
  groundGlow.position.z = 0.1;
  groundGlow.scale.set(animationSet.worldWidth * 0.44, animationSet.worldWidth * 0.15, 1);
  group.add(groundGlow);

  const rimTexture = loadAtlasTexture(animationSet);
  applyAtlasFrame(rimTexture, animationSet, 0);
  const rim = new THREE.Sprite(new THREE.SpriteMaterial({
    map: rimTexture,
    color: palette.accent,
    transparent: true,
    opacity: 0.3,
    alphaTest: 0.04,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  rim.name = 'sprite-rim';
  rim.center.set(animationSet.anchorX, animationSet.anchorY);
  rim.position.z = 0.3;
  rim.scale.set(animationSet.worldWidth * 1.12, animationSet.worldHeight * 1.12, 1);
  group.add(rim);

  const bodyTexture = loadAtlasTexture(animationSet);
  applyAtlasFrame(bodyTexture, animationSet, 0);
  const body = new THREE.Sprite(new THREE.SpriteMaterial({
    map: bodyTexture,
    color: palette.body,
    transparent: true,
    opacity: 1,
    alphaTest: 0.06,
    depthWrite: false,
  }));
  body.name = 'sprite-body';
  body.center.set(animationSet.anchorX, animationSet.anchorY);
  body.position.z = 0.36;
  body.scale.set(animationSet.worldWidth, animationSet.worldHeight, 1);
  group.add(body);

  const runtime: SpriteVisualRuntime = {
    animationSet,
    body,
    rim,
    contactShadow,
    groundGlow,
    clipId: animationSet.stateClips['idle.none'] ?? 'idle',
    clipStartedAt: 0,
    phase: playerId === 'P1' ? 0 : 0.13,
  };
  group.userData.spriteRuntime = runtime;
  return group;
}

function createHybridNode(characterId: CharacterId, palette: CharacterPalette): THREE.Group {
  const style = getCharacterStyle(characterId);
  const group = new THREE.Group();
  group.name = `${characterId}:hybrid`;
  group.add(createMechBody(characterId, palette));

  const aura = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getShapeTexture(style.spriteShape),
      color: palette.accent,
      transparent: true,
      opacity: 0.24,
      alphaTest: 0.08,
    }),
  );
  aura.name = 'aura';
  aura.position.set(0, 0, -1.15);
  aura.scale.set(8.8, 8.8, 1);
  group.add(aura);

  return group;
}

function applyVisualPulse(node: THREE.Object3D, context: CharacterVisualUpdateContext): void {
  const pressure = Math.max(
    context.own.launchFlash * 1.9,
    context.own.parryFlash * 1.4,
    context.own.specialFlash * 1.8,
    context.own.breakFlash * 1.7,
    context.own.dunkFlash * 1.8,
  );
  const pulse = 1 + pressure * 0.16 + Math.abs(Math.sin(context.gameTime * 7.5)) * 0.025;
  node.scale.setScalar(pulse);

  node.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const material = child.material;
      if (Array.isArray(material)) {
        return;
      }
      if ('emissiveIntensity' in material) {
        const base = child.name === 'core' ? 1.5 : 0.25;
        material.emissiveIntensity = base + pressure * (child.name === 'core' ? 1.8 : 0.65);
      }
      if ('opacity' in material && material.transparent) {
        material.opacity = THREE.MathUtils.clamp((material.opacity ?? 1) + pressure * 0.04, 0, 1);
      }
    }
    if (child instanceof THREE.Sprite) {
      const material = child.material as THREE.SpriteMaterial;
      material.opacity = child.name === 'aura'
        ? THREE.MathUtils.clamp(0.24 + pressure * 0.14, 0, 0.8)
        : THREE.MathUtils.clamp(0.86 + pressure * 0.1, 0, 1);
    }
  });
}

const threeDAdapter: CharacterVisualAdapter = {
  presentation: '3d',
  createNode(profile: CharacterVisualProfile, playerId: PlayerId, characterId: CharacterId): THREE.Object3D {
    const mech = createMechBody(characterId, getPalette(playerId));
    mech.name = `${profile.modelId ?? characterId}:${profile.animationSetId ?? 'procedural'}`;
    return mech;
  },
  updateNode(node: THREE.Object3D, context: CharacterVisualUpdateContext): void {
    node.lookAt(context.opponent.pos.x, context.opponent.pos.y, 0);
    node.rotation.x = Math.PI / 2;
    applyVisualPulse(node, context);
  },
};

const spriteAdapter: CharacterVisualAdapter = {
  presentation: 'sprite',
  createNode(profile: CharacterVisualProfile, playerId: PlayerId, characterId: CharacterId): THREE.Object3D {
    return createSpriteNode(profile, characterId, getPalette(playerId), playerId);
  },
  updateNode(node: THREE.Object3D, context: CharacterVisualUpdateContext): void {
    const runtime = node.userData.spriteRuntime as SpriteVisualRuntime | undefined;
    if (!runtime) {
      return;
    }
    const clipId = resolveSpriteClip(runtime.animationSet, context.own);
    if (clipId !== runtime.clipId) {
      runtime.clipId = clipId;
      runtime.clipStartedAt = context.gameTime;
    }
    const frame = resolveSpriteFrame(
      runtime.animationSet,
      runtime.clipId,
      context.gameTime - runtime.clipStartedAt,
      runtime.phase,
    );
    const bodyMap = (runtime.body.material as THREE.SpriteMaterial).map;
    const rimMap = (runtime.rim.material as THREE.SpriteMaterial).map;
    if (bodyMap) {
      applyAtlasFrame(bodyMap, runtime.animationSet, frame);
    }
    if (rimMap) {
      applyAtlasFrame(rimMap, runtime.animationSet, frame);
    }

    const directionalLean = THREE.MathUtils.clamp(context.opponent.pos.x - context.own.pos.x, -1, 1) * 0.08;
    const facing = context.opponent.pos.x >= context.own.pos.x ? 1 : -1;
    const startupTelegraph = context.own.presentationPhase === 'startup'
      ? 0.18 + Math.abs(Math.sin(context.gameTime * 18 + runtime.phase * 10)) * 0.18
      : 0;
    const activeTelegraph = context.own.presentationPhase === 'active' ? 0.22 : 0;
    const actionPulse = Math.max(
      context.own.launchFlash,
      context.own.parryFlash,
      context.own.specialFlash,
      context.own.breakFlash,
      context.own.dunkFlash,
      startupTelegraph,
      activeTelegraph,
    );
    const idlePulse = Math.abs(Math.sin(context.gameTime * 4.2 + runtime.phase * 10)) * 0.025;
    const pulse = 1 + idlePulse + actionPulse * 0.16;
    runtime.body.scale.set(
      runtime.animationSet.worldWidth * pulse * facing,
      runtime.animationSet.worldHeight * pulse,
      1,
    );
    (runtime.body.material as THREE.SpriteMaterial).rotation = directionalLean;
    runtime.rim.scale.set(
      runtime.animationSet.worldWidth * (1.1 + actionPulse * 0.24) * facing,
      runtime.animationSet.worldHeight * (1.1 + actionPulse * 0.24),
      1,
    );
    const rimMaterial = runtime.rim.material as THREE.SpriteMaterial;
    rimMaterial.rotation = directionalLean;
    rimMaterial.opacity = THREE.MathUtils.clamp(0.2 + actionPulse * 0.7, 0.18, 0.82);
    runtime.contactShadow.scale.set(
      runtime.animationSet.worldWidth * (0.38 + context.own.recovering * 0.02),
      runtime.animationSet.worldWidth * 0.12,
      1,
    );
    (runtime.contactShadow.material as THREE.MeshBasicMaterial).opacity = context.own.recovering > 0
      ? 0.06
      : 0.34 + actionPulse * 0.1;
    runtime.groundGlow.scale.set(
      runtime.animationSet.worldWidth * (0.44 + actionPulse * 0.08),
      runtime.animationSet.worldWidth * (0.15 + actionPulse * 0.025),
      1,
    );
    (runtime.groundGlow.material as THREE.MeshBasicMaterial).opacity = context.own.recovering > 0
      ? 0.04
      : 0.14 + actionPulse * 0.28;
  },
};

const hybridAdapter: CharacterVisualAdapter = {
  presentation: 'hybrid',
  createNode(profile: CharacterVisualProfile, playerId: PlayerId, characterId: CharacterId): THREE.Object3D {
    const group = createHybridNode(characterId, getPalette(playerId));
    group.name = `${profile.modelId ?? characterId}:hybrid`;
    return group;
  },
  updateNode(node: THREE.Object3D, context: CharacterVisualUpdateContext): void {
    node.lookAt(context.opponent.pos.x, context.opponent.pos.y, 0);
    node.rotation.x = Math.PI / 2;
    applyVisualPulse(node, context);
    const aura = node.children.find((child) => child.name === 'aura');
    if (aura instanceof THREE.Sprite) {
      const pulse = 1 + Math.abs(Math.sin(context.gameTime * 4.1)) * 0.12 + context.own.launchFlash * 0.22;
      aura.scale.set(8.8 * pulse, 8.8 * pulse, 1);
    }
  },
};

function resolveAdapter(presentation: CharacterVisualPresentation): CharacterVisualAdapter {
  switch (presentation) {
    case 'sprite':
      return spriteAdapter;
    case 'hybrid':
      return hybridAdapter;
    case '3d':
    default:
      return threeDAdapter;
  }
}

export function createCharacterVisualHandle(characterId: CharacterId, playerId: PlayerId): CharacterVisualHandle {
  const profile = CHARACTER_BY_ID[characterId].visuals;
  const adapter = resolveAdapter(profile.presentation);
  return {
    characterId,
    profile,
    adapter,
    node: adapter.createNode(profile, playerId, characterId),
  };
}

export function updateCharacterVisualHandle(
  handle: CharacterVisualHandle,
  own: PlayerRenderSnapshot,
  opponent: PlayerRenderSnapshot,
  gameTime: number,
): void {
  handle.adapter.updateNode(handle.node, { own, opponent, gameTime });
}

export function disposeCharacterVisualNode(node: THREE.Object3D): void {
  const disposedTextures = new Set<THREE.Texture>();
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const material = mesh.material as THREE.Material | THREE.Material[];
      const disposeMaterial = (entry: THREE.Material) => {
        const map = 'map' in entry ? entry.map as THREE.Texture | null : null;
        if (map?.userData.ownedByCharacterVisual && !disposedTextures.has(map)) {
          disposedTextures.add(map);
          map.dispose();
        }
        entry.dispose();
      };
      if (Array.isArray(material)) {
        material.forEach(disposeMaterial);
      } else {
        disposeMaterial(material);
      }
    }
  });
}
