export interface MenuThemeTokenOverrides {
  bg?: string;
  panel?: string;
  text?: string;
  mutedText?: string;
  p1?: string;
  p2?: string;
  warn?: string;
  fontFamily?: string;
  menuBackdropStart?: string;
  menuBackdropEnd?: string;
  panelBorder?: string;
  buttonBg?: string;
  buttonBorder?: string;
  buttonActiveBg?: string;
  buttonActiveBorder?: string;
  rowBg?: string;
  rowBorder?: string;
  rowFocusBorder?: string;
  rowFocusGlow?: string;
  successText?: string;
  dangerText?: string;
}

export interface MenuThemeDefinition {
  id: string;
  label: string;
  description: string;
  tokens: MenuThemeTokenOverrides;
}

export const MENU_THEME_DEFINITIONS: MenuThemeDefinition[] = [
  {
    id: 'solar_flare_v1',
    label: 'Solar Flare V1',
    description: 'Warm orbital amber accents with brighter action focus.',
    tokens: {
      bg: '#100c05',
      panel: 'rgba(36, 20, 8, 0.9)',
      text: '#ffe8cb',
      mutedText: '#d7bc9e',
      p1: '#ffb35c',
      p2: '#ff6d7d',
      warn: '#ffd66b',
      fontFamily: '"Rajdhani", "Segoe UI", sans-serif',
      menuBackdropStart: 'rgba(89, 45, 11, 0.72)',
      menuBackdropEnd: 'rgba(14, 7, 3, 0.95)',
      panelBorder: 'rgba(255, 193, 118, 0.35)',
      buttonBg: 'rgba(59, 30, 12, 0.88)',
      buttonBorder: 'rgba(255, 193, 118, 0.28)',
      buttonActiveBg: 'rgba(125, 64, 25, 0.9)',
      buttonActiveBorder: 'rgba(255, 225, 178, 0.62)',
      rowBg: 'rgba(42, 24, 11, 0.64)',
      rowBorder: 'rgba(255, 193, 118, 0.2)',
      rowFocusBorder: 'rgba(255, 214, 107, 0.82)',
      rowFocusGlow: 'rgba(255, 214, 107, 0.42)',
      successText: '#9de5bb',
      dangerText: '#ff9d9d',
    },
  },
  {
    id: 'glacier_terminal_v1',
    label: 'Glacier Terminal V1',
    description: 'Cold cyan tactical palette tuned for high legibility.',
    tokens: {
      bg: '#04141a',
      panel: 'rgba(7, 25, 34, 0.9)',
      text: '#dbf8ff',
      mutedText: '#95c8d3',
      p1: '#52e8ff',
      p2: '#89a4ff',
      warn: '#9ff9d2',
      fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
      menuBackdropStart: 'rgba(13, 52, 70, 0.66)',
      menuBackdropEnd: 'rgba(3, 13, 18, 0.95)',
      panelBorder: 'rgba(133, 232, 255, 0.32)',
      buttonBg: 'rgba(9, 36, 48, 0.86)',
      buttonBorder: 'rgba(133, 232, 255, 0.28)',
      buttonActiveBg: 'rgba(15, 74, 96, 0.9)',
      buttonActiveBorder: 'rgba(176, 246, 255, 0.62)',
      rowBg: 'rgba(7, 31, 42, 0.62)',
      rowBorder: 'rgba(133, 232, 255, 0.18)',
      rowFocusBorder: 'rgba(159, 249, 210, 0.78)',
      rowFocusGlow: 'rgba(159, 249, 210, 0.4)',
      successText: '#9de5bb',
      dangerText: '#ffb8b8',
    },
  },
];
