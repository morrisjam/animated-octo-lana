import { describe, expect, test, vi } from 'vitest';
import { createAiController, createDefaultAiBehaviorTuning, tickAiController, type AiControllerState } from './ai';
import { canInterceptFinish, finishChaseInput, MAX_FINISH_FORECAST_FRAMES } from './aiFinish';
import { createCharacterBalanceConfig } from './characterBalance';
import { computeStateChecksum } from './checksum';
import { framesToSeconds } from './moveData';
import * as sim from './sim';
import type { FrameInput, GameState, PlayerFrameInput, PlayerId } from './types';
import fixtures from './aiFlowFixtures.json';

const idle = (): PlayerFrameInput => ({ moveX: 0, moveY: 0, boost: false, superBoost: false,
  launch: false, special: false, dunk: false, parry: false, breakLaunch: false });
const other = (id: PlayerId): PlayerId => id === 'P1' ? 'P2' : 'P1';

// Reconstructed with the unchanged flow-v25 controller at HEAD 8a978e5.
// Frame numbers are the completed ticks, so stop 3480 decides frame 3481.
function incident(index: number, mirror = false) {
  const source = structuredClone(fixtures[index]) as unknown as {
    state: GameState; c1: AiControllerState; c2: AiControllerState;
  };
  if (mirror) {
    const state = source.state;
    [state.players.P1, state.players.P2] = [state.players.P2, state.players.P1];
    [state.loadout.P1, state.loadout.P2] = [state.loadout.P2, state.loadout.P1];
    [source.c1, source.c2] = [source.c2, source.c1];
    for (const id of ['P1', 'P2'] as const) {
      state.players[id].id = id;
      const launcher = state.players[id].lastLaunchedBy;
      if (launcher) state.players[id].lastLaunchedBy = other(launcher);
    }
    for (const controller of [source.c1, source.c2]) {
      if (controller.commitmentInitiativeOwner) {
        controller.commitmentInitiativeOwner = other(controller.commitmentInitiativeOwner);
      }
    }
  }
  return source;
}

function runLive(source: ReturnType<typeof incident>, frames: number) {
  const state = sim.createStateSnapshot(source.state);
  let c1 = source.c1; let c2 = source.c2;
  const inputs: FrameInput[] = []; const checksums: number[] = [];
  const accepted: Array<{ frame: number; playerId: PlayerId; action: string }> = [];
  const launched = new Set<PlayerId>();
  const parried = new Set<PlayerId>();
  for (let frame = 0; frame < frames && !state.winner; frame++) {
    const a = tickAiController(state, 'P1', c1); const b = tickAiController(state, 'P2', c2);
    c1 = a.next; c2 = b.next;
    const input = { p1: a.input, p2: b.input };
    inputs.push(input);
    sim.step(state, input, framesToSeconds(1), {
      onActionStart: (event) => accepted.push({ frame, ...event }),
    });
    checksums.push(computeStateChecksum(state));
    for (const id of ['P1', 'P2'] as const) {
      if (state.players[id].helpless > 0) launched.add(id);
      if (state.players[id].parryFlash > 0) parried.add(id);
    }
  }
  const replay = sim.createStateSnapshot(source.state);
  inputs.forEach((input, index) => {
    sim.step(replay, input, framesToSeconds(1));
    expect(computeStateChecksum(replay)).toBe(checksums[index]);
  });
  return { state, inputs, checksums, accepted, launched, parried };
}

describe('AI flow incident regressions', () => {
  test.each([false, true])('early closing intercept actually wins, mirror=%s', (mirror) => {
    const source = incident(1, mirror);
    const attacker = mirror ? 'P2' : 'P1';
    const target = other(attacker);
    const distance = Math.hypot(source.state.players[attacker].pos.x - source.state.players[target].pos.x,
      source.state.players[attacker].pos.y - source.state.players[target].pos.y);
    expect(distance).toBeGreaterThan(48);
    const result = runLive(source, 70);
    expect(result.accepted[0]).toMatchObject({ frame: 0, playerId: attacker, action: 'dunk' });
    expect(result.state.winner).toBe(attacker);
    expect(result.inputs.length).toBeLessThanOrEqual(36);
    expect(runLive(incident(1, mirror), 70).checksums).toEqual(result.checksums);
  });

  test.each([false, true])('late interception waits instead of committing to a punish, mirror=%s', (mirror) => {
    const source = incident(2, mirror);
    const id = mirror ? 'P2' : 'P1';
    const tick = tickAiController(source.state, id, mirror ? source.c2 : source.c1);
    expect(tick.input.dunk).toBe(false);
    expect(tick.decision.candidates.dunk.reason).toBe('no_safe_intercept');
    const forced = sim.createStateSnapshot(source.state);
    for (let frame = 0; frame < 40 && !forced.winner; frame++) {
      const input = finishChaseInput(forced, id, false);
      input.dunk = frame === 0;
      const defense = idle();
      defense.launch = forced.players[other(id)].helpless <= 0;
      sim.step(forced, id === 'P1' ? { p1: input, p2: defense } : { p1: defense, p2: input }, 1 / 60);
    }
    expect(forced.winner).not.toBe(id);
  });

  test.each([false, true])('recorded return retains steering and avoids immediate relaunch, mirror=%s', (mirror) => {
    const source = incident(0, mirror);
    const id = mirror ? 'P1' : 'P2';
    const tick = tickAiController(source.state, id, mirror ? source.c1 : source.c2);
    expect(tick.input.special).toBe(false);
    expect(Math.hypot(tick.input.moveX, tick.input.moveY)).toBeGreaterThan(0.5);
    const result = runLive(source, 60);
    expect(result.state.players[id].helpless).toBe(0);
    expect(result.launched.has(id)).toBe(false);
    expect(result.parried.has(id)).toBe(true);
    expect(result.accepted.some((event) => event.playerId === id && event.action === 'parry')).toBe(true);
  });

  test.each(['P1', 'P2'] as const)('ready-opponent veto retains an accepted parry and punish dash for %s', (id) => {
    const opponent = other(id);
    const state = sim.createInitialState({ loadout: { [id]: 'duelist', [opponent]: 'vanguard' } });
    state.players[id].pos = { x: 0, y: 0 }; state.players[opponent].pos = { x: 15.24, y: 0 };
    const controller = { ...createAiController({ seed: 130, profileId: 'veteran', behaviorTuning: {
      ...createDefaultAiBehaviorTuning(), errorRateScale: 0, launchWeightScale: 0, parryWeightScale: 4,
    } }), wasHelpless: true, reactionFramesRemaining: 0 };
    const tick = tickAiController(state, id, controller);
    expect(tick.input.special).toBe(false);
    state.players[opponent].pos.x = 6;
    state.players[opponent].launchStartup = framesToSeconds(2);
    const defense = tickAiController(state, id, tick.next);
    expect(defense.input.parry).toBe(true);
    for (let frame = 0; frame < 4; frame++) {
      const own = frame === 0 ? defense.input : idle();
      sim.step(state, id === 'P1' ? { p1: own, p2: idle() } : { p1: idle(), p2: own }, 1 / 60);
    }
    expect(state.players[id].parryFlash).toBeGreaterThan(0);
    expect(state.players[id].helpless).toBe(0);
    state.players[id].parry = 0;
    state.players[id].endLag = 0;
    state.players[opponent].endLag = framesToSeconds(30);
    state.players[opponent].launchStartup = 0;
    state.players[opponent].launchActive = 0;
    const punish = tickAiController(state, id, controller);
    expect(punish.input.special).toBe(true);
    const accepted: string[] = [];
    sim.step(state, id === 'P1' ? { p1: punish.input, p2: idle() } : { p1: idle(), p2: punish.input }, 1 / 60,
      { onActionStart: (event) => { if (event.playerId === id) accepted.push(event.action); } });
    expect(accepted).toContain('special');
  });

  test('wrap interception produces an actual win', () => {
    const source = incident(1);
    source.state.players.P1.pos = { x: -45, y: 0 };
    source.state.players.P1.vel = { x: 0, y: 0 };
    source.state.players.P2.pos = { x: 74, y: 0 };
    source.state.players.P2.vel = { x: 100, y: 0 };
    const tick = tickAiController(source.state, 'P1', source.c1);
    expect(tick.input.dunk).toBe(true);
    const result = runLive(source, 50);
    expect(result.state.winner).toBe('P1');
  });

  test.each(['P1', 'P2'] as const)('does not extend the return dash veto beyond pressure for %s', (id) => {
    const target = other(id);
    const state = sim.createInitialState({ loadout: { [id]: 'duelist', [target]: 'vanguard' } });
    state.players[id].pos = { x: 0, y: 0 }; state.players[target].pos = { x: 30, y: 0 };
    const controller = { ...createAiController({ seed: 130, profileId: 'veteran', behaviorTuning: {
      ...createDefaultAiBehaviorTuning(), errorRateScale: 0,
    } }), postControlFirstChoiceFramesRemaining: 30, reactionFramesRemaining: 0 };
    expect(tickAiController(state, id, controller).input.special).toBe(true);
    state.players[target].pos.x = 15;
    state.players[target].cool.launch = 1;
    expect(tickAiController(state, id, controller).input.special).toBe(true);
  });

  test.each([false, true])('punishes an authored zero-fuel whiff with an actual finish, mirror=%s', (mirror) => {
    const source = incident(1, mirror);
    const id = mirror ? 'P2' : 'P1'; const target = other(id);
    const moves = createCharacterBalanceConfig('duelist').moves;
    source.state.players[id].pos = { x: 0, y: 0 };
    source.state.players[id].vel = { x: 0, y: 0 };
    source.state.players[target].pos = { x: 8, y: 0 };
    source.state.players[target].vel = { x: 0, y: 0 };
    source.state.players[target].helpless = 0;
    source.state.players[target].endLag = framesToSeconds(moves.launch.recoveryOnWhiffFrames);
    const result = runLive(source, 50);
    expect(result.accepted[0]).toMatchObject({ playerId: id, action: 'dunk', frame: 0 });
    expect(result.state.winner).toBe(id);
  });

  test('automatic post-parry steering does not expire in action recovery', () => {
    const source = incident(0);
    source.state.players.P2.endLag = framesToSeconds(10);
    source.c2.postControlSteeringFramesRemaining = 7;
    const recovering = tickAiController(source.state, 'P2', source.c2);
    expect(recovering.next.postControlSteeringFramesRemaining).toBe(7);
    source.state.players.P2.endLag = 0;
    const ready = tickAiController(source.state, 'P2', recovering.next);
    expect(ready.next.postControlSteeringFramesRemaining).toBe(6);
  });

  test('pre-existing forced recovery is not mistaken for a forecast connection', () => {
    const source = incident(1);
    const target = source.state.players.P2;
    target.helpless = 0;
    target.recovering = 2;
    target.recoveryDuration = 2;
    target.recoveryDir = { x: 0, y: -1 };
    source.state.players.P1.pos = { x: 70, y: 0 };
    source.state.players.P1.vel = { x: 0, y: 0 };
    expect(canInterceptFinish(source.state, 'P1', idle())).toBe(false);
  });

  test('receding and imminently released targets do not trigger a speculative finish', () => {
    for (const release of [false, true]) {
      const source = incident(1);
      if (release) source.state.players.P2.helpless = framesToSeconds(2);
      else {
        source.state.players.P2.vel.x *= -1;
        source.state.players.P2.vel.y *= -1;
      }
      expect(tickAiController(source.state, 'P1', source.c1).input.dunk).toBe(false);
    }
  });

  test('forecast does not mutate state, RNG, controller or emit live telemetry', () => {
    const source = incident(1);
    const before = structuredClone(source);
    const spy = vi.spyOn(sim, 'step');
    try {
      expect(tickAiController(source.state, 'P1', source.c1).input.dunk).toBe(true);
      expect(source).toEqual(before);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(MAX_FINISH_FORECAST_FRAMES);
      expect(spy.mock.calls.every(([state, , , observer]) => state !== source.state && observer === undefined)).toBe(true);
    } finally { spy.mockRestore(); }
  });

  test('long authored startups are bounded without changing move data', () => {
    const source = incident(1);
    const config = createCharacterBalanceConfig('vanguard');
    config.moves.dunk.startupFrames = MAX_FINISH_FORECAST_FRAMES;
    config.moves.dunk.activeFrames = 600;
    source.state.characterBalanceOverrides = { vanguard: config };
    const before = structuredClone(source.state);
    const spy = vi.spyOn(sim, 'step');
    try {
      expect(canInterceptFinish(source.state, 'P1', idle())).toBe(false);
      expect(spy).not.toHaveBeenCalled();
      expect(source.state).toEqual(before);
    } finally { spy.mockRestore(); }
  });

  test('long active windows cannot exceed the forecast work cap', () => {
    const source = incident(1);
    const config = createCharacterBalanceConfig('vanguard');
    config.moves.dunk.startupFrames = MAX_FINISH_FORECAST_FRAMES - 1;
    config.moves.dunk.activeFrames = 600;
    source.state.characterBalanceOverrides = { vanguard: config };
    source.state.players.P2.vel = { x: 10000, y: 0 };
    source.state.players.P2.helpless = 20;
    const spy = vi.spyOn(sim, 'step');
    try {
      canInterceptFinish(source.state, 'P1', idle());
      expect(spy.mock.calls.length).toBe(MAX_FINISH_FORECAST_FRAMES);
    } finally { spy.mockRestore(); }
  });

  test('reports warm two-AI tick cost with forecast exposure', () => {
    const sources = [incident(1), incident(2)];
    const durations: number[] = [];
    for (let iteration = 0; iteration < 1200; iteration++) {
      const source = sources[iteration % sources.length];
      const start = performance.now();
      tickAiController(source.state, 'P1', source.c1);
      tickAiController(source.state, 'P2', source.c2);
      if (iteration >= 200) durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    console.error('Two-AI forecast ticks (ms)', {
      median: durations[500], p95: durations[950], p99: durations[990], max: durations[999],
    });
  });
});
