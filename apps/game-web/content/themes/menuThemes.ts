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
  hudPanelBorder?: string;
  hudLabelText?: string;
  hudMetaText?: string;
  hudTrackBg?: string;
  hudP1FillStart?: string;
  hudP2FillStart?: string;
  hudStatusBorder?: string;
  hudFrameText?: string;
  hudFrameHintText?: string;
  hudSubtitleBg?: string;
  hudSubtitleBorder?: string;
  hudSubtitleText?: string;
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
      hudPanelBorder: 'rgba(255, 193, 118, 0.34)',
      hudLabelText: '#ffe8cb',
      hudMetaText: '#d7bc9e',
      hudTrackBg: 'rgba(255, 235, 209, 0.16)',
      hudP1FillStart: '#ff8d3a',
      hudP2FillStart: '#ff4f6f',
      hudStatusBorder: 'rgba(255, 193, 118, 0.34)',
      hudFrameText: '#ffdcbc',
      hudFrameHintText: '#e8bb92',
      hudSubtitleBg: 'rgba(32, 18, 8, 0.9)',
      hudSubtitleBorder: 'rgba(255, 193, 118, 0.42)',
      hudSubtitleText: '#fff0dc',
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
      hudPanelBorder: 'rgba(133, 232, 255, 0.34)',
      hudLabelText: '#dbf8ff',
      hudMetaText: '#95c8d3',
      hudTrackBg: 'rgba(219, 248, 255, 0.16)',
      hudP1FillStart: '#21c9ff',
      hudP2FillStart: '#7487ff',
      hudStatusBorder: 'rgba(133, 232, 255, 0.34)',
      hudFrameText: '#c8f2ff',
      hudFrameHintText: '#9fd8e8',
      hudSubtitleBg: 'rgba(6, 22, 30, 0.9)',
      hudSubtitleBorder: 'rgba(133, 232, 255, 0.42)',
      hudSubtitleText: '#ebfbff',
    },
  },
  {
    id: 'high_contrast_v1',
    label: 'High Contrast V1',
    description: 'Accessibility-forward preset with maximum UI and HUD readability.',
    tokens: {
      bg: '#000000',
      panel: 'rgba(0, 0, 0, 0.94)',
      text: '#ffffff',
      mutedText: '#f0f0f0',
      p1: '#00d1ff',
      p2: '#ff7a00',
      warn: '#ffe600',
      fontFamily: '"Atkinson Hyperlegible", "Segoe UI", sans-serif',
      menuBackdropStart: 'rgba(0, 0, 0, 0.9)',
      menuBackdropEnd: 'rgba(0, 0, 0, 0.98)',
      panelBorder: 'rgba(255, 255, 255, 0.78)',
      buttonBg: 'rgba(0, 0, 0, 0.96)',
      buttonBorder: 'rgba(255, 255, 255, 0.72)',
      buttonActiveBg: 'rgba(255, 230, 0, 0.24)',
      buttonActiveBorder: 'rgba(255, 230, 0, 0.94)',
      rowBg: 'rgba(0, 0, 0, 0.9)',
      rowBorder: 'rgba(255, 255, 255, 0.56)',
      rowFocusBorder: 'rgba(255, 230, 0, 0.94)',
      rowFocusGlow: 'rgba(255, 230, 0, 0.5)',
      successText: '#71ff8f',
      dangerText: '#ff8f8f',
      hudPanelBorder: 'rgba(255, 255, 255, 0.78)',
      hudLabelText: '#ffffff',
      hudMetaText: '#f0f0f0',
      hudTrackBg: 'rgba(255, 255, 255, 0.24)',
      hudP1FillStart: '#00b7e5',
      hudP2FillStart: '#ff5f00',
      hudStatusBorder: 'rgba(255, 255, 255, 0.8)',
      hudFrameText: '#ffffff',
      hudFrameHintText: '#f0f0f0',
      hudSubtitleBg: 'rgba(0, 0, 0, 0.98)',
      hudSubtitleBorder: 'rgba(255, 255, 255, 0.86)',
      hudSubtitleText: '#ffffff',
    },
  },
];
