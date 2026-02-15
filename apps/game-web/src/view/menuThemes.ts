import {
  MENU_THEME_DEFINITIONS,
  type MenuThemeDefinition,
  type MenuThemeTokenOverrides,
} from '../../content/themes/menuThemes';

export interface MenuThemeTokens {
  bg: string;
  panel: string;
  text: string;
  mutedText: string;
  p1: string;
  p2: string;
  warn: string;
  fontFamily: string;
  menuBackdropStart: string;
  menuBackdropEnd: string;
  panelBorder: string;
  buttonBg: string;
  buttonBorder: string;
  buttonActiveBg: string;
  buttonActiveBorder: string;
  rowBg: string;
  rowBorder: string;
  rowFocusBorder: string;
  rowFocusGlow: string;
  successText: string;
  dangerText: string;
}

export interface MenuTheme {
  id: string;
  label: string;
  description: string;
  tokens: MenuThemeTokens;
}

export interface MenuThemeOption {
  id: string;
  label: string;
  description: string;
}

export type CssVarTarget = Pick<CSSStyleDeclaration, 'setProperty'>;

export const DEFAULT_MENU_THEME_ID = 'default';

const DEFAULT_MENU_THEME_TOKENS: MenuThemeTokens = {
  bg: '#040816',
  panel: 'rgba(8, 14, 34, 0.74)',
  text: '#dbe8ff',
  mutedText: '#b4c9f3',
  p1: '#58b6ff',
  p2: '#ff74b8',
  warn: '#ffcb61',
  fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  menuBackdropStart: 'rgba(17, 30, 68, 0.62)',
  menuBackdropEnd: 'rgba(4, 8, 22, 0.92)',
  panelBorder: 'rgba(167, 195, 255, 0.3)',
  buttonBg: 'rgba(18, 28, 58, 0.9)',
  buttonBorder: 'rgba(167, 195, 255, 0.25)',
  buttonActiveBg: 'rgba(44, 78, 145, 0.84)',
  buttonActiveBorder: 'rgba(186, 211, 255, 0.55)',
  rowBg: 'rgba(11, 18, 40, 0.68)',
  rowBorder: 'rgba(167, 195, 255, 0.18)',
  rowFocusBorder: 'rgba(255, 203, 97, 0.75)',
  rowFocusGlow: 'rgba(255, 203, 97, 0.35)',
  successText: '#7cd8a9',
  dangerText: '#ff9e9e',
};

const MENU_THEME_CSS_VAR_MAP: Record<keyof MenuThemeTokens, string> = {
  bg: '--bg',
  panel: '--panel',
  text: '--text',
  mutedText: '--ui-muted-text',
  p1: '--p1',
  p2: '--p2',
  warn: '--warn',
  fontFamily: '--ui-font-family',
  menuBackdropStart: '--ui-menu-backdrop-start',
  menuBackdropEnd: '--ui-menu-backdrop-end',
  panelBorder: '--ui-panel-border',
  buttonBg: '--ui-button-bg',
  buttonBorder: '--ui-button-border',
  buttonActiveBg: '--ui-button-active-bg',
  buttonActiveBorder: '--ui-button-active-border',
  rowBg: '--ui-row-bg',
  rowBorder: '--ui-row-border',
  rowFocusBorder: '--ui-row-focus-border',
  rowFocusGlow: '--ui-row-focus-glow',
  successText: '--ui-success-text',
  dangerText: '--ui-danger-text',
};

function mergeTokens(overrides: MenuThemeTokenOverrides): MenuThemeTokens {
  return {
    ...DEFAULT_MENU_THEME_TOKENS,
    ...overrides,
  };
}

function toTheme(definition: MenuThemeDefinition): MenuTheme {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    tokens: mergeTokens(definition.tokens),
  };
}

function buildMenuThemes(): MenuTheme[] {
  const themes: MenuTheme[] = [{
    id: DEFAULT_MENU_THEME_ID,
    label: 'Default',
    description: 'Baseline Gravity Well visual skin.',
    tokens: { ...DEFAULT_MENU_THEME_TOKENS },
  }];
  for (const definition of MENU_THEME_DEFINITIONS) {
    themes.push(toTheme(definition));
  }
  return themes;
}

export const MENU_THEMES: MenuTheme[] = buildMenuThemes();
export const MENU_THEME_IDS: string[] = MENU_THEMES.map((theme) => theme.id);
export const MENU_THEME_BY_ID: Record<string, MenuTheme> = Object.fromEntries(
  MENU_THEMES.map((theme) => [theme.id, theme]),
);
export const MENU_THEME_OPTIONS: MenuThemeOption[] = MENU_THEMES.map((theme) => ({
  id: theme.id,
  label: theme.label,
  description: theme.description,
}));

export function resolveMenuTheme(themeId: string | undefined | null): MenuTheme {
  if (!themeId) {
    return MENU_THEME_BY_ID[DEFAULT_MENU_THEME_ID];
  }
  const trimmed = themeId.trim();
  if (!trimmed) {
    return MENU_THEME_BY_ID[DEFAULT_MENU_THEME_ID];
  }
  return MENU_THEME_BY_ID[trimmed] ?? MENU_THEME_BY_ID[DEFAULT_MENU_THEME_ID];
}

export function applyMenuTheme(theme: MenuTheme, target: CssVarTarget): void {
  for (const [key, value] of Object.entries(theme.tokens) as Array<[keyof MenuThemeTokens, string]>) {
    const cssVar = MENU_THEME_CSS_VAR_MAP[key];
    target.setProperty(cssVar, value);
  }
}
