import type {
  PlayerPresentationAction,
  PlayerPresentationPhase,
} from '../sim/types';
import type { AssetBudgetHint, AssetReadiness } from '../view/assets/types';

export const CHARACTER_PRESENTATION_SCHEMA_VERSION = 'gw.character-presentation.v1';

export const REQUIRED_CHARACTER_PRESENTATION_STATES = [
  'idle.none',
  'boost.sustain',
  'launch.startup',
  'launch.active',
  'parry.active',
  'break.active',
  'special.startup',
  'special.active',
  'dunk.startup',
  'dunk.active',
  'helpless.sustain',
  'recover.recovery',
] as const;

export const OPTIONAL_CHARACTER_PRESENTATION_STATES = [
  'attack_recovery.recovery',
  'parry.startup',
] as const;

export type CharacterPresentationStateKey = `${PlayerPresentationAction}.${PlayerPresentationPhase}`;
export type RequiredCharacterPresentationStateKey = (typeof REQUIRED_CHARACTER_PRESENTATION_STATES)[number];
type OptionalCharacterPresentationStateKey = (typeof OPTIONAL_CHARACTER_PRESENTATION_STATES)[number];
type CharacterPresentationStateClips = Record<RequiredCharacterPresentationStateKey, string>
  & Partial<Record<OptionalCharacterPresentationStateKey, string>>;

export interface SpriteAnimationClip {
  frames: number[];
  fps: number;
  loop: boolean;
  sheetId: string;
}

export interface CharacterPresentationImageAsset {
  id: string;
  src: string;
  contentType: string;
  widthPixels: number;
  heightPixels: number;
  readiness: AssetReadiness;
  budget: Required<Pick<AssetBudgetHint, 'estimatedBytes' | 'estimatedTextureBytes'>>;
}

export interface CharacterPresentationAtlas extends CharacterPresentationImageAsset {
  columns: number;
  rows: number;
  frameWidthPixels: number;
  frameHeightPixels: number;
  marginPixels: number;
  spacingPixels: number;
  worldWidth: number;
  worldHeight: number;
  anchorX: number;
  anchorY: number;
}

export interface CharacterPresentationAnimationSet {
  id: string;
  atlas: CharacterPresentationAtlas;
  sheets: Record<string, CharacterPresentationAtlas>;
  clips: Record<string, SpriteAnimationClip>;
  stateClips: CharacterPresentationStateClips;
}

export interface CharacterPresentationManifestV1 {
  schemaVersion: typeof CHARACTER_PRESENTATION_SCHEMA_VERSION;
  characterId: string;
  animationSet: CharacterPresentationAnimationSet;
  portrait: CharacterPresentationImageAsset;
  vfxProfileId: string;
}

export interface CharacterPresentationValidationIssue {
  path: string;
  message: string;
}

export class CharacterPresentationValidationError extends Error {
  public readonly issues: CharacterPresentationValidationIssue[];

  public constructor(issues: CharacterPresentationValidationIssue[]) {
    super(`Character presentation validation failed with ${issues.length} issue(s).`);
    this.name = 'CharacterPresentationValidationError';
    this.issues = issues;
  }
}

const ID_PATTERN = /^[a-z0-9_]{2,120}$/;
const CLIP_ID_PATTERN = /^[a-z0-9_.-]{2,80}$/;
const ASSET_PATH_PATTERN = /^\/assets\/characters\/[a-z0-9_/-]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[a-zA-Z0-9._=&-]+)?$/;
const READINESS = new Set<AssetReadiness>(['prototype', 'alpha', 'production']);
const SUPPORTED_STATE_SET = new Set<string>([
  ...REQUIRED_CHARACTER_PRESENTATION_STATES,
  ...OPTIONAL_CHARACTER_PRESENTATION_STATES,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(
  issues: CharacterPresentationValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

function readString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPresentationValidationIssue[],
  pattern?: RegExp,
): string | null {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    issue(issues, path, 'must be a non-empty string.');
    return null;
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    issue(issues, path, 'has invalid format.');
    return null;
  }
  return normalized;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: CharacterPresentationValidationIssue[],
  options: { integer?: boolean; min?: number; max?: number } = {},
): number | null {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issue(issues, path, 'must be a finite number.');
    return null;
  }
  if (options.integer && !Number.isInteger(value)) {
    issue(issues, path, 'must be an integer.');
    return null;
  }
  if (options.min !== undefined && value < options.min) {
    issue(issues, path, `must be greater than or equal to ${options.min}.`);
    return null;
  }
  if (options.max !== undefined && value > options.max) {
    issue(issues, path, `must be less than or equal to ${options.max}.`);
    return null;
  }
  return value;
}

function parseImageAsset(
  value: unknown,
  path: string,
  issues: CharacterPresentationValidationIssue[],
): CharacterPresentationImageAsset | null {
  if (!isRecord(value)) {
    issue(issues, path, 'must be an object.');
    return null;
  }
  const id = readString(value, 'id', `${path}.id`, issues, ID_PATTERN);
  const src = readString(value, 'src', `${path}.src`, issues, ASSET_PATH_PATTERN);
  const contentType = readString(value, 'contentType', `${path}.contentType`, issues);
  const widthPixels = readNumber(value, 'widthPixels', `${path}.widthPixels`, issues, { integer: true, min: 1 });
  const heightPixels = readNumber(value, 'heightPixels', `${path}.heightPixels`, issues, { integer: true, min: 1 });
  const readinessValue = readString(value, 'readiness', `${path}.readiness`, issues);
  const readiness = readinessValue && READINESS.has(readinessValue as AssetReadiness)
    ? readinessValue as AssetReadiness
    : null;
  if (readinessValue && !readiness) {
    issue(issues, `${path}.readiness`, 'must be one of: prototype, alpha, production.');
  }
  const budgetValue = value.budget;
  if (!isRecord(budgetValue)) {
    issue(issues, `${path}.budget`, 'must be an object.');
    return null;
  }
  const estimatedBytes = readNumber(
    budgetValue,
    'estimatedBytes',
    `${path}.budget.estimatedBytes`,
    issues,
    { integer: true, min: 1 },
  );
  const estimatedTextureBytes = readNumber(
    budgetValue,
    'estimatedTextureBytes',
    `${path}.budget.estimatedTextureBytes`,
    issues,
    { integer: true, min: 1 },
  );
  if (!contentType?.startsWith('image/')) {
    if (contentType) {
      issue(issues, `${path}.contentType`, 'must be an image MIME type.');
    }
    return null;
  }
  if (
    !id
    || !src
    || widthPixels === null
    || heightPixels === null
    || !readiness
    || estimatedBytes === null
    || estimatedTextureBytes === null
  ) {
    return null;
  }
  return {
    id,
    src,
    contentType,
    widthPixels,
    heightPixels,
    readiness,
    budget: { estimatedBytes, estimatedTextureBytes },
  };
}

function parseAtlas(
  value: unknown,
  path: string,
  issues: CharacterPresentationValidationIssue[],
): CharacterPresentationAtlas | null {
  const asset = parseImageAsset(value, path, issues);
  if (!isRecord(value)) {
    return null;
  }
  const columns = readNumber(value, 'columns', `${path}.columns`, issues, { integer: true, min: 1 });
  const rows = readNumber(value, 'rows', `${path}.rows`, issues, { integer: true, min: 1 });
  const frameWidthPixels = readNumber(
    value,
    'frameWidthPixels',
    `${path}.frameWidthPixels`,
    issues,
    { integer: true, min: 1 },
  );
  const frameHeightPixels = readNumber(
    value,
    'frameHeightPixels',
    `${path}.frameHeightPixels`,
    issues,
    { integer: true, min: 1 },
  );
  const marginPixels = readNumber(
    value,
    'marginPixels',
    `${path}.marginPixels`,
    issues,
    { integer: true, min: 0 },
  );
  const spacingPixels = readNumber(
    value,
    'spacingPixels',
    `${path}.spacingPixels`,
    issues,
    { integer: true, min: 0 },
  );
  const worldWidth = readNumber(value, 'worldWidth', `${path}.worldWidth`, issues, { min: 0.1 });
  const worldHeight = readNumber(value, 'worldHeight', `${path}.worldHeight`, issues, { min: 0.1 });
  const anchorX = readNumber(value, 'anchorX', `${path}.anchorX`, issues, { min: 0, max: 1 });
  const anchorY = readNumber(value, 'anchorY', `${path}.anchorY`, issues, { min: 0, max: 1 });
  if (
    !asset
    || columns === null
    || rows === null
    || frameWidthPixels === null
    || frameHeightPixels === null
    || marginPixels === null
    || spacingPixels === null
    || worldWidth === null
    || worldHeight === null
    || anchorX === null
    || anchorY === null
  ) {
    return null;
  }
  const requiredWidth = marginPixels * 2 + columns * frameWidthPixels + (columns - 1) * spacingPixels;
  const requiredHeight = marginPixels * 2 + rows * frameHeightPixels + (rows - 1) * spacingPixels;
  if (requiredWidth > asset.widthPixels) {
    issue(issues, path, `declared frame layout requires ${requiredWidth}px width but asset width is ${asset.widthPixels}px.`);
  }
  if (requiredHeight > asset.heightPixels) {
    issue(issues, path, `declared frame layout requires ${requiredHeight}px height but asset height is ${asset.heightPixels}px.`);
  }
  return {
    ...asset,
    columns,
    rows,
    frameWidthPixels,
    frameHeightPixels,
    marginPixels,
    spacingPixels,
    worldWidth,
    worldHeight,
    anchorX,
    anchorY,
  };
}

function parseSheets(
  primaryAtlas: CharacterPresentationAtlas | null,
  value: unknown,
  issues: CharacterPresentationValidationIssue[],
): Record<string, CharacterPresentationAtlas> | null {
  if (!primaryAtlas) {
    return null;
  }
  const sheets = Object.create(null) as Record<string, CharacterPresentationAtlas>;
  sheets[primaryAtlas.id] = primaryAtlas;
  if (value === undefined) {
    return sheets;
  }
  if (!Array.isArray(value)) {
    issue(issues, 'animationSet.additionalSheets', 'must be an array when provided.');
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const path = `animationSet.additionalSheets[${index}]`;
    const sheet = parseAtlas(value[index], path, issues);
    if (!sheet) {
      continue;
    }
    if (sheets[sheet.id]) {
      issue(issues, `${path}.id`, `duplicates sprite sheet id "${sheet.id}".`);
      continue;
    }
    sheets[sheet.id] = sheet;
  }
  return sheets;
}

function parseClips(
  value: unknown,
  sheets: Record<string, CharacterPresentationAtlas>,
  defaultSheetId: string,
  issues: CharacterPresentationValidationIssue[],
): Record<string, SpriteAnimationClip> | null {
  if (!isRecord(value)) {
    issue(issues, 'animationSet.clips', 'must be an object.');
    return null;
  }
  const clips: Record<string, SpriteAnimationClip> = {};
  for (const clipId of Object.keys(value).sort()) {
    if (!CLIP_ID_PATTERN.test(clipId)) {
      issue(issues, `animationSet.clips.${clipId}`, 'clip id has invalid format.');
      continue;
    }
    const clipValue = value[clipId];
    if (!isRecord(clipValue)) {
      issue(issues, `animationSet.clips.${clipId}`, 'must be an object.');
      continue;
    }
    const sheetIdValue = clipValue.sheetId;
    const sheetId = sheetIdValue === undefined
      ? defaultSheetId
      : readString(clipValue, 'sheetId', `animationSet.clips.${clipId}.sheetId`, issues, ID_PATTERN);
    const sheet = sheetId ? sheets[sheetId] : null;
    if (sheetId && !sheet) {
      issue(issues, `animationSet.clips.${clipId}.sheetId`, 'must reference a declared sprite sheet id.');
    }
    const frameCount = sheet ? sheet.columns * sheet.rows : 0;
    const framesValue = clipValue.frames;
    const frames: number[] = [];
    if (!Array.isArray(framesValue) || framesValue.length === 0) {
      issue(issues, `animationSet.clips.${clipId}.frames`, 'must contain at least one frame.');
    } else {
      for (let index = 0; index < framesValue.length; index += 1) {
        const frame = framesValue[index];
        if (!Number.isInteger(frame) || Number(frame) < 0 || Number(frame) >= frameCount) {
          issue(
            issues,
            `animationSet.clips.${clipId}.frames[${index}]`,
            `must be an integer inside atlas frame bounds 0-${Math.max(0, frameCount - 1)}.`,
          );
          continue;
        }
        frames.push(Number(frame));
      }
    }
    const fps = readNumber(clipValue, 'fps', `animationSet.clips.${clipId}.fps`, issues, { min: 0.01 });
    if (typeof clipValue.loop !== 'boolean') {
      issue(issues, `animationSet.clips.${clipId}.loop`, 'must be a boolean.');
    }
    if (sheet && sheetId && frames.length > 0 && fps !== null && typeof clipValue.loop === 'boolean') {
      clips[clipId] = { frames, fps, loop: clipValue.loop, sheetId };
    }
  }
  if (Object.keys(clips).length === 0) {
    issue(issues, 'animationSet.clips', 'must define at least one valid clip.');
    return null;
  }
  return clips;
}

function parseStateClips(
  value: unknown,
  clips: Record<string, SpriteAnimationClip>,
  issues: CharacterPresentationValidationIssue[],
): CharacterPresentationStateClips | null {
  if (!isRecord(value)) {
    issue(issues, 'animationSet.stateClips', 'must be an object.');
    return null;
  }
  const stateClips: Partial<CharacterPresentationStateClips> = {};
  for (const [state, clipValue] of Object.entries(value).sort(([first], [second]) => first.localeCompare(second))) {
    if (!SUPPORTED_STATE_SET.has(state)) {
      issue(issues, `animationSet.stateClips.${state}`, 'is not a supported presentation state.');
      continue;
    }
    if (typeof clipValue !== 'string' || !clips[clipValue]) {
      issue(issues, `animationSet.stateClips.${state}`, 'must reference a declared clip id.');
      continue;
    }
    stateClips[state as keyof CharacterPresentationStateClips] = clipValue;
  }
  for (const state of REQUIRED_CHARACTER_PRESENTATION_STATES) {
    if (!stateClips[state]) {
      issue(issues, `animationSet.stateClips.${state}`, 'is required.');
    }
  }
  return REQUIRED_CHARACTER_PRESENTATION_STATES.every((state) => Boolean(stateClips[state]))
    ? stateClips as CharacterPresentationStateClips
    : null;
}

export function parseCharacterPresentationManifest(input: unknown): CharacterPresentationManifestV1 {
  const issues: CharacterPresentationValidationIssue[] = [];
  if (!isRecord(input)) {
    throw new CharacterPresentationValidationError([{ path: '$', message: 'root value must be an object.' }]);
  }
  const schemaVersion = readString(input, 'schemaVersion', 'schemaVersion', issues);
  if (schemaVersion && schemaVersion !== CHARACTER_PRESENTATION_SCHEMA_VERSION) {
    issue(issues, 'schemaVersion', `must equal ${CHARACTER_PRESENTATION_SCHEMA_VERSION}.`);
  }
  const characterId = readString(input, 'characterId', 'characterId', issues, ID_PATTERN);
  const animationSetValue = input.animationSet;
  let animationSet: CharacterPresentationAnimationSet | null = null;
  if (!isRecord(animationSetValue)) {
    issue(issues, 'animationSet', 'must be an object.');
  } else {
    const id = readString(animationSetValue, 'id', 'animationSet.id', issues, ID_PATTERN);
    const atlas = parseAtlas(animationSetValue.atlas, 'animationSet.atlas', issues);
    const sheets = parseSheets(atlas, animationSetValue.additionalSheets, issues);
    const clips = atlas && sheets
      ? parseClips(animationSetValue.clips, sheets, atlas.id, issues)
      : null;
    const stateClips = clips
      ? parseStateClips(animationSetValue.stateClips, clips, issues)
      : null;
    if (id && atlas && sheets && clips && stateClips) {
      animationSet = { id, atlas, sheets, clips, stateClips };
    }
  }
  const portrait = parseImageAsset(input.portrait, 'portrait', issues);
  const vfxProfileId = readString(input, 'vfxProfileId', 'vfxProfileId', issues, ID_PATTERN);
  if (issues.length > 0 || schemaVersion !== CHARACTER_PRESENTATION_SCHEMA_VERSION || !characterId || !animationSet || !portrait || !vfxProfileId) {
    throw new CharacterPresentationValidationError(issues);
  }
  return {
    schemaVersion: CHARACTER_PRESENTATION_SCHEMA_VERSION,
    characterId,
    animationSet,
    portrait,
    vfxProfileId,
  };
}
