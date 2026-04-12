import { computeStateChecksum } from './checksum';
import { BALANCE_PROFILE_IDS, resolveBalanceProfile } from './balanceProfiles';
import { createInitialState, step } from './sim';
import type { FrameInput, GameState } from './types';

export interface MatchupSmokeFixtureRuntime {
  maxProjectilesSeen: number;
}

export interface MatchupSmokeFixtureResultSnapshot {
  winner: GameState['winner'];
  p1Chain: number;
  p1StunnedFrames: number;
  p2HelplessFrames: number;
  p2RecoveringFrames: number;
  p2LastLaunchedBy: GameState['players']['P2']['lastLaunchedBy'];
  projectilesRemaining: number;
  maxProjectilesSeen: number;
}

export interface MatchupSmokeFixtureResult {
  profileId: string;
  fixtureId: string;
  fixtureDescription: string;
  semanticPass: boolean;
  semanticMessage: string;
  finalChecksum: number;
  finalSnapshot: MatchupSmokeFixtureResultSnapshot;
}

export interface MatchupSmokeSuiteResult {
  generatedAt: string;
  profileIds: string[];
  fixtureIds: string[];
  pass: boolean;
  results: MatchupSmokeFixtureResult[];
}

export interface MatchupSmokeExpectedFixture {
  finalChecksum: number;
}

export interface MatchupSmokeExpectedProfile {
  fixtures: Record<string, MatchupSmokeExpectedFixture>;
}

export interface MatchupSmokeExpectedBaseline {
  generatedAt: string;
  profileIds: string[];
  fixtureIds: string[];
  profiles: Record<string, MatchupSmokeExpectedProfile>;
}

interface MatchupSmokeFixture {
  id: string;
  description: string;
  totalFrames: number;
  loadout?: {
    P1: GameState['loadout']['P1'];
    P2: GameState['loadout']['P2'];
  };
  setup: (state: GameState) => void;
  inputForFrame: (frame: number) => FrameInput;
  semanticCheck: (state: GameState, runtime: MatchupSmokeFixtureRuntime) => { pass: boolean; message: string };
}

const FIXED_DT = 1 / 60;

function toFrames(seconds: number): number {
  return Math.max(0, Math.round(seconds * 60));
}

function neutralInput(): FrameInput {
  return {
    p1: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
    p2: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
  };
}

function launchInput(frame: number): FrameInput {
  const input = neutralInput();
  if (frame === 0) {
    input.p1.launch = true;
  }
  return input;
}

function parryCounterInput(frame: number): FrameInput {
  const input = neutralInput();
  if (frame === 0) {
    input.p1.launch = true;
    input.p2.parry = true;
  }
  return input;
}

function dunkInput(frame: number): FrameInput {
  const input = neutralInput();
  if (frame === 0) {
    input.p1.dunk = true;
  }
  return input;
}

function specialInput(frame: number): FrameInput {
  const input = neutralInput();
  if (frame === 0) {
    input.p1.special = true;
  }
  return input;
}

const MATCHUP_SMOKE_FIXTURES: MatchupSmokeFixture[] = [
  {
    id: 'launch_connect',
    description: 'P1 launch connects from close range and starts helpless state.',
    totalFrames: 32,
    setup: (state) => {
      state.players.P1.pos = { x: 20, y: 0 };
      state.players.P2.pos = { x: 24, y: 0 };
    },
    inputForFrame: launchInput,
    semanticCheck: (state) => {
      if (state.players.P1.chain < 1) {
        return { pass: false, message: 'Launch did not increment P1 chain.' };
      }
      if (state.players.P2.helpless <= 0) {
        return { pass: false, message: 'Launch did not place P2 in helpless state.' };
      }
      if (state.players.P2.lastLaunchedBy !== 'P1') {
        return { pass: false, message: 'P2 lastLaunchedBy was not set to P1.' };
      }
      return { pass: true, message: 'Launch connect behavior is stable.' };
    },
  },
  {
    id: 'launch_vs_parry',
    description: 'P2 parry counters P1 launch and stuns attacker.',
    totalFrames: 24,
    setup: (state) => {
      state.players.P1.pos = { x: 20, y: 0 };
      state.players.P2.pos = { x: 24, y: 0 };
      state.players.P1.chain = 2;
      state.players.P1.chainTimer = 0.8;
    },
    inputForFrame: parryCounterInput,
    semanticCheck: (state) => {
      if (state.players.P1.stunned <= 0) {
        return { pass: false, message: 'Parry counter did not stun P1.' };
      }
      if (state.players.P1.chain !== 0) {
        return { pass: false, message: 'Parry counter did not reset P1 chain.' };
      }
      if (state.players.P2.lastLaunchedBy === 'P1') {
        return { pass: false, message: 'Parry target was incorrectly marked as launched by P1.' };
      }
      return { pass: true, message: 'Parry counter behavior is stable.' };
    },
  },
  {
    id: 'dunk_connect',
    description: 'P1 dunk connects and transitions defender into recovery portal state.',
    totalFrames: 44,
    setup: (state) => {
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P2.pos = { x: 5, y: 0 };
      state.players.P1.fuel = 0;
    },
    inputForFrame: dunkInput,
    semanticCheck: (state) => {
      if (state.players.P2.recovering <= 0) {
        return { pass: false, message: 'Dunk did not trigger recovery state on P2.' };
      }
      return { pass: true, message: 'Dunk recovery behavior is stable.' };
    },
  },
  {
    id: 'special_projectile_spawn',
    description: 'Projectile archetype special resolves and spawns at least one projectile.',
    totalFrames: 12,
    loadout: {
      P1: 'ace',
      P2: 'duelist',
    },
    setup: (state) => {
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P2.pos = { x: 36, y: 0 };
    },
    inputForFrame: specialInput,
    semanticCheck: (state, runtime) => {
      if (runtime.maxProjectilesSeen < 1) {
        return { pass: false, message: 'Special did not spawn any projectile.' };
      }
      if (state.players.P1.cool.special <= 0) {
        return { pass: false, message: 'Special cooldown was not applied.' };
      }
      return { pass: true, message: 'Special projectile behavior is stable.' };
    },
  },
  {
    id: 'special_guard_window',
    description: 'Vanguard special resolves into a guard window instead of a projectile.',
    totalFrames: 18,
    loadout: {
      P1: 'vanguard',
      P2: 'duelist',
    },
    setup: (state) => {
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P2.pos = { x: 18, y: 0 };
    },
    inputForFrame: specialInput,
    semanticCheck: (state, runtime) => {
      if (state.players.P1.parry <= 0) {
        return { pass: false, message: 'Guard special did not grant a parry window.' };
      }
      if (runtime.maxProjectilesSeen !== 0) {
        return { pass: false, message: 'Guard special incorrectly spawned a projectile.' };
      }
      return { pass: true, message: 'Guard special behavior is stable.' };
    },
  },
  {
    id: 'special_dash_resolve',
    description: 'Duelist special resolves into a forward dash without spawning a projectile.',
    totalFrames: 12,
    loadout: {
      P1: 'duelist',
      P2: 'vanguard',
    },
    setup: (state) => {
      state.players.P1.pos = { x: 0, y: 0 };
      state.players.P2.pos = { x: 20, y: 0 };
    },
    inputForFrame: specialInput,
    semanticCheck: (state, runtime) => {
      if (state.players.P1.pos.x <= 0.5) {
        return { pass: false, message: 'Dash special did not carry P1 toward the target.' };
      }
      if (runtime.maxProjectilesSeen !== 0) {
        return { pass: false, message: 'Dash special incorrectly spawned a projectile.' };
      }
      return { pass: true, message: 'Dash special behavior is stable.' };
    },
  },
];

function runFixtureForProfile(profileId: string, fixture: MatchupSmokeFixture): MatchupSmokeFixtureResult {
  const profile = resolveBalanceProfile(profileId);
  const state = createInitialState(fixture.loadout ? { loadout: fixture.loadout } : undefined);
  state.tuning = { ...profile.tuning };
  fixture.setup(state);

  const runtime: MatchupSmokeFixtureRuntime = {
    maxProjectilesSeen: state.projectiles.length,
  };

  for (let frame = 0; frame < fixture.totalFrames; frame += 1) {
    const input = fixture.inputForFrame(frame);
    step(state, input, FIXED_DT);
    runtime.maxProjectilesSeen = Math.max(runtime.maxProjectilesSeen, state.projectiles.length);
  }

  const semantic = fixture.semanticCheck(state, runtime);
  return {
    profileId,
    fixtureId: fixture.id,
    fixtureDescription: fixture.description,
    semanticPass: semantic.pass,
    semanticMessage: semantic.message,
    finalChecksum: computeStateChecksum(state),
    finalSnapshot: {
      winner: state.winner,
      p1Chain: state.players.P1.chain,
      p1StunnedFrames: toFrames(state.players.P1.stunned),
      p2HelplessFrames: toFrames(state.players.P2.helpless),
      p2RecoveringFrames: toFrames(state.players.P2.recovering),
      p2LastLaunchedBy: state.players.P2.lastLaunchedBy,
      projectilesRemaining: state.projectiles.length,
      maxProjectilesSeen: runtime.maxProjectilesSeen,
    },
  };
}

function normaliseProfileIds(profileIds: string[] | undefined): string[] {
  if (!profileIds || profileIds.length === 0) {
    return [...BALANCE_PROFILE_IDS];
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of profileIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function runMatchupSmokeSuite(profileIds?: string[]): MatchupSmokeSuiteResult {
  const resolvedProfileIds = normaliseProfileIds(profileIds);
  for (const id of resolvedProfileIds) {
    resolveBalanceProfile(id);
  }
  const fixtureIds = MATCHUP_SMOKE_FIXTURES.map((fixture) => fixture.id);
  const results: MatchupSmokeFixtureResult[] = [];
  for (const profileId of resolvedProfileIds) {
    for (const fixture of MATCHUP_SMOKE_FIXTURES) {
      results.push(runFixtureForProfile(profileId, fixture));
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    profileIds: resolvedProfileIds,
    fixtureIds,
    pass: results.every((result) => result.semanticPass),
    results,
  };
}

export function buildMatchupSmokeExpectedBaseline(suite: MatchupSmokeSuiteResult): MatchupSmokeExpectedBaseline {
  const profiles: Record<string, MatchupSmokeExpectedProfile> = {};
  for (const profileId of suite.profileIds) {
    profiles[profileId] = { fixtures: {} };
  }
  for (const result of suite.results) {
    profiles[result.profileId].fixtures[result.fixtureId] = {
      finalChecksum: result.finalChecksum,
    };
  }
  return {
    generatedAt: suite.generatedAt,
    profileIds: [...suite.profileIds],
    fixtureIds: [...suite.fixtureIds],
    profiles,
  };
}

export interface MatchupSmokeBaselineComparison {
  pass: boolean;
  issues: string[];
}

export function compareMatchupSmokeAgainstBaseline(
  suite: MatchupSmokeSuiteResult,
  expected: MatchupSmokeExpectedBaseline,
): MatchupSmokeBaselineComparison {
  const issues: string[] = [];

  for (const result of suite.results) {
    const expectedProfile = expected.profiles[result.profileId];
    const expectedFixture = expectedProfile?.fixtures?.[result.fixtureId];
    if (!expectedFixture) {
      issues.push(`missing baseline entry for ${result.profileId}/${result.fixtureId}.`);
      continue;
    }
    if (expectedFixture.finalChecksum !== result.finalChecksum) {
      issues.push(
        `checksum mismatch for ${result.profileId}/${result.fixtureId}: expected ${expectedFixture.finalChecksum}, got ${result.finalChecksum}.`,
      );
    }
  }

  for (const profileId of Object.keys(expected.profiles)) {
    const expectedFixtures = expected.profiles[profileId]?.fixtures ?? {};
    for (const fixtureId of Object.keys(expectedFixtures)) {
      const present = suite.results.some((result) => result.profileId === profileId && result.fixtureId === fixtureId);
      if (!present) {
        issues.push(`baseline includes extra entry not executed by suite: ${profileId}/${fixtureId}.`);
      }
    }
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}
