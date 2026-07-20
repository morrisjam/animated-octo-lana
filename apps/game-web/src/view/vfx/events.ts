import type { PlayerId, RenderSnapshot, Vec2 } from '../../sim/types';
import type { CombatVfxEvent } from './types';

const EPSILON = 1e-6;

function subtractVec2(a: Vec2, b: Vec2): Vec2 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

function normaliseDirection(vector: Vec2): Vec2 {
  const lengthSq = vector.x * vector.x + vector.y * vector.y;
  if (lengthSq <= EPSILON) {
    return { x: 1, y: 0 };
  }
  const length = Math.sqrt(lengthSq);
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function hasFlashRise(previous: number, current: number): boolean {
  return current > previous + EPSILON;
}

function addPlayerEvent(
  events: CombatVfxEvent[],
  type: CombatVfxEvent['type'],
  playerId: PlayerId,
  snapshot: RenderSnapshot,
  direction: Vec2,
): void {
  const player = snapshot.players[playerId];
  events.push({
    type,
    playerId,
    characterId: player.characterId,
    position: { x: player.pos.x, y: player.pos.y },
    direction,
  });
}

function collectPlayerEvents(previous: RenderSnapshot, current: RenderSnapshot, events: CombatVfxEvent[]): void {
  const playerIds: PlayerId[] = ['P1', 'P2'];
  for (const playerId of playerIds) {
    const opponentId: PlayerId = playerId === 'P1' ? 'P2' : 'P1';
    const previousPlayer = previous.players[playerId];
    const currentPlayer = current.players[playerId];
    const previousOpponent = previous.players[opponentId];
    const currentOpponent = current.players[opponentId];
    const moveDelta = subtractVec2(currentPlayer.pos, previousPlayer.pos);
    const direction = normaliseDirection(moveDelta);

    const launchTriggered = hasFlashRise(previousPlayer.launchFlash, currentPlayer.launchFlash);
    const opponentLaunchTriggered = hasFlashRise(previousOpponent.launchFlash, currentOpponent.launchFlash);
    const clashTriggered = launchTriggered
      && opponentLaunchTriggered
      && currentPlayer.helpless <= 0
      && currentOpponent.helpless <= 0;
    if (clashTriggered) {
      addPlayerEvent(
        events,
        'clash',
        playerId,
        current,
        normaliseDirection(subtractVec2(currentPlayer.pos, currentOpponent.pos)),
      );
    } else if (launchTriggered) {
      addPlayerEvent(events, 'launch', playerId, current, direction);
    }

    const parryTriggered = hasFlashRise(previousPlayer.parryFlash, currentPlayer.parryFlash);
    if (parryTriggered) {
      addPlayerEvent(events, 'parry', playerId, current, direction);
    }

    const dunkTriggered = hasFlashRise(previousPlayer.dunkFlash, currentPlayer.dunkFlash);
    if (dunkTriggered) {
      addPlayerEvent(events, 'dunk', playerId, current, direction);
    }

    const specialTriggered = hasFlashRise(previousPlayer.specialFlash, currentPlayer.specialFlash);
    if (specialTriggered) {
      addPlayerEvent(events, 'special', playerId, current, direction);
    }
    const breakTriggered = hasFlashRise(previousPlayer.breakFlash, currentPlayer.breakFlash);
    if (breakTriggered) {
      addPlayerEvent(events, 'break', playerId, current, direction);
    }
    const combatActionResolved = launchTriggered || clashTriggered || parryTriggered || dunkTriggered || specialTriggered || breakTriggered;
    const inBoostEligibleState = currentPlayer.helpless <= 0 && currentPlayer.recovering <= 0 && currentPlayer.parry <= 0;
    const superBoostTriggered = !combatActionResolved
      && inBoostEligibleState
      && previousPlayer.superBoost <= EPSILON
      && currentPlayer.superBoost > EPSILON;
    if (superBoostTriggered) {
      addPlayerEvent(events, 'super_boost', playerId, current, direction);
    }
    const boostTriggered = !combatActionResolved
      && inBoostEligibleState
      && !previousPlayer.boostActive
      && currentPlayer.boostActive
      && currentPlayer.superBoost <= EPSILON;
    if (boostTriggered) {
      addPlayerEvent(events, 'boost', playerId, current, direction);
    }
  }
}

function collectProjectileSpawnEvents(previous: RenderSnapshot, current: RenderSnapshot, events: CombatVfxEvent[]): void {
  const previousProjectileIds = new Set(previous.projectiles.map((projectile) => projectile.id));
  for (const projectile of current.projectiles) {
    if (previousProjectileIds.has(projectile.id)) {
      continue;
    }
    const owner = current.players[projectile.ownerId];
    const direction = normaliseDirection(subtractVec2(projectile.pos, owner.pos));
    events.push({
      type: 'projectile',
      playerId: projectile.ownerId,
      characterId: owner.characterId,
      position: { x: projectile.pos.x, y: projectile.pos.y },
      direction,
      projectileVisualId: projectile.visualId,
    });
  }
}

export function extractCombatVfxEvents(previous: RenderSnapshot | null, current: RenderSnapshot): CombatVfxEvent[] {
  if (!previous) {
    return [];
  }
  if (current.gameTime + EPSILON < previous.gameTime) {
    return [];
  }

  const events: CombatVfxEvent[] = [];
  collectPlayerEvents(previous, current, events);
  collectProjectileSpawnEvents(previous, current, events);
  return events;
}

