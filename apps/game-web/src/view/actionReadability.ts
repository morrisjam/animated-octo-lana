import type { PlayerPresentationPhase, PlayerRenderSnapshot } from '../sim/types';

export const ACTION_READABILITY_IDS = [
  'boost',
  'super_boost',
  'special',
  'launch',
  'dunk',
  'parry',
  'launch_break',
] as const;

export type ActionReadabilityId = (typeof ACTION_READABILITY_IDS)[number];

export interface ActionReadabilityDefinition {
  id: ActionReadabilityId;
  label: string;
  color: string;
}

export interface ResolvedActionReadability {
  definition: ActionReadabilityDefinition;
  phase: PlayerPresentationPhase;
}

export interface PlayerActivityReadability {
  id: ActionReadabilityId | 'helpless' | 'recover' | 'attack_recovery' | 'idle';
  label: string;
  color: string;
}

export type PlayerIndicatorId = ActionReadabilityId | 'vulnerability';

export interface PlayerIndicatorPresentation {
  indicatorId: PlayerIndicatorId;
  phase: PlayerPresentationPhase;
  color: string;
  opacity: number;
  scale: number;
}

/** Phase-local presentation only: global time must not restart or pulse combat tells. */
export function resolvePlayerIndicatorPresentation(
  player: PlayerRenderSnapshot,
  _gameTime = 0,
): PlayerIndicatorPresentation | null {
  if (player.helpless > 0 || player.presentationAction === 'helpless') {
    return { indicatorId: 'vulnerability', phase: 'sustain', color: '#ff9b7a', opacity: 0.68, scale: 1.08 };
  }
  if (player.recovering > 0 || player.presentationAction === 'recover'
    || player.presentationAction === 'attack_recovery') {
    return { indicatorId: 'vulnerability', phase: 'recovery', color: '#a8b4ca', opacity: 0.46, scale: 1.04 };
  }
  const action = resolvePlayerActionReadability(player);
  if (!action) return null;
  const phase = action.phase;
  const elapsed = Number.isFinite(player.presentationElapsedSeconds)
    ? Math.max(0, player.presentationElapsedSeconds!) : 0.08;
  const settle = Math.min(1, elapsed / 0.08);
  const opacity = phase === 'startup' ? 0.58 + 0.14 * settle
    : phase === 'recovery' ? 0.42 : phase === 'sustain' ? 0.64 : 0.84;
  return {
    indicatorId: action.definition.id,
    phase,
    color: action.definition.color,
    opacity,
    scale: phase === 'startup' ? 0.94 + 0.04 * settle : phase === 'recovery' ? 1.04 : 1,
  };
}

export const ACTION_READABILITY_DEFINITIONS: readonly ActionReadabilityDefinition[] = [
  { id: 'boost', label: 'Boost', color: '#45dcff' },
  { id: 'super_boost', label: 'Super Boost', color: '#6d8cff' },
  { id: 'special', label: 'Special', color: '#ff5dc8' },
  { id: 'launch', label: 'Launch', color: '#ffc247' },
  { id: 'dunk', label: 'Dunk', color: '#6dff9c' },
  { id: 'parry', label: 'Parry', color: '#a9fff0' },
  { id: 'launch_break', label: 'Launch Break', color: '#ff6262' },
];

export const ACTION_READABILITY_BY_ID = Object.fromEntries(
  ACTION_READABILITY_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<ActionReadabilityId, ActionReadabilityDefinition>;

function resolveAction(
  id: ActionReadabilityId,
  phase: PlayerPresentationPhase,
): ResolvedActionReadability {
  return {
    definition: ACTION_READABILITY_BY_ID[id],
    phase,
  };
}

export function resolvePlayerActionReadability(
  player: PlayerRenderSnapshot,
): ResolvedActionReadability | null {
  switch (player.presentationAction) {
    case 'break':
      return resolveAction('launch_break', player.presentationPhase);
    case 'parry':
      return resolveAction('parry', player.presentationPhase);
    case 'dunk':
      return resolveAction('dunk', player.presentationPhase);
    case 'launch':
      return resolveAction('launch', player.presentationPhase);
    case 'special':
      return resolveAction('special', player.presentationPhase);
    case 'boost':
      return player.superBoost > 0
        ? resolveAction('super_boost', 'sustain')
        : resolveAction('boost', 'sustain');
    case 'helpless':
    case 'recover':
    case 'attack_recovery':
      return null;
    case 'idle':
    default:
      break;
  }
  if (player.breakFlash > 0) {
    return resolveAction('launch_break', 'active');
  }
  if (player.parry > 0) {
    return resolveAction('parry', player.presentationPhase);
  }
  if (player.superBoost > 0) {
    return resolveAction('super_boost', 'sustain');
  }
  if (player.boostActive) {
    return resolveAction('boost', 'sustain');
  }
  return null;
}

function formatPhase(phase: PlayerPresentationPhase): string {
  switch (phase) {
    case 'startup':
      return 'STARTUP';
    case 'active':
      return 'ACTIVE';
    case 'sustain':
      return 'SUSTAIN';
    case 'recovery':
      return 'RECOVERY';
    case 'none':
    default:
      return '';
  }
}

export function resolvePlayerActivityReadability(
  player: PlayerRenderSnapshot,
): PlayerActivityReadability {
  const action = resolvePlayerActionReadability(player);
  if (action) {
    const phase = formatPhase(action.phase);
    return {
      id: action.definition.id,
      label: phase.length > 0 ? `${action.definition.label} / ${phase}` : action.definition.label,
      color: action.definition.color,
    };
  }
  if (player.presentationAction === 'helpless' || player.helpless > 0) {
    return { id: 'helpless', label: 'Launched', color: '#ff9b7a' };
  }
  if (player.presentationAction === 'recover' || player.recovering > 0) {
    return { id: 'recover', label: 'Recovery', color: '#a8b4ca' };
  }
  if (player.presentationAction === 'attack_recovery') {
    return { id: 'attack_recovery', label: 'Attack recovery / VULNERABLE', color: '#a8b4ca' };
  }
  return { id: 'idle', label: 'Idle', color: '#73829f' };
}
