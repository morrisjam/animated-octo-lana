import {
  GAMEPLAY_ACTIONS,
  type ButtonBinding,
  type ButtonPlayerBindings,
  type GameplayAction,
} from './bindings';

export type GamepadFamily = 'xbox' | 'playstation' | 'nintendo' | 'generic';
export type GamepadGlyphFamily = GamepadFamily | 'universal';

export interface GamepadIdentity {
  id: string;
  mapping?: string;
}

export interface GamepadButtonGlyph {
  button: ButtonBinding;
  family: GamepadGlyphFamily;
  token: string;
  label: string;
  accessibleLabel: string;
}

const FAMILY_NAMES: Record<GamepadFamily, string> = {
  xbox: 'Xbox',
  playstation: 'PlayStation',
  nintendo: 'Nintendo',
  generic: 'Controller',
};

const UNIVERSAL_BUTTON_LABELS = [
  'A / Cross',
  'B / Circle',
  'X / Square',
  'Y / Triangle',
  'LB / L1',
  'RB / R1',
  'LT / L2',
  'RT / R2',
  'View / Create',
  'Menu / Options',
  'Left Stick',
  'Right Stick',
  'D-pad Up',
  'D-pad Down',
  'D-pad Left',
  'D-pad Right',
  'Home',
] as const;

const XBOX_BUTTON_LABELS = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Menu',
  'Left Stick',
  'Right Stick',
  'D-pad Up',
  'D-pad Down',
  'D-pad Left',
  'D-pad Right',
  'Xbox',
] as const;

const PLAYSTATION_BUTTON_LABELS = [
  'Cross',
  'Circle',
  'Square',
  'Triangle',
  'L1',
  'R1',
  'L2',
  'R2',
  'Create',
  'Options',
  'L3',
  'R3',
  'D-pad Up',
  'D-pad Down',
  'D-pad Left',
  'D-pad Right',
  'PS',
] as const;

const NINTENDO_BUTTON_LABELS = [
  'B',
  'A',
  'Y',
  'X',
  'L',
  'R',
  'ZL',
  'ZR',
  'Minus',
  'Plus',
  'Left Stick',
  'Right Stick',
  'D-pad Up',
  'D-pad Down',
  'D-pad Left',
  'D-pad Right',
  'Home',
] as const;

const FAMILY_BUTTON_LABELS: Record<Exclude<GamepadGlyphFamily, 'generic'>, readonly string[]> = {
  universal: UNIVERSAL_BUTTON_LABELS,
  xbox: XBOX_BUTTON_LABELS,
  playstation: PLAYSTATION_BUTTON_LABELS,
  nintendo: NINTENDO_BUTTON_LABELS,
};

function normaliseIdentity(identity: string | GamepadIdentity): string {
  return (typeof identity === 'string' ? identity : identity.id).trim().toLowerCase();
}

export function detectGamepadFamily(identity: string | GamepadIdentity): GamepadFamily {
  const id = normaliseIdentity(identity);
  if (
    id.includes('nintendo')
    || id.includes('joy-con')
    || id.includes('switch pro')
    || id.includes('vendor: 057e')
    || id.includes('vendor 057e')
  ) {
    return 'nintendo';
  }
  if (
    id.includes('playstation')
    || id.includes('dualsense')
    || id.includes('dualshock')
    || id.includes('sony')
    || id.includes('vendor: 054c')
    || id.includes('vendor 054c')
  ) {
    return 'playstation';
  }
  if (
    id.includes('xbox')
    || id.includes('xinput')
    || id.includes('microsoft')
    || id.includes('vendor: 045e')
    || id.includes('vendor 045e')
  ) {
    return 'xbox';
  }
  return 'generic';
}

export function formatGamepadFamilyName(family: GamepadFamily): string {
  return FAMILY_NAMES[family];
}

function tokenPart(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function resolveGamepadButtonGlyph(
  button: ButtonBinding,
  family: GamepadGlyphFamily = 'universal',
): GamepadButtonGlyph {
  if (button === null) {
    return {
      button,
      family,
      token: 'gamepad-unbound',
      label: 'Unbound',
      accessibleLabel: 'Unbound',
    };
  }

  const label = family === 'generic'
    ? `Button ${button}`
    : FAMILY_BUTTON_LABELS[family][button] ?? `Button ${button}`;
  const familyName = family === 'universal' ? 'Controller' : FAMILY_NAMES[family];
  return {
    button,
    family,
    token: `gamepad-${family}-${tokenPart(label) || `button-${button}`}`,
    label,
    accessibleLabel: `${familyName} ${label} button`,
  };
}

export function formatGamepadButtonLabel(
  button: ButtonBinding,
  family: GamepadGlyphFamily = 'universal',
): string {
  return resolveGamepadButtonGlyph(button, family).label;
}

export function buildGamepadActionGlyphs(
  bindings: ButtonPlayerBindings,
  family: GamepadGlyphFamily,
): Record<GameplayAction, GamepadButtonGlyph> {
  return Object.fromEntries(
    GAMEPLAY_ACTIONS.map((action) => [
      action,
      resolveGamepadButtonGlyph(bindings[action], family),
    ]),
  ) as Record<GameplayAction, GamepadButtonGlyph>;
}
