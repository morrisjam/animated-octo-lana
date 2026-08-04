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
  resolveSpriteFrameSelection,
  type SpriteAnimationSet,
  type SpriteAtlasSheet,
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
  ghost: THREE.Sprite;
  ghostFadeRemaining: number;
  facing: number;
  facingDisplay: number;
  lastGameTime: number | null;
  lastDisplayed: {
    sheetId: string;
    frame: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  } | null;
  clipId: SpriteClipId;
  sheetId: string;
  clipStartedAt: number;
  phase: number;
  sheetTextures: Map<string, { body: THREE.Texture; rim: THREE.Texture; ghost: THREE.Texture }>;
}

// Clips a transition may dissolve into. Attacks, parries, and getting hit
// stay hard cuts so telegraphs and impacts keep their snap; the dissolve
// smooths the seams back into neutral flight and recovery.
const SMOOTH_TRANSITION_CLIPS = new Set<SpriteClipId>(['idle', 'boost', 'recover']);
const SPRITE_CROSSFADE_SECONDS = 0.11;
const SPRITE_TURN_SECONDS = 0.09;

function beginSpriteTransition(runtime: SpriteVisualRuntime, nextClipId: SpriteClipId): void {
  const previous = runtime.lastDisplayed;
  const sheet = previous ? runtime.animationSet.sheets[previous.sheetId] : undefined;
  const textures = previous ? runtime.sheetTextures.get(previous.sheetId) : undefined;
  if (!previous || !sheet || !textures || !SMOOTH_TRANSITION_CLIPS.has(nextClipId)) {
    runtime.ghostFadeRemaining = 0;
    runtime.ghost.visible = false;
    return;
  }
  const ghostMaterial = runtime.ghost.material as THREE.SpriteMaterial;
  if (ghostMaterial.map !== textures.ghost) {
    ghostMaterial.map = textures.ghost;
    ghostMaterial.needsUpdate = true;
  }
  applyAtlasFrame(textures.ghost, sheet, previous.frame);
  runtime.ghost.center.set(sheet.anchorX, sheet.anchorY);
  runtime.ghost.scale.set(previous.scaleX, previous.scaleY, 1);
  ghostMaterial.rotation = previous.rotation;
  ghostMaterial.opacity = 0.85;
  runtime.ghost.visible = true;
  runtime.ghostFadeRemaining = SPRITE_CROSSFADE_SECONDS;
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
  sheet: SpriteAtlasSheet;
  state: RequiredPackagedAtlasRuntimeState;
  image: HTMLImageElement | null;
  error: Error | null;
  fallbackTextures: Set<THREE.Texture>;
  ready: Promise<void>;
}

const SPRITE_TEXTURE_CACHE = new Map<string, THREE.Texture>();
const SPRITE_ATLAS_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();
const REQUIRED_PACKAGED_SPRITE_SHEETS = getSpriteAnimationSets()
  .flatMap((animationSet) => Object.values(animationSet.sheets))
  .sort((left, right) => left.id.localeCompare(right.id));
const REQUIRED_PACKAGED_SPRITE_SHEET_IDS = REQUIRED_PACKAGED_SPRITE_SHEETS
  .map((sheet) => sheet.id);
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

function createFallbackAtlasTexture(sheet: SpriteAtlasSheet): THREE.Texture {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = sheet.atlasWidthPixels;
    canvas.height = sheet.atlasHeightPixels;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#ffffff';
      for (let row = 0; row < sheet.rows; row += 1) {
        for (let column = 0; column < sheet.columns; column += 1) {
          const frameX = sheet.marginPixels
            + column * (sheet.frameWidthPixels + sheet.spacingPixels);
          const frameY = sheet.marginPixels
            + row * (sheet.frameHeightPixels + sheet.spacingPixels);
          context.beginPath();
          context.ellipse(
            frameX + sheet.frameWidthPixels * 0.5,
            frameY + sheet.frameHeightPixels * 0.52,
            sheet.frameWidthPixels * 0.3,
            sheet.frameHeightPixels * 0.42,
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

  const data = new Uint8Array(sheet.columns * sheet.rows * 4);
  data.fill(255);
  const texture = new THREE.DataTexture(
    data,
    sheet.columns,
    sheet.rows,
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

  for (const sheet of REQUIRED_PACKAGED_SPRITE_SHEETS) {
    const runtime = SPRITE_ATLAS_RUNTIME_BY_ID.get(sheet.id);
    if (!runtime || runtime.state === 'loading') {
      loadingIds.push(sheet.id);
    } else if (runtime.state === 'ready') {
      readyIds.push(sheet.id);
    } else {
      failedIds.push(sheet.id);
    }
    if (!runtime || runtime.fallbackTextures.size > 0) {
      fallbackIds.push(sheet.id);
    }
  }

  return {
    state: failedIds.length > 0
      ? 'failed'
      : readyIds.length === REQUIRED_PACKAGED_SPRITE_SHEET_IDS.length && fallbackIds.length === 0
        ? 'ready'
        : 'loading',
    requiredIds: [...REQUIRED_PACKAGED_SPRITE_SHEET_IDS],
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

function ensureSpriteAtlasRuntime(sheet: SpriteAtlasSheet): SpriteAtlasRuntimeRecord {
  const existing = SPRITE_ATLAS_RUNTIME_BY_ID.get(sheet.id);
  if (existing) {
    return existing;
  }

  const runtime: SpriteAtlasRuntimeRecord = {
    sheet,
    state: 'loading',
    image: null,
    error: null,
    fallbackTextures: new Set(),
    ready: Promise.resolve(),
  };
  SPRITE_ATLAS_RUNTIME_BY_ID.set(sheet.id, runtime);
  publishRequiredPackagedAtlasRuntimeSnapshot();

  runtime.ready = loadAtlasImage(sheet.textureUrl).then((image) => {
    if (
      image.naturalWidth !== sheet.atlasWidthPixels
      || image.naturalHeight !== sheet.atlasHeightPixels
    ) {
      throw new Error(
        `Decoded sprite atlas ${sheet.id} is ${image.naturalWidth}x${image.naturalHeight}; `
          + `expected ${sheet.atlasWidthPixels}x${sheet.atlasHeightPixels}.`,
      );
    }

    for (const texture of runtime.fallbackTextures) {
      texture.image = image;
      texture.needsUpdate = true;
    }
    if ([...runtime.fallbackTextures].some((texture) => texture.image !== image)) {
      throw new Error(`Unable to replace every fallback texture for sprite atlas ${sheet.id}.`);
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
      `[character-assets] required atlas ${sheet.id} failed; gameplay remains gated`,
      error,
    );
  });
  return runtime;
}

export function getRequiredPackagedAtlasRuntimeReadyPromise(): Promise<RequiredPackagedAtlasRuntimeSnapshot> {
  if (!requiredPackagedAtlasRuntimeReady) {
    const runtimes = REQUIRED_PACKAGED_SPRITE_SHEETS.map(ensureSpriteAtlasRuntime);
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

function loadAtlasTexture(sheet: SpriteAtlasSheet): THREE.Texture {
  if (typeof Image === 'undefined') {
    return createFallbackAtlasTexture(sheet);
  }

  const runtime = ensureSpriteAtlasRuntime(sheet);
  if (runtime.state === 'ready') {
    if (!runtime.image) {
      throw new Error(`Sprite atlas ${sheet.id} reached ready without a decoded image.`);
    }
    return createDecodedAtlasTexture(runtime.image);
  }

  const texture = createFallbackAtlasTexture(sheet);
  runtime.fallbackTextures.add(texture);
  publishRequiredPackagedAtlasRuntimeSnapshot();
  return texture;
}

function applyAtlasFrame(texture: THREE.Texture, sheet: SpriteAtlasSheet, frame: number): void {
  const column = frame % sheet.columns;
  const row = Math.floor(frame / sheet.columns);
  const frameX = sheet.marginPixels
    + column * (sheet.frameWidthPixels + sheet.spacingPixels);
  const frameY = sheet.marginPixels
    + row * (sheet.frameHeightPixels + sheet.spacingPixels);
  texture.repeat.set(
    sheet.frameWidthPixels / sheet.atlasWidthPixels,
    sheet.frameHeightPixels / sheet.atlasHeightPixels,
  );
  texture.offset.set(
    frameX / sheet.atlasWidthPixels,
    1 - (frameY + sheet.frameHeightPixels) / sheet.atlasHeightPixels,
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
  const initialClipId = animationSet.stateClips['idle.none'] ?? 'idle';
  const initialClip = animationSet.clips[initialClipId];
  const initialSheet = initialClip
    ? animationSet.sheets[initialClip.sheetId]
    : animationSet.sheets[animationSet.defaultSheetId];
  if (!initialSheet) {
    throw new Error(`Missing default sprite sheet for animation set "${profile.animationSetId}".`);
  }
  const group = new THREE.Group();
  group.name = `${profile.animationSetId}:sprite`;

  // No contact shadow or ground ring: fighters are always airborne — grounding
  // cues read as standing on a disc. Team identity comes from the rim glow.
  const initialFrame = initialClip?.frames[0] ?? 0;
  const rimTexture = loadAtlasTexture(initialSheet);
  applyAtlasFrame(rimTexture, initialSheet, initialFrame);
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
  rim.center.set(initialSheet.anchorX, initialSheet.anchorY);
  rim.position.z = 0.3;
  rim.scale.set(initialSheet.worldWidth * 1.12, initialSheet.worldHeight * 1.12, 1);
  group.add(rim);

  const bodyTexture = loadAtlasTexture(initialSheet);
  applyAtlasFrame(bodyTexture, initialSheet, initialFrame);
  // Multiplying by the full team color crushes the navy artwork into the dark
  // stage; keep the art near full brightness with only a hint of team hue and
  // let the rim glow carry team identity.
  const bodyTint = new THREE.Color(palette.body).lerp(new THREE.Color('#ffffff'), 0.78);
  const body = new THREE.Sprite(new THREE.SpriteMaterial({
    map: bodyTexture,
    color: bodyTint,
    transparent: true,
    opacity: 1,
    alphaTest: 0.06,
    depthWrite: false,
  }));
  body.name = 'sprite-body';
  body.center.set(initialSheet.anchorX, initialSheet.anchorY);
  body.position.z = 0.36;
  body.scale.set(initialSheet.worldWidth, initialSheet.worldHeight, 1);
  group.add(body);

  // Crossfade layer: holds the previous clip's final pose for a beat while
  // the body plays the next clip, softening cuts back into calm states.
  const ghostTexture = loadAtlasTexture(initialSheet);
  applyAtlasFrame(ghostTexture, initialSheet, initialFrame);
  const ghost = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ghostTexture,
    color: bodyTint,
    transparent: true,
    opacity: 0,
    alphaTest: 0.06,
    depthWrite: false,
  }));
  ghost.name = 'sprite-ghost';
  ghost.center.set(initialSheet.anchorX, initialSheet.anchorY);
  ghost.position.z = 0.38;
  ghost.scale.set(initialSheet.worldWidth, initialSheet.worldHeight, 1);
  ghost.visible = false;
  group.add(ghost);

  const runtime: SpriteVisualRuntime = {
    animationSet,
    body,
    rim,
    ghost,
    ghostFadeRemaining: 0,
    facing: 1,
    facingDisplay: 1,
    lastGameTime: null,
    lastDisplayed: null,
    clipId: initialClipId,
    sheetId: initialSheet.id,
    clipStartedAt: 0,
    phase: playerId === 'P1' ? 0 : 0.13,
    sheetTextures: new Map([
      [initialSheet.id, { body: bodyTexture, rim: rimTexture, ghost: ghostTexture }],
    ]),
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
    const dt = runtime.lastGameTime === null
      ? 0
      : THREE.MathUtils.clamp(context.gameTime - runtime.lastGameTime, 0, 0.05);
    runtime.lastGameTime = context.gameTime;
    const clipId = resolveSpriteClip(runtime.animationSet, context.own);
    if (clipId !== runtime.clipId) {
      beginSpriteTransition(runtime, clipId);
      runtime.clipId = clipId;
      runtime.clipStartedAt = context.gameTime;
    }
    const selection = resolveSpriteFrameSelection(
      runtime.animationSet,
      runtime.clipId,
      context.gameTime - runtime.clipStartedAt,
      runtime.phase,
    );
    if (!selection) {
      return;
    }
    const { sheet } = selection;
    const bodyMaterial = runtime.body.material as THREE.SpriteMaterial;
    const rimMaterial = runtime.rim.material as THREE.SpriteMaterial;
    if (runtime.sheetId !== selection.sheetId) {
      let textures = runtime.sheetTextures.get(selection.sheetId);
      if (!textures) {
        textures = {
          body: loadAtlasTexture(sheet),
          rim: loadAtlasTexture(sheet),
          ghost: loadAtlasTexture(sheet),
        };
        runtime.sheetTextures.set(selection.sheetId, textures);
      }
      bodyMaterial.map = textures.body;
      rimMaterial.map = textures.rim;
      bodyMaterial.needsUpdate = true;
      rimMaterial.needsUpdate = true;
      runtime.body.center.set(sheet.anchorX, sheet.anchorY);
      runtime.rim.center.set(sheet.anchorX, sheet.anchorY);
      runtime.sheetId = selection.sheetId;
    }
    const bodyMap = bodyMaterial.map;
    const rimMap = rimMaterial.map;
    if (bodyMap) {
      applyAtlasFrame(bodyMap, sheet, selection.frame);
    }
    if (rimMap) {
      applyAtlasFrame(rimMap, sheet, selection.frame);
    }

    const opponentDeltaX = context.opponent.pos.x - context.own.pos.x;
    const directionalLean = THREE.MathUtils.clamp(opponentDeltaX, -1, 1) * 0.08;
    // Face the opponent, with hysteresis so near-vertical passes don't strobe
    // the mirror flip every frame.
    if (Math.abs(opponentDeltaX) > 2) {
      runtime.facing = opponentDeltaX >= 0 ? 1 : -1;
    }
    // Ease the mirror through an edge-on squash so a side switch reads as the
    // fighter turning around instead of popping. First update snaps.
    if (dt === 0) {
      runtime.facingDisplay = runtime.facing;
    } else {
      const turnStep = dt / SPRITE_TURN_SECONDS;
      runtime.facingDisplay += THREE.MathUtils.clamp(
        runtime.facing - runtime.facingDisplay,
        -turnStep,
        turnStep,
      );
    }
    const facing = Math.abs(runtime.facingDisplay) < 0.04
      ? (runtime.facingDisplay < 0 ? -0.04 : 0.04)
      : runtime.facingDisplay;
    const startupTelegraph = context.own.presentationPhase === 'startup'
      ? 0.18 + Math.abs(Math.sin(context.gameTime * 18 + runtime.phase * 10)) * 0.18
      : 0;
    const activeTelegraph = context.own.presentationPhase === 'active' ? 0.22 : 0;
    // Super boost shares the boost clip with ordinary boost; the sustained
    // glow surge is what tells the two apart.
    const superBoostSurge = context.own.superBoost > 0
      ? 0.5 + Math.abs(Math.sin(context.gameTime * 26 + runtime.phase * 10)) * 0.16
      : 0;
    const actionPulse = Math.max(
      context.own.launchFlash,
      context.own.parryFlash,
      context.own.specialFlash,
      context.own.breakFlash,
      context.own.dunkFlash,
      startupTelegraph,
      activeTelegraph,
      superBoostSurge,
    );
    const idlePulse = Math.abs(Math.sin(context.gameTime * 4.2 + runtime.phase * 10)) * 0.025;
    const pulse = 1 + idlePulse + actionPulse * 0.16;
    runtime.body.scale.set(
      sheet.worldWidth * pulse * facing,
      sheet.worldHeight * pulse,
      1,
    );
    bodyMaterial.rotation = directionalLean;
    runtime.rim.scale.set(
      sheet.worldWidth * (1.1 + actionPulse * 0.24) * facing,
      sheet.worldHeight * (1.1 + actionPulse * 0.24),
      1,
    );
    rimMaterial.rotation = directionalLean;
    // The rim doubles as the readability layer on dark stages: keep a strong
    // team-color silhouette floor and let actions push it brighter.
    rimMaterial.opacity = THREE.MathUtils.clamp(0.42 + actionPulse * 0.5, 0.4, 0.85);

    if (runtime.ghostFadeRemaining > 0) {
      runtime.ghostFadeRemaining = Math.max(0, runtime.ghostFadeRemaining - dt);
      const ghostMaterial = runtime.ghost.material as THREE.SpriteMaterial;
      ghostMaterial.opacity = 0.85 * (runtime.ghostFadeRemaining / SPRITE_CROSSFADE_SECONDS);
      if (runtime.ghostFadeRemaining <= 0) {
        runtime.ghost.visible = false;
      }
    }

    runtime.lastDisplayed = {
      sheetId: selection.sheetId,
      frame: selection.frame,
      scaleX: runtime.body.scale.x,
      scaleY: runtime.body.scale.y,
      rotation: bodyMaterial.rotation,
    };
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
  const spriteRuntime = node.userData.spriteRuntime as SpriteVisualRuntime | undefined;
  for (const textures of spriteRuntime?.sheetTextures.values() ?? []) {
    for (const texture of [textures.body, textures.rim, textures.ghost]) {
      if (!disposedTextures.has(texture)) {
        disposedTextures.add(texture);
        texture.dispose();
      }
    }
  }
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
