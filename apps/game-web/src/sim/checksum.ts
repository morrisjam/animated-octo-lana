import type { GameState } from './types';
import { fingerprintDeterministicValue } from './fingerprint';
import { fingerprintGameTuning } from './tuning';

function addHashNumber(hash: number, value: number): number {
  const next = (hash ^ (value >>> 0)) >>> 0;
  return Math.imul(next, 16777619) >>> 0;
}

function quantise(value: number): number {
  return Math.round(value * 1000);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function computeStateChecksum(state: GameState): number {
  let hash = 2166136261;
  hash = addHashNumber(hash, state.seed);
  hash = addHashNumber(hash, state.rngState);
  hash = addHashNumber(hash, quantise(state.gameTime));
  hash = addHashNumber(hash, state.nextProjectileId);
  hash = addHashNumber(hash, state.winner === 'P1' ? 1 : state.winner === 'P2' ? 2 : 0);
  hash = addHashNumber(hash, state.projectiles.length);
  hash = addHashNumber(hash, state.rules.allowDunkWin ? 1 : 0);
  hash = addHashNumber(hash, hashString(fingerprintGameTuning(state.tuning)));
  hash = addHashNumber(hash, hashString(fingerprintDeterministicValue(state.characterBalanceOverrides ?? {})));

  const players = [state.players.P1, state.players.P2];
  for (const player of players) {
    hash = addHashNumber(hash, hashString(player.characterId));
    hash = addHashNumber(hash, quantise(player.pos.x));
    hash = addHashNumber(hash, quantise(player.pos.y));
    hash = addHashNumber(hash, quantise(player.vel.x));
    hash = addHashNumber(hash, quantise(player.vel.y));
    hash = addHashNumber(hash, quantise(player.maxFuel));
    hash = addHashNumber(hash, quantise(player.fuel));
    hash = addHashNumber(hash, quantise(player.helpless));
    hash = addHashNumber(hash, quantise(player.stunned));
    hash = addHashNumber(hash, player.launchBreaks);
    hash = addHashNumber(hash, player.chain);
    if (player.combatBoostLockRemaining > 0) {
      hash = addHashNumber(hash, 0x43424c4b);
      hash = addHashNumber(hash, quantise(player.combatBoostLockRemaining));
    }
    if (player.specialDir && (player.specialDir.x !== 0 || player.specialDir.y !== 0)) {
      hash = addHashNumber(hash, 0x53504452);
      hash = addHashNumber(hash, quantise(player.specialDir.x));
      hash = addHashNumber(hash, quantise(player.specialDir.y));
    }
    if (
      player.launchAttemptSerial !== 0
      || player.postControlCounterPending
      || player.postControlCounterWindow > 0
      || player.postControlCounterOpponentLaunchSerialAtReturn !== 0
      || player.postControlCounterLaunchEligible
    ) {
      hash = addHashNumber(hash, 0x5043434c);
      hash = addHashNumber(hash, player.launchAttemptSerial);
      hash = addHashNumber(hash, player.postControlCounterPending ? 1 : 0);
      hash = addHashNumber(hash, quantise(player.postControlCounterWindow));
      hash = addHashNumber(hash, player.postControlCounterOpponentLaunchSerialAtReturn);
      hash = addHashNumber(hash, player.postControlCounterLaunchEligible ? 1 : 0);
    }
  }

  for (const projectile of state.projectiles) {
    hash = addHashNumber(hash, projectile.id);
    hash = addHashNumber(hash, projectile.ownerId === 'P1' ? 1 : 2);
    hash = addHashNumber(hash, quantise(projectile.pos.x));
    hash = addHashNumber(hash, quantise(projectile.pos.y));
    hash = addHashNumber(hash, quantise(projectile.vel.x));
    hash = addHashNumber(hash, quantise(projectile.vel.y));
    hash = addHashNumber(hash, quantise(projectile.life));
    hash = addHashNumber(hash, quantise(projectile.hitRadius));
    hash = addHashNumber(hash, quantise(projectile.stunSeconds));
    hash = addHashNumber(hash, quantise(projectile.fuelDamage));
    hash = addHashNumber(hash, hashString(projectile.visualId));
  }

  return hash >>> 0;
}
