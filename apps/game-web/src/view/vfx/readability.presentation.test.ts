import * as THREE from 'three';
import { describe, expect, test, vi } from 'vitest';
import { createInitialState, getRenderSnapshot, step } from '../../sim/sim';
import { createCharacterBalanceConfig } from '../../sim/characterBalance';
import type { FrameInput } from '../../sim/types';
import type { SimulationActionStart } from '../../sim/sim';
import { extractCombatVfxEvents } from './events';
import { createReadabilityFlashGeometry } from './readabilityGeometry';
import { COMBAT_READABILITY_PRESETS } from './readabilityPresets';
import { createCombatReadabilityTracker } from './readabilityTracker';
import { createCombatVfxRuntime, emitCombatVfxEvents, updateCombatVfxRuntime, disposeCombatVfxRuntime } from './runtime';
import type { CombatReadabilityCueId, CombatVfxEvent } from './types';

const DT = 1 / 60;
const neutral = (): FrameInput => ({
  p1: { moveX: 0, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
  p2: { moveX: 0, moveY: 0, boost: false, superBoost: false, special: false, launch: false, dunk: false, parry: false, breakLaunch: false },
});

function cue(readabilityCue: CombatReadabilityCueId): CombatVfxEvent {
  return { type: 'launch', playerId: 'P1', characterId: 'vanguard', position: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, readabilityCue };
}

describe('combat readability snapshot cues', () => {
  test('emits one launch wind-up, then distinguishes attacker impact from victim vulnerability', () => {
    const state = createInitialState();
    const previous = getRenderSnapshot(state);
    const input = neutral();
    input.p1.launch = true;
    step(state, input, DT);
    const startup = getRenderSnapshot(state);
    expect(extractCombatVfxEvents(previous, startup).filter((event) => event.readabilityCue === 'launch_startup')).toHaveLength(1);
    expect(extractCombatVfxEvents(startup, startup)).toEqual([]);
    const hit = structuredClone(startup);
    hit.gameTime += DT;
    hit.players.P1.launchFlash = 0.24;
    hit.players.P1.presentationAction = 'attack_recovery';
    hit.players.P2.launchFlash = 0.24;
    hit.players.P2.helpless = 1;
    hit.players.P2.presentationAction = 'helpless';
    const events = extractCombatVfxEvents(startup, hit);
    expect(events.find((event) => event.playerId === 'P2')?.readabilityCue).toBe('launched_vulnerable');
    expect(events.some((event) => event.playerId === 'P1' && event.type === 'launch' && !event.readabilityCue)).toBe(true);
  });

  test('does not invent parry success or a whiff from attempt flashes and recovery snapshots', () => {
    const state = createInitialState();
    const previous = getRenderSnapshot(state);
    const input = neutral();
    input.p1.parry = true;
    step(state, input, DT);
    const events = extractCombatVfxEvents(previous, getRenderSnapshot(state));
    expect(events.find((event) => event.type === 'parry')?.readabilityCue).toBe('parry_attempt');
    expect(events.some((event) => event.readabilityCue === 'parry_success' || event.readabilityCue === 'attack_whiff')).toBe(false);
    expect(extractCombatVfxEvents(getRenderSnapshot(state), previous)).toEqual([]);
  });
});

describe('fixed-step outcome readability evidence', () => {
  test('confirms parry only when guard is consumed by a launch and counter-stuns its attacker', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -2, y: 0 };
    state.players.P2.pos = { x: 2, y: 0 };
    state.players.P1.launchActive = 0.1;
    state.players.P2.parry = 0.2;
    const tracker = createCombatReadabilityTracker();
    tracker.recordFrame(state);
    step(state, neutral(), DT);
    const checksumInput = JSON.stringify(state);
    const events = tracker.recordFrame(state);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ playerId: 'P2', readabilityCue: 'parry_success' })]));
    expect(JSON.stringify(state)).toBe(checksumInput);
    expect(tracker.recordFrame(state)).toEqual([]);
    step(state, neutral(), DT);
    expect(tracker.recordFrame(state).some((event) => event.readabilityCue === 'parry_success')).toBe(false);
  });

  test('guard expiry is not parry success', () => {
    const state = createInitialState();
    state.players.P2.parry = DT;
    const tracker = createCombatReadabilityTracker();
    tracker.recordFrame(state);
    step(state, neutral(), DT);
    expect(tracker.recordFrame(state)).toEqual([]);
  });

  test('accepts same-tick instant parry evidence without claiming that a pressed button succeeded', () => {
    const state = createInitialState();
    state.players.P1.pos = { x: -2, y: 0 };
    state.players.P2.pos = { x: 2, y: 0 };
    state.players.P1.launchActive = 0.1;
    const tracker = createCombatReadabilityTracker();
    tracker.recordFrame(state);
    const input = neutral();
    input.p2.parry = true;
    const starts: SimulationActionStart[] = [];
    step(state, input, DT, { onActionStart: (event) => starts.push(event) });
    expect(tracker.recordFrame(state, starts).some((event) => event.readabilityCue === 'parry_success')).toBe(true);
  });

  test.each(['launch', 'dunk'] as const)('marks a real %s whiff but not its hit or interruption', (action) => {
    for (const outcome of ['whiff', 'hit', 'interrupted']) {
      const state = createInitialState();
      if (outcome === 'hit') {
        state.players.P1.pos = { x: -2, y: 0 };
        state.players.P2.pos = { x: 2, y: 0 };
      }
      state.players.P1[`${action}Active`] = DT;
      const tracker = createCombatReadabilityTracker();
      tracker.recordFrame(state);
      if (outcome === 'interrupted') state.players.P1.stunned = 0.3;
      step(state, neutral(), DT);
      const events = tracker.recordFrame(state);
      expect(events.some((event) => event.readabilityCue === 'attack_whiff')).toBe(outcome === 'whiff');
    }
  });

  test.each([0, 6, 60])('waits for actual %i-frame launch-break recovery, independent of the decorative flash', (recoveryFrames) => {
    const vanguard = createCharacterBalanceConfig('vanguard');
    vanguard.moves.break.recoveryFrames = recoveryFrames;
    const state = createInitialState({ characterBalanceOverrides: { vanguard } });
    state.players.P1.helpless = 2;
    const tracker = createCombatReadabilityTracker();
    tracker.recordFrame(state);
    const input = neutral();
    input.p1.breakLaunch = true;
    let readyCount = 0;
    for (let frame = 0; frame < recoveryFrames + 4; frame += 1) {
      step(state, frame === 0 ? input : neutral(), DT);
      const events = tracker.recordFrame(state);
      if (events.some((event) => event.readabilityCue === 'break_ready')) {
        readyCount += 1;
        expect(state.players.P1.stunned).toBe(0);
        if (recoveryFrames === 6) expect(state.players.P1.breakFlash).toBeGreaterThan(0);
        if (recoveryFrames === 60) expect(state.players.P1.breakFlash).toBe(0);
      }
      if (state.players.P1.stunned > 0) expect(events).toEqual([]);
    }
    expect(readyCount).toBe(1);
  });

  test.each(['reset', 'rewind', 'gap', 'interrupted'] as const)('does not announce break readiness after %s', (transition) => {
    const state = createInitialState();
    state.players.P1.helpless = 1;
    const tracker = createCombatReadabilityTracker();
    tracker.recordFrame(state);
    const input = neutral();
    input.p1.breakLaunch = true;
    step(state, input, DT);
    tracker.recordFrame(state);
    if (transition === 'reset') tracker.reset();
    if (transition === 'rewind') state.gameTime = -1;
    if (transition === 'gap') state.gameTime += 1;
    if (transition === 'interrupted') state.players.P1.stunned += 0.5;
    step(state, neutral(), DT);
    tracker.recordFrame(state);
    state.players.P1.stunned = 0;
    state.players.P1.helpless = 0;
    step(state, neutral(), DT);
    expect(tracker.recordFrame(state).some((event) => event.readabilityCue === 'break_ready')).toBe(false);
  });
});

describe('bounded, non-strobing readability rendering', () => {
  test('uses small hollow procedural shapes without textures, particles, trails, or raised asset limits', () => {
    for (const preset of Object.values(COMBAT_READABILITY_PRESETS)) {
      expect(preset.particles).toBeUndefined();
      expect(preset.trail).toBeUndefined();
      expect(preset.flash!.lifetimeSeconds).toBeLessThanOrEqual(0.25);
      expect(preset.flash!.radius * preset.flash!.endScale).toBeLessThan(4);
      expect(preset.flash!.endOpacity).toBe(0);
      const geometry = createReadabilityFlashGeometry(preset.flash!);
      const points = geometry.getAttribute('position');
      expect(points.count).toBeGreaterThan(0);
      expect(points.count).toBeLessThan(200);
      for (let index = 0; index < points.count; index += 1) {
        expect(Math.hypot(points.getX(index), points.getY(index))).toBeGreaterThan(1.8);
      }
      geometry.dispose();
    }
    expect(COMBAT_READABILITY_PRESETS.parry_attempt.flash!.shape).not.toBe(COMBAT_READABILITY_PRESETS.parry_success.flash!.shape);
    expect(COMBAT_READABILITY_PRESETS.break_spent.flash!.shape).not.toBe(COMBAT_READABILITY_PRESETS.break_ready.flash!.shape);
  });

  test('keeps one cue per fighter, gives exact outcomes priority, fades monotonically, and disposes on rewind', () => {
    const scene = new THREE.Scene();
    const onAudioCue = vi.fn();
    const runtime = createCombatVfxRuntime(scene, { onAudioCue });
    emitCombatVfxEvents(runtime, [cue('attack_whiff'), cue('attack_recovery')], 1);
    expect(runtime.active).toHaveLength(1);
    expect(runtime.active[0].readabilityCue).toBe('attack_whiff');
    expect(onAudioCue).not.toHaveBeenCalled();
    emitCombatVfxEvents(runtime, [{ ...cue('attack_recovery'), type: 'boost', readabilityCue: undefined }], 1);
    expect(runtime.active.some((effect) => effect.readabilityCue === 'attack_whiff')).toBe(true);
    onAudioCue.mockClear();
    const effect = runtime.active[0];
    const material = effect.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.NormalBlending);
    const disposeGeometry = vi.spyOn(effect.geometry, 'dispose');
    let opacity = material.opacity;
    for (const offset of [0, 0.0005, 0.02, 0.1, 0.2]) {
      updateCombatVfxRuntime(runtime, 1 + offset);
      expect(material.opacity).toBeLessThanOrEqual(opacity);
      opacity = material.opacity;
    }
    updateCombatVfxRuntime(runtime, 0.9);
    expect(runtime.active).toHaveLength(0);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    emitCombatVfxEvents(runtime, [cue('parry_success'), cue('parry_attempt')], 2);
    expect(onAudioCue).toHaveBeenCalledOnce();
    expect(runtime.active).toHaveLength(1);
    disposeCombatVfxRuntime(runtime);
    expect(scene.children).toHaveLength(0);
  });
});
