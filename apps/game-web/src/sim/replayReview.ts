import { createInitialState, createStateSnapshot, getRenderSnapshot, step } from './sim';
import { secondsToFrames, secondsToSignedFrames } from './moveData';
import type { ReplayPayload, ReplayRoundDescriptor } from './replay';
import type { FrameInput, GameState, PlayerFrameInput, PlayerId, PlayersById, RenderSnapshot } from './types';

const DEFAULT_FIXED_DT = 1 / 60;
const EPSILON = 0.0001;

type ReplayMoveId = 'launch' | 'dunk' | 'special' | 'parry' | 'break';
type ReplayEventOutcome = 'hit' | 'block' | 'whiff' | 'resolved';

export interface ReplayRoundMarker {
  index: number;
  label: string;
  startFrame: number;
  endFrame: number;
}

export interface ReplayMovePhaseData {
  phase: 'idle' | 'startup' | 'active' | 'recovery';
  startupFramesRemaining: number;
  activeFramesRemaining: number;
  recoveryFramesRemaining: number;
}

export interface ReplayPlayerFrameData {
  playerId: PlayerId;
  status: 'neutral' | 'helpless' | 'stunned' | 'recovering';
  launch: ReplayMovePhaseData;
  dunk: ReplayMovePhaseData;
  special: ReplayMovePhaseData;
  parryFramesRemaining: number;
}

export interface ReplayFrameEvent {
  frame: number;
  playerId: PlayerId;
  move: ReplayMoveId;
  outcome: ReplayEventOutcome;
  advantageFrames: number | null;
  description: string;
}

export interface ReplayReviewFrame {
  frame: number;
  input: FrameInput;
  snapshot: RenderSnapshot;
  frameData: PlayersById<ReplayPlayerFrameData>;
  events: ReplayFrameEvent[];
}

export interface ReplayReviewData {
  fixedDt: number;
  totalFrames: number;
  rounds: ReplayRoundMarker[];
  frames: ReplayReviewFrame[];
}

export function buildReplayReviewData(payload: ReplayPayload): ReplayReviewData {
  const fixedDt = Number.isFinite(payload.header.fixedDt) && (payload.header.fixedDt as number) > 0
    ? Number(payload.header.fixedDt)
    : DEFAULT_FIXED_DT;
  const state = createInitialState({
    seed: payload.header.seed,
    loadout: payload.header.loadout,
  });
  const frames: ReplayReviewFrame[] = [];

  for (let frame = 0; frame < payload.inputTimeline.length; frame += 1) {
    const input = normaliseFrameInput(payload.inputTimeline[frame]);
    const previousState = createStateSnapshot(state);
    step(state, input, fixedDt);
    const currentState = createStateSnapshot(state);
    frames.push({
      frame,
      input,
      snapshot: getRenderSnapshot(state),
      frameData: {
        P1: buildPlayerFrameData(currentState, 'P1'),
        P2: buildPlayerFrameData(currentState, 'P2'),
      },
      events: collectFrameEvents(frame, previousState, currentState),
    });
  }

  if (frames.length === 0) {
    frames.push({
      frame: 0,
      input: normaliseFrameInput(undefined),
      snapshot: getRenderSnapshot(state),
      frameData: {
        P1: buildPlayerFrameData(state, 'P1'),
        P2: buildPlayerFrameData(state, 'P2'),
      },
      events: [],
    });
  }

  return {
    fixedDt,
    totalFrames: frames.length,
    rounds: buildRoundMarkers(payload.rounds, frames.length),
    frames,
  };
}

function buildRoundMarkers(rounds: ReplayRoundDescriptor[] | undefined, totalFrames: number): ReplayRoundMarker[] {
  if (Array.isArray(rounds) && rounds.length > 0) {
    const markers = rounds
      .map((round, index) => {
        const startFrame = clampFrame(round.startFrame, totalFrames);
        const endFrame = clampFrame(round.endFrame ?? (totalFrames - 1), totalFrames);
        if (endFrame < startFrame) {
          return null;
        }
        const fallbackRound = round.round ?? (index + 1);
        const label = round.label?.trim() || `Round ${fallbackRound}`;
        return {
          index,
          label,
          startFrame,
          endFrame,
        } satisfies ReplayRoundMarker;
      })
      .filter((marker): marker is ReplayRoundMarker => marker !== null)
      .sort((a, b) => a.startFrame - b.startFrame);
    if (markers.length > 0) {
      return markers;
    }
  }

  return [{
    index: 0,
    label: 'Round 1',
    startFrame: 0,
    endFrame: Math.max(0, totalFrames - 1),
  }];
}

function clampFrame(frame: number, totalFrames: number): number {
  if (!Number.isFinite(frame)) {
    return 0;
  }
  return Math.max(0, Math.min(totalFrames - 1, Math.floor(frame)));
}

function buildPlayerFrameData(state: GameState, playerId: PlayerId): ReplayPlayerFrameData {
  const player = state.players[playerId];
  return {
    playerId,
    status: player.recovering > 0
      ? 'recovering'
      : player.helpless > 0
        ? 'helpless'
        : player.stunned > 0
          ? 'stunned'
          : 'neutral',
    launch: buildMovePhaseData(
      player.launchStartup,
      player.launchActive,
      player.endLag > 0 && player.cool.launch > 0 ? Math.min(player.endLag, player.cool.launch) : 0,
    ),
    dunk: buildMovePhaseData(
      player.dunkStartup,
      player.dunkActive,
      player.endLag > 0 && player.cool.dunk > 0 ? Math.min(player.endLag, player.cool.dunk) : 0,
    ),
    special: buildMovePhaseData(
      player.specialStartup,
      player.specialActive,
      player.endLag > 0 && player.cool.special > 0 ? Math.min(player.endLag, player.cool.special) : 0,
    ),
    parryFramesRemaining: toFrames(player.parry),
  };
}

function buildMovePhaseData(startupSeconds: number, activeSeconds: number, recoverySeconds: number): ReplayMovePhaseData {
  if (startupSeconds > 0) {
    return {
      phase: 'startup',
      startupFramesRemaining: toFrames(startupSeconds),
      activeFramesRemaining: 0,
      recoveryFramesRemaining: 0,
    };
  }
  if (activeSeconds > 0) {
    return {
      phase: 'active',
      startupFramesRemaining: 0,
      activeFramesRemaining: toFrames(activeSeconds),
      recoveryFramesRemaining: 0,
    };
  }
  if (recoverySeconds > 0) {
    return {
      phase: 'recovery',
      startupFramesRemaining: 0,
      activeFramesRemaining: 0,
      recoveryFramesRemaining: toFrames(recoverySeconds),
    };
  }
  return {
    phase: 'idle',
    startupFramesRemaining: 0,
    activeFramesRemaining: 0,
    recoveryFramesRemaining: 0,
  };
}

function collectFrameEvents(frame: number, previous: GameState, current: GameState): ReplayFrameEvent[] {
  const events: ReplayFrameEvent[] = [];
  events.push(...collectLaunchEvents(frame, previous, current, 'P1'));
  events.push(...collectLaunchEvents(frame, previous, current, 'P2'));
  events.push(...collectDunkEvents(frame, previous, current, 'P1'));
  events.push(...collectDunkEvents(frame, previous, current, 'P2'));
  events.push(...collectSpecialEvents(frame, previous, current, 'P1'));
  events.push(...collectSpecialEvents(frame, previous, current, 'P2'));
  events.push(...collectBreakEvents(frame, previous, current, 'P1'));
  events.push(...collectBreakEvents(frame, previous, current, 'P2'));
  events.push(...collectParryEvents(frame, previous, current, 'P1'));
  events.push(...collectParryEvents(frame, previous, current, 'P2'));
  return events;
}

function collectLaunchEvents(
  frame: number,
  previous: GameState,
  current: GameState,
  playerId: PlayerId,
): ReplayFrameEvent[] {
  const opponentId = playerId === 'P1' ? 'P2' : 'P1';
  const prevPlayer = previous.players[playerId];
  const prevOpponent = previous.players[opponentId];
  const player = current.players[playerId];
  const opponent = current.players[opponentId];
  const launchResolved = (prevPlayer.launchStartup > 0 || prevPlayer.launchActive > 0)
    && player.launchStartup <= EPSILON
    && player.launchActive <= EPSILON;
  if (!launchResolved) {
    return [];
  }

  let outcome: ReplayEventOutcome = 'whiff';
  if (opponent.helpless > prevOpponent.helpless + EPSILON && opponent.lastLaunchedBy === playerId) {
    outcome = 'hit';
  } else if (player.stunned > prevPlayer.stunned + EPSILON && prevOpponent.parry > EPSILON) {
    outcome = 'block';
  }

  let advantageFrames: number | null = null;
  if (outcome === 'hit') {
    advantageFrames = toSignedFrames(opponent.helpless - player.endLag);
  } else if (outcome === 'block') {
    advantageFrames = toSignedFrames(opponent.endLag - player.stunned);
  } else {
    advantageFrames = toSignedFrames(opponent.endLag - player.endLag);
  }

  return [{
    frame,
    playerId,
    move: 'launch',
    outcome,
    advantageFrames,
    description: `${playerId} launch ${outcome}${formatAdvantageSuffix(advantageFrames)}`,
  }];
}

function collectDunkEvents(
  frame: number,
  previous: GameState,
  current: GameState,
  playerId: PlayerId,
): ReplayFrameEvent[] {
  const opponentId = playerId === 'P1' ? 'P2' : 'P1';
  const prevPlayer = previous.players[playerId];
  const prevOpponent = previous.players[opponentId];
  const player = current.players[playerId];
  const opponent = current.players[opponentId];
  const dunkResolved = (prevPlayer.dunkStartup > 0 || prevPlayer.dunkActive > 0)
    && player.dunkStartup <= EPSILON
    && player.dunkActive <= EPSILON;
  if (!dunkResolved) {
    return [];
  }

  const hit = opponent.recovering > prevOpponent.recovering + EPSILON;
  const advantageFrames = hit
    ? toSignedFrames(opponent.recovering - player.endLag)
    : toSignedFrames(opponent.endLag - player.endLag);

  return [{
    frame,
    playerId,
    move: 'dunk',
    outcome: hit ? 'hit' : 'whiff',
    advantageFrames,
    description: `${playerId} dunk ${hit ? 'hit' : 'whiff'}${formatAdvantageSuffix(advantageFrames)}`,
  }];
}

function collectSpecialEvents(
  frame: number,
  previous: GameState,
  current: GameState,
  playerId: PlayerId,
): ReplayFrameEvent[] {
  const opponentId = playerId === 'P1' ? 'P2' : 'P1';
  const prevPlayer = previous.players[playerId];
  const prevOpponent = previous.players[opponentId];
  const player = current.players[playerId];
  const opponent = current.players[opponentId];
  const specialResolved = (prevPlayer.specialStartup > 0 || prevPlayer.specialActive > 0)
    && player.specialStartup <= EPSILON
    && player.specialActive <= EPSILON;
  if (!specialResolved) {
    return [];
  }

  const hit = opponent.stunned > prevOpponent.stunned + EPSILON || opponent.fuel < prevOpponent.fuel - EPSILON;
  const spawnedProjectile = current.projectiles.length > previous.projectiles.length;
  const outcome: ReplayEventOutcome = hit ? 'hit' : spawnedProjectile ? 'resolved' : 'whiff';
  const advantageFrames = hit
    ? toSignedFrames(opponent.stunned - player.endLag)
    : toSignedFrames(opponent.endLag - player.endLag);

  return [{
    frame,
    playerId,
    move: 'special',
    outcome,
    advantageFrames,
    description: `${playerId} special ${outcome}${formatAdvantageSuffix(advantageFrames)}`,
  }];
}

function collectBreakEvents(
  frame: number,
  previous: GameState,
  current: GameState,
  playerId: PlayerId,
): ReplayFrameEvent[] {
  const opponentId = playerId === 'P1' ? 'P2' : 'P1';
  const prevPlayer = previous.players[playerId];
  const player = current.players[playerId];
  if (!(prevPlayer.helpless > EPSILON && player.helpless <= EPSILON && player.launchBreaks < prevPlayer.launchBreaks)) {
    return [];
  }
  const opponent = current.players[opponentId];
  const advantageFrames = toSignedFrames(player.stunned - opponent.endLag);
  return [{
    frame,
    playerId,
    move: 'break',
    outcome: 'resolved',
    advantageFrames,
    description: `${playerId} launch break used${formatAdvantageSuffix(advantageFrames)}`,
  }];
}

function collectParryEvents(
  frame: number,
  previous: GameState,
  current: GameState,
  playerId: PlayerId,
): ReplayFrameEvent[] {
  const opponentId = playerId === 'P1' ? 'P2' : 'P1';
  const prevPlayer = previous.players[playerId];
  const prevOpponent = previous.players[opponentId];
  const player = current.players[playerId];
  const opponent = current.players[opponentId];
  if (!(prevPlayer.parry > EPSILON && opponent.stunned > prevOpponent.stunned + EPSILON)) {
    return [];
  }
  const advantageFrames = toSignedFrames(opponent.stunned - player.endLag);
  return [{
    frame,
    playerId,
    move: 'parry',
    outcome: 'block',
    advantageFrames,
    description: `${playerId} parry success${formatAdvantageSuffix(advantageFrames)}`,
  }];
}

function formatAdvantageSuffix(advantageFrames: number | null): string {
  if (advantageFrames === null) {
    return '';
  }
  if (advantageFrames > 0) {
    return ` (+${advantageFrames}f)`;
  }
  if (advantageFrames < 0) {
    return ` (${advantageFrames}f)`;
  }
  return ' (0f)';
}

function toFrames(seconds: number): number {
  return secondsToFrames(seconds);
}

function toSignedFrames(seconds: number): number {
  return secondsToSignedFrames(seconds);
}

function normaliseFrameInput(input: Partial<FrameInput> | undefined): FrameInput {
  return {
    p1: normalisePlayerInput(input?.p1),
    p2: normalisePlayerInput(input?.p2),
  };
}

function normalisePlayerInput(input: Partial<PlayerFrameInput> | undefined): PlayerFrameInput {
  const legacyShotInput = input as Partial<PlayerFrameInput> & { shot?: boolean };
  return {
    moveX: Number.isFinite(input?.moveX) ? clampAxis(Number(input?.moveX)) : 0,
    moveY: Number.isFinite(input?.moveY) ? clampAxis(Number(input?.moveY)) : 0,
    boost: Boolean(input?.boost),
    superBoost: Boolean(input?.superBoost),
    special: Boolean(input?.special) || Boolean(legacyShotInput?.shot),
    launch: Boolean(input?.launch),
    dunk: Boolean(input?.dunk),
    parry: Boolean(input?.parry),
    breakLaunch: Boolean(input?.breakLaunch),
  };
}

function clampAxis(value: number): number {
  if (value > 1) {
    return 1;
  }
  if (value < -1) {
    return -1;
  }
  return value;
}
