import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MENU_THEMES, type MenuThemeTokens } from '../src/view/menuThemes';

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface ContrastCheckSpec {
  id: string;
  foregroundToken: keyof MenuThemeTokens;
  backgroundToken: keyof MenuThemeTokens;
  minimumRatio: number;
}

interface ContrastCheckResult {
  checkId: string;
  foregroundToken: keyof MenuThemeTokens;
  backgroundToken: keyof MenuThemeTokens;
  minimumRatio: number;
  ratio: number;
  pass: boolean;
}

interface ThemeContrastResult {
  themeId: string;
  themeLabel: string;
  pass: boolean;
  checks: ContrastCheckResult[];
}

interface MenuThemeContrastReport {
  generatedAt: string;
  minimumChecks: number;
  pass: boolean;
  themes: ThemeContrastResult[];
}

const CONTRAST_CHECKS: ContrastCheckSpec[] = [
  {
    id: 'menu_text_panel',
    foregroundToken: 'text',
    backgroundToken: 'panel',
    minimumRatio: 4.5,
  },
  {
    id: 'menu_muted_panel',
    foregroundToken: 'mutedText',
    backgroundToken: 'panel',
    minimumRatio: 3.2,
  },
  {
    id: 'hud_label_panel',
    foregroundToken: 'hudLabelText',
    backgroundToken: 'panel',
    minimumRatio: 4.5,
  },
  {
    id: 'hud_meta_panel',
    foregroundToken: 'hudMetaText',
    backgroundToken: 'panel',
    minimumRatio: 3.2,
  },
  {
    id: 'hud_frame_panel',
    foregroundToken: 'hudFrameText',
    backgroundToken: 'panel',
    minimumRatio: 4.5,
  },
  {
    id: 'hud_subtitle',
    foregroundToken: 'hudSubtitleText',
    backgroundToken: 'hudSubtitleBg',
    minimumRatio: 4.5,
  },
  {
    id: 'status_warn_panel',
    foregroundToken: 'warn',
    backgroundToken: 'panel',
    minimumRatio: 3,
  },
  {
    id: 'status_success_panel',
    foregroundToken: 'successText',
    backgroundToken: 'panel',
    minimumRatio: 3,
  },
  {
    id: 'status_danger_panel',
    foregroundToken: 'dangerText',
    backgroundToken: 'panel',
    minimumRatio: 3,
  },
];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseHexColor(value: string): RgbaColor | null {
  const raw = value.trim().replace('#', '');
  if (!/^[a-fA-F0-9]+$/.test(raw)) {
    return null;
  }
  if (raw.length === 3 || raw.length === 4) {
    const r = Number.parseInt(raw[0] + raw[0], 16);
    const g = Number.parseInt(raw[1] + raw[1], 16);
    const b = Number.parseInt(raw[2] + raw[2], 16);
    const a = raw.length === 4 ? Number.parseInt(raw[3] + raw[3], 16) / 255 : 1;
    return { r, g, b, a };
  }
  if (raw.length === 6 || raw.length === 8) {
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    const a = raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

function parseRgbColor(value: string): RgbaColor | null {
  const match = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!match) {
    return null;
  }
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }
  const r = clampByte(Number(parts[0]));
  const g = clampByte(Number(parts[1]));
  const b = clampByte(Number(parts[2]));
  const a = parts.length === 4 ? clampAlpha(Number(parts[3])) : 1;
  if (![r, g, b, a].every((n) => Number.isFinite(n))) {
    return null;
  }
  return { r, g, b, a };
}

function parseColor(value: string): RgbaColor {
  const hex = parseHexColor(value);
  if (hex) {
    return hex;
  }
  const rgb = parseRgbColor(value);
  if (rgb) {
    return rgb;
  }
  throw new Error(`Unsupported color format "${value}".`);
}

function blendColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const a = foreground.a + background.a * (1 - foreground.a);
  if (a <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const r = (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a;
  const g = (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a;
  const b = (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a;
  return { r, g, b, a };
}

function toLinearSrgb(channel: number): number {
  const normalised = channel / 255;
  if (normalised <= 0.04045) {
    return normalised / 12.92;
  }
  return ((normalised + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbaColor): number {
  const r = toLinearSrgb(color.r);
  const g = toLinearSrgb(color.g);
  const b = toLinearSrgb(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: RgbaColor, background: RgbaColor): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function evaluateTheme(themeTokens: MenuThemeTokens): ContrastCheckResult[] {
  const pageBackground = parseColor(themeTokens.bg);

  return CONTRAST_CHECKS.map((check) => {
    const rawBackground = parseColor(themeTokens[check.backgroundToken]);
    const effectiveBackground = blendColor(rawBackground, pageBackground);
    const rawForeground = parseColor(themeTokens[check.foregroundToken]);
    const effectiveForeground = blendColor(rawForeground, effectiveBackground);
    const ratio = contrastRatio(effectiveForeground, effectiveBackground);
    return {
      checkId: check.id,
      foregroundToken: check.foregroundToken,
      backgroundToken: check.backgroundToken,
      minimumRatio: check.minimumRatio,
      ratio,
      pass: ratio >= check.minimumRatio,
    };
  });
}

function writeReport(report: MenuThemeContrastReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'menu-theme-contrast-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function run(): void {
  const themes = MENU_THEMES.map((theme) => {
    const checks = evaluateTheme(theme.tokens);
    return {
      themeId: theme.id,
      themeLabel: theme.label,
      pass: checks.every((check) => check.pass),
      checks,
    };
  });

  const report: MenuThemeContrastReport = {
    generatedAt: new Date().toISOString(),
    minimumChecks: CONTRAST_CHECKS.length,
    pass: themes.every((theme) => theme.pass),
    themes,
  };

  const reportPath = writeReport(report);
  console.info(`[menu-theme:contrast] report written ${reportPath}`);
  for (const theme of report.themes) {
    const failed = theme.checks.filter((check) => !check.pass);
    if (failed.length === 0) {
      console.info(`[menu-theme:contrast] ${theme.themeId}: pass (${theme.checks.length} checks)`);
      continue;
    }
    console.error(`[menu-theme:contrast] ${theme.themeId}: ${failed.length} failed check(s)`);
    for (const check of failed) {
      console.error(
        `[menu-theme:contrast] ${theme.themeId}/${check.checkId}: ratio=${check.ratio.toFixed(2)} minimum=${check.minimumRatio.toFixed(2)}`,
      );
    }
  }

  if (!report.pass) {
    process.exitCode = 1;
  }
}

try {
  run();
} catch (error) {
  console.error('[menu-theme:contrast] contrast check failed');
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}
