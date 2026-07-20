export type SafeAreaPreference = 'system' | 'comfortable' | 'television';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SafeAreaCalculationOptions {
  viewportWidth: number;
  viewportHeight: number;
  preference: SafeAreaPreference;
  systemInsets?: Partial<SafeAreaInsets>;
}

export interface SafeAreaLayout extends SafeAreaInsets {
  contentWidth: number;
  contentHeight: number;
}

export interface SafeAreaStyleTarget {
  setProperty(name: string, value: string): void;
}

export const SAFE_AREA_CSS_VARIABLES = {
  top: '--gw-safe-area-top',
  right: '--gw-safe-area-right',
  bottom: '--gw-safe-area-bottom',
  left: '--gw-safe-area-left',
  contentWidth: '--gw-safe-area-content-width',
  contentHeight: '--gw-safe-area-content-height',
} as const;

const PREFERENCE_MARGIN_RATIOS: Record<SafeAreaPreference, number> = {
  system: 0,
  comfortable: 0.025,
  television: 0.05,
};

function finiteDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteInset(value: number | undefined, maximum: number): number {
  const inset = Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
  return Math.min(inset, maximum);
}

export function sanitiseSafeAreaPreference(value: unknown): SafeAreaPreference {
  return value === 'comfortable' || value === 'television' || value === 'system'
    ? value
    : 'system';
}

export function calculateSafeAreaLayout(
  options: SafeAreaCalculationOptions,
): SafeAreaLayout {
  const viewportWidth = finiteDimension(options.viewportWidth);
  const viewportHeight = finiteDimension(options.viewportHeight);
  const ratio = PREFERENCE_MARGIN_RATIOS[options.preference];
  const horizontalPreferenceInset = viewportWidth * ratio;
  const verticalPreferenceInset = viewportHeight * ratio;
  const maximumHorizontalInset = viewportWidth / 2;
  const maximumVerticalInset = viewportHeight / 2;
  const left = Math.max(
    horizontalPreferenceInset,
    finiteInset(options.systemInsets?.left, maximumHorizontalInset),
  );
  const right = Math.max(
    horizontalPreferenceInset,
    finiteInset(options.systemInsets?.right, maximumHorizontalInset),
  );
  const top = Math.max(
    verticalPreferenceInset,
    finiteInset(options.systemInsets?.top, maximumVerticalInset),
  );
  const bottom = Math.max(
    verticalPreferenceInset,
    finiteInset(options.systemInsets?.bottom, maximumVerticalInset),
  );
  return {
    top,
    right,
    bottom,
    left,
    contentWidth: Math.max(0, viewportWidth - left - right),
    contentHeight: Math.max(0, viewportHeight - top - bottom),
  };
}

function pixelValue(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

export function applySafeAreaLayout(
  target: SafeAreaStyleTarget,
  layout: SafeAreaLayout,
): void {
  target.setProperty(SAFE_AREA_CSS_VARIABLES.top, pixelValue(layout.top));
  target.setProperty(SAFE_AREA_CSS_VARIABLES.right, pixelValue(layout.right));
  target.setProperty(SAFE_AREA_CSS_VARIABLES.bottom, pixelValue(layout.bottom));
  target.setProperty(SAFE_AREA_CSS_VARIABLES.left, pixelValue(layout.left));
  target.setProperty(SAFE_AREA_CSS_VARIABLES.contentWidth, pixelValue(layout.contentWidth));
  target.setProperty(SAFE_AREA_CSS_VARIABLES.contentHeight, pixelValue(layout.contentHeight));
}

export function applySafeAreaPreference(
  target: SafeAreaStyleTarget,
  options: SafeAreaCalculationOptions,
): SafeAreaLayout {
  const layout = calculateSafeAreaLayout(options);
  applySafeAreaLayout(target, layout);
  return layout;
}
