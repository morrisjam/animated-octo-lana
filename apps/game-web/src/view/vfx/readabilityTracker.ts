import type { GameState, PlayerId, PlayerState } from '../../sim/types';
import type { SimulationActionStart } from '../../sim/sim';
import type { CombatVfxEvent } from './types';

const EPSILON = 1e-6;
type Evidence = Pick<PlayerState, 'characterId' | 'pos' | 'helpless' | 'recovering' | 'stunned'
  | 'parry' | 'endLag' | 'launchBreaks' | 'launchActive' | 'launchStartup' | 'launchFlash'
  | 'dunkActive' | 'dunkStartup' | 'dunkFlash'>;

function capture(player: PlayerState): Evidence {
  return {
    characterId: player.characterId, pos: { ...player.pos }, helpless: player.helpless,
    recovering: player.recovering, stunned: player.stunned, parry: player.parry,
    endLag: player.endLag, launchBreaks: player.launchBreaks, launchActive: player.launchActive,
    launchStartup: player.launchStartup, launchFlash: player.launchFlash,
    dunkActive: player.dunkActive, dunkStartup: player.dunkStartup, dunkFlash: player.dunkFlash,
  };
}

export interface CombatReadabilityTracker {
  /** Call once per presented fixed simulation step, not on speculative/resimulated frames. */
  recordFrame(state: GameState, acceptedActions?: readonly SimulationActionStart[]): CombatVfxEvent[];
  /** Reset on round/replay changes, including same-seed restarts. */
  reset(): void;
}

export function createCombatReadabilityTracker(): CombatReadabilityTracker {
  let previous: { gameTime: number; seed: number; players: Record<PlayerId, Evidence> } | null = null;
  const pendingBreak = { P1: false, P2: false };
  const reset = (): void => {
    previous = null;
    pendingBreak.P1 = false;
    pendingBreak.P2 = false;
  };
  return {
    reset,
    recordFrame(state, acceptedActions = []) {
      if (previous && state.gameTime === previous.gameTime) return [];
      const before = previous;
      const current = {
        gameTime: state.gameTime, seed: state.seed,
        players: { P1: capture(state.players.P1), P2: capture(state.players.P2) },
      };
      previous = current;
      const dt = before ? current.gameTime - before.gameTime : 0;
      if (!before || current.seed !== before.seed || dt <= 0 || dt > 1 / 30 + EPSILON || state.winner
        || current.players.P1.characterId !== before.players.P1.characterId
        || current.players.P2.characterId !== before.players.P2.characterId) {
        pendingBreak.P1 = pendingBreak.P2 = false;
        return [];
      }
      const events: CombatVfxEvent[] = [];
      const emit = (playerId: PlayerId, type: CombatVfxEvent['type'], readabilityCue: CombatVfxEvent['readabilityCue']): void => {
        const player = current.players[playerId];
        const opponent = current.players[playerId === 'P1' ? 'P2' : 'P1'];
        const dx = opponent.pos.x - player.pos.x;
        const dy = opponent.pos.y - player.pos.y;
        const length = Math.hypot(dx, dy);
        events.push({
          type, playerId, characterId: player.characterId, position: { ...player.pos }, readabilityCue,
          direction: length > EPSILON ? { x: dx / length, y: dy / length } : { x: playerId === 'P1' ? 1 : -1, y: 0 },
        });
      };
      for (const playerId of ['P1', 'P2'] as const) {
        const opponentId = playerId === 'P1' ? 'P2' : 'P1';
        const a = before.players[playerId];
        const b = current.players[playerId];
        const targetBefore = before.players[opponentId];
        const target = current.players[opponentId];
        const interrupted = b.helpless > 0 || b.recovering > 0 || b.stunned > 0;
        // Guard consumption plus a cancelled launch and new counter-stun, not the attempt flash.
        const guardWasActive = a.parry > dt + EPSILON || acceptedActions.some(
          (event) => event.playerId === playerId && event.action === 'parry',
        );
        if (guardWasActive && b.parry <= 0 && !interrupted
          && targetBefore.launchActive > 0 && target.launchActive <= 0
          && target.stunned > targetBefore.stunned + EPSILON) {
          emit(playerId, 'parry', 'parry_success');
          emit(opponentId, 'launch', 'attack_recovery');
        }
        const spentBreak = b.launchBreaks < a.launchBreaks && a.helpless > 0 && b.helpless <= 0;
        if (spentBreak) pendingBreak[playerId] = true;
        if (pendingBreak[playerId]) {
          if (b.helpless > 0 || b.recovering > 0 || (!spentBreak && b.stunned > a.stunned + EPSILON)) {
            pendingBreak[playerId] = false;
          } else if (b.stunned <= 0 && b.endLag <= 0) {
            emit(playerId, 'break', 'break_ready');
            pendingBreak[playerId] = false;
          }
        }
        if (interrupted || b.endLag <= a.endLag + EPSILON) continue;
        for (const action of ['launch', 'dunk'] as const) {
          const expired = a[`${action}Active`] > 0 && a[`${action}Active`] <= dt + EPSILON
            && b[`${action}Active`] <= 0 && b[`${action}Startup`] <= 0;
          const impact = b[`${action}Flash`] > a[`${action}Flash`] + EPSILON
            || target[`${action}Flash`] > targetBefore[`${action}Flash`] + EPSILON
            || target.recovering > targetBefore.recovering + EPSILON;
          if (expired && !impact) emit(playerId, action, 'attack_whiff');
        }
      }
      return events;
    },
  };
}
