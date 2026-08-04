import * as THREE from 'three';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PlayerRenderSnapshot } from '../sim/types';
import {
  createCharacterVisualHandle,
  disposeCharacterVisualNode,
  updateCharacterVisualHandle,
} from './characterVisual';

class ControlledImage {
  static readonly requests = new Map<string, ControlledImage>();

  decoding = '';
  crossOrigin: string | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private source = '';
  private readonly decoded: Promise<void>;
  private resolveDecoded!: () => void;
  private rejectDecoded!: () => void;

  constructor() {
    this.decoded = new Promise<void>((resolve, reject) => {
      this.resolveDecoded = resolve;
      this.rejectDecoded = reject;
    });
  }

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    ControlledImage.requests.set(value, this);
  }

  decode(): Promise<void> {
    return this.decoded;
  }

  succeed(width = 512, height = 256): void {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.resolveDecoded();
  }

  fail(): void {
    this.rejectDecoded();
  }

  static reset(): void {
    ControlledImage.requests.clear();
  }
}

async function importControlledCharacterVisual() {
  vi.resetModules();
  ControlledImage.reset();
  vi.stubGlobal('Image', ControlledImage);
  return import('./characterVisual');
}

function findControlledImage(characterId: 'vanguard' | 'duelist'): ControlledImage {
  const entry = [...ControlledImage.requests.entries()]
    .find(([source]) => source.includes(`/characters/${characterId}/`));
  if (!entry) {
    throw new Error(`Missing controlled image request for ${characterId}.`);
  }
  return entry[1];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeSnapshot(characterId: PlayerRenderSnapshot['characterId']): PlayerRenderSnapshot {
  return {
    id: 'P1',
    characterId,
    pos: { x: 0, y: 0 },
    maxFuel: 100,
    fuel: 100,
    launchBreaks: 3,
    boostActive: false,
    superBoost: 0,
    helpless: 0,
    parry: 0,
    launchFlash: 0,
    parryFlash: 0,
    specialFlash: 0,
    breakFlash: 0,
    dunkFlash: 0,
    recovering: 0,
    recoveryProgress: 0,
    presentationAction: 'idle',
    presentationPhase: 'none',
  };
}

describe('character visual adapters', () => {
  test('supports 3d, sprite, and hybrid visual presentations behind one interface', () => {
    const threeD = createCharacterVisualHandle('warden', 'P1');
    const vanguardSprite = createCharacterVisualHandle('vanguard', 'P1');
    const duelistSprite = createCharacterVisualHandle('duelist', 'P2');
    const hybrid = createCharacterVisualHandle('ace', 'P1');

    expect(threeD.adapter.presentation).toBe('3d');
    expect(vanguardSprite.adapter.presentation).toBe('sprite');
    expect(duelistSprite.adapter.presentation).toBe('sprite');
    expect(hybrid.adapter.presentation).toBe('hybrid');

    expect(threeD.node).toBeInstanceOf(THREE.Group);
    expect(vanguardSprite.node).toBeInstanceOf(THREE.Group);
    expect(duelistSprite.node).toBeInstanceOf(THREE.Group);
    expect(vanguardSprite.node.children.some((child) => child.name === 'sprite-body')).toBe(true);
    expect(duelistSprite.node.children.some((child) => child.name === 'sprite-body')).toBe(true);
    expect(hybrid.node).toBeInstanceOf(THREE.Group);
    expect(hybrid.node.children.some((child) => child instanceof THREE.Sprite)).toBe(true);
  });

  test('updates and disposes existing placeholder character visuals safely', () => {
    const handles = [
      createCharacterVisualHandle('vanguard', 'P1'),
      createCharacterVisualHandle('duelist', 'P2'),
      createCharacterVisualHandle('ace', 'P1'),
      createCharacterVisualHandle('warden', 'P2'),
    ];

    for (const handle of handles) {
      const own = makeSnapshot(handle.characterId);
      const opponent = makeSnapshot(handle.characterId === 'vanguard' ? 'duelist' : 'vanguard');
      expect(() => updateCharacterVisualHandle(handle, own, opponent, 1.25)).not.toThrow();
      expect(() => disposeCharacterVisualNode(handle.node)).not.toThrow();
    }
  });

  test('keeps sprite characters airborne with soft team tints and a constant rim glow', () => {
    const p1 = createCharacterVisualHandle('vanguard', 'P1');
    const p2 = createCharacterVisualHandle('duelist', 'P2');
    const p1Body = p1.node.getObjectByName('sprite-body');
    const p2Body = p2.node.getObjectByName('sprite-body');
    const p1Rim = p1.node.getObjectByName('sprite-rim');
    const p2Rim = p2.node.getObjectByName('sprite-rim');

    // Fighters never touch the ground: no contact shadow or ground ring.
    expect(p1.node.getObjectByName('sprite-contact-shadow')).toBeUndefined();
    expect(p2.node.getObjectByName('sprite-contact-shadow')).toBeUndefined();
    expect(p1.node.getObjectByName('sprite-ground-glow')).toBeUndefined();
    expect(p2.node.getObjectByName('sprite-ground-glow')).toBeUndefined();
    expect(p1Body).toBeInstanceOf(THREE.Sprite);
    expect(p2Body).toBeInstanceOf(THREE.Sprite);
    expect(p1Rim).toBeInstanceOf(THREE.Sprite);
    expect(p2Rim).toBeInstanceOf(THREE.Sprite);

    // Body tint stays near white so the navy artwork keeps its brightness.
    const p1BodyMaterial = (p1Body as THREE.Sprite).material;
    const p2BodyMaterial = (p2Body as THREE.Sprite).material;
    expect(p1BodyMaterial.color.getHexString()).toBe('e7f1ff');
    expect(p2BodyMaterial.color.getHexString()).toBe('ffe9f2');
    const p1RimMaterial = (p1Rim as THREE.Sprite).material;
    expect(p1RimMaterial.color.getHexString()).toBe('8fe0ff');
    expect(p1RimMaterial.blending).toBe(THREE.AdditiveBlending);
    expect((p1Body as THREE.Sprite).center.y).toBeCloseTo(0.1);
    expect((p2Body as THREE.Sprite).center.y).toBeCloseTo(0.1);

    // The rim keeps a visibility floor while idle and surges during super boost.
    updateCharacterVisualHandle(p1, makeSnapshot('vanguard'), makeSnapshot('duelist'), 1);
    expect(p1RimMaterial.opacity).toBeGreaterThanOrEqual(0.4);
    const superBoosting = { ...makeSnapshot('vanguard'), superBoost: 1 };
    updateCharacterVisualHandle(p1, superBoosting, makeSnapshot('duelist'), 1.5);
    expect(p1RimMaterial.opacity).toBeGreaterThan(0.6);

    disposeCharacterVisualNode(p1.node);
    disposeCharacterVisualNode(p2.node);
  });

  test('mirrors sprites toward the opponent with hysteresis around vertical passes', () => {
    const p1 = createCharacterVisualHandle('vanguard', 'P1');
    const body = p1.node.getObjectByName('sprite-body') as THREE.Sprite;
    const own = makeSnapshot('vanguard');

    // The very first update snaps the displayed facing without a turn tween.
    updateCharacterVisualHandle(p1, own, { ...makeSnapshot('duelist'), pos: { x: -10, y: 0 } }, 1);
    expect(body.scale.x).toBeLessThan(0);

    // Inside the deadband the previous facing must hold instead of strobing.
    updateCharacterVisualHandle(p1, own, { ...makeSnapshot('duelist'), pos: { x: 1, y: 0 } }, 1.1);
    expect(body.scale.x).toBeLessThan(0);

    // A real side switch turns over a few frames (edge-on squash), so the
    // mirrored scale crosses to positive after a short tween, not instantly.
    let time = 1.2;
    for (let i = 0; i < 8; i += 1) {
      updateCharacterVisualHandle(p1, own, { ...makeSnapshot('duelist'), pos: { x: 10, y: 0 } }, time);
      time += 0.05;
    }
    expect(body.scale.x).toBeGreaterThan(0);

    disposeCharacterVisualNode(p1.node);
  });

  test('crossfades into calm clips and hard-cuts into attacks', () => {
    const p1 = createCharacterVisualHandle('vanguard', 'P1');
    const ghost = p1.node.getObjectByName('sprite-ghost') as THREE.Sprite;
    const opponent = makeSnapshot('duelist');
    const idle = makeSnapshot('vanguard');
    const recovering = {
      ...makeSnapshot('vanguard'),
      presentationAction: 'recover' as const,
      presentationPhase: 'recovery' as const,
      recovering: 0.6,
      recoveryProgress: 0.7,
    };
    const launching = {
      ...makeSnapshot('vanguard'),
      presentationAction: 'launch' as const,
      presentationPhase: 'startup' as const,
    };

    updateCharacterVisualHandle(p1, idle, opponent, 1);
    expect(ghost.visible).toBe(false);

    // idle -> recover is a calm transition: the previous pose dissolves out.
    updateCharacterVisualHandle(p1, recovering, opponent, 1.016);
    expect(ghost.visible).toBe(true);
    expect(ghost.material.opacity).toBeGreaterThan(0.5);

    // The dissolve decays and clears within a few frames.
    let time = 1.07;
    for (let i = 0; i < 4; i += 1) {
      updateCharacterVisualHandle(p1, recovering, opponent, time);
      time += 0.06;
    }
    expect(ghost.visible).toBe(false);

    // recover -> launch startup is an attack: no dissolve, instant cut.
    updateCharacterVisualHandle(p1, launching, opponent, time);
    expect(ghost.visible).toBe(false);

    disposeCharacterVisualNode(p1.node);
  });
});

describe('required packaged atlas runtime', () => {
  test('resolves only after every required decoded image replaces visible fallback textures', async () => {
    const characterVisual = await importControlledCharacterVisual();
    const vanguard = characterVisual.createCharacterVisualHandle('vanguard', 'P1');
    const duelist = characterVisual.createCharacterVisualHandle('duelist', 'P2');
    const vanguardBody = vanguard.node.getObjectByName('sprite-body') as THREE.Sprite;
    const duelistBody = duelist.node.getObjectByName('sprite-body') as THREE.Sprite;
    const vanguardImage = findControlledImage('vanguard');
    const duelistImage = findControlledImage('duelist');

    const ready = characterVisual.getRequiredPackagedAtlasRuntimeReadyPromise();
    expect(characterVisual.getRequiredPackagedAtlasRuntimeSnapshot()).toMatchObject({
      state: 'loading',
      loadingIds: ['character_duelist_animset', 'character_vanguard_animset'],
      readyIds: [],
      failedIds: [],
      fallbackIds: ['character_duelist_animset', 'character_vanguard_animset'],
    });

    duelistImage.succeed();
    vanguardImage.succeed(1024, 896);
    await expect(ready).resolves.toMatchObject({
      state: 'ready',
      requiredIds: ['character_duelist_animset', 'character_vanguard_animset'],
      readyIds: ['character_duelist_animset', 'character_vanguard_animset'],
      failedIds: [],
      fallbackIds: [],
    });
    expect((vanguardBody.material as THREE.SpriteMaterial).map?.image).toBe(vanguardImage);
    expect((duelistBody.material as THREE.SpriteMaterial).map?.image).toBe(duelistImage);

    characterVisual.disposeCharacterVisualNode(vanguard.node);
    characterVisual.disposeCharacterVisualNode(duelist.node);
  });

  test('keeps the aggregate failed when another animation set resolves later', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const characterVisual = await importControlledCharacterVisual();
    const vanguard = characterVisual.createCharacterVisualHandle('vanguard', 'P1');
    const duelist = characterVisual.createCharacterVisualHandle('duelist', 'P2');
    const ready = characterVisual.getRequiredPackagedAtlasRuntimeReadyPromise();
    const duelistImage = findControlledImage('duelist');
    const vanguardImage = findControlledImage('vanguard');

    duelistImage.fail();
    await expect(ready).rejects.toThrow('Unable to decode sprite atlas');
    vanguardImage.succeed(1024, 896);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(characterVisual.getRequiredPackagedAtlasRuntimeSnapshot()).toEqual({
      state: 'failed',
      requiredIds: ['character_duelist_animset', 'character_vanguard_animset'],
      loadingIds: [],
      readyIds: ['character_vanguard_animset'],
      failedIds: ['character_duelist_animset'],
      fallbackIds: ['character_duelist_animset'],
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    characterVisual.disposeCharacterVisualNode(vanguard.node);
    characterVisual.disposeCharacterVisualNode(duelist.node);
  });

  test('fails runtime readiness when decoded atlas dimensions differ from the package', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const characterVisual = await importControlledCharacterVisual();
    const vanguard = characterVisual.createCharacterVisualHandle('vanguard', 'P1');
    const duelist = characterVisual.createCharacterVisualHandle('duelist', 'P2');
    const ready = characterVisual.getRequiredPackagedAtlasRuntimeReadyPromise();

    findControlledImage('duelist').succeed(256, 256);
    findControlledImage('vanguard').succeed(1024, 896);

    await expect(ready).rejects.toThrow(
      'Decoded sprite atlas character_duelist_animset is 256x256; expected 512x256.',
    );
    expect(characterVisual.getRequiredPackagedAtlasRuntimeSnapshot()).toMatchObject({
      state: 'failed',
      failedIds: ['character_duelist_animset'],
      fallbackIds: ['character_duelist_animset'],
    });
    characterVisual.disposeCharacterVisualNode(vanguard.node);
    characterVisual.disposeCharacterVisualNode(duelist.node);
  });
});
