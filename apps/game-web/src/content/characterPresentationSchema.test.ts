import { describe, expect, test } from 'vitest';
import {
  CHARACTER_PRESENTATION_SCHEMA_VERSION,
  CharacterPresentationValidationError,
  parseCharacterPresentationManifest,
  REQUIRED_CHARACTER_PRESENTATION_STATES,
} from './characterPresentationSchema';

function makeValidPresentation(): Record<string, unknown> {
  return {
    schemaVersion: CHARACTER_PRESENTATION_SCHEMA_VERSION,
    characterId: 'test_character',
    animationSet: {
      id: 'test_animation_set',
      atlas: {
        id: 'test_animation_atlas',
        src: '/assets/characters/test_character/test-atlas.svg',
        contentType: 'image/svg+xml',
        widthPixels: 64,
        heightPixels: 64,
        readiness: 'production',
        budget: {
          estimatedBytes: 512,
          estimatedTextureBytes: 16384,
        },
        columns: 2,
        rows: 2,
        frameWidthPixels: 32,
        frameHeightPixels: 32,
        marginPixels: 0,
        spacingPixels: 0,
        worldWidth: 4,
        worldHeight: 4,
        anchorX: 0.5,
        anchorY: 0.25,
      },
      clips: {
        idle: { frames: [0], fps: 4, loop: true },
      },
      stateClips: Object.fromEntries(
        REQUIRED_CHARACTER_PRESENTATION_STATES.map((state) => [state, 'idle']),
      ),
    },
    portrait: {
      id: 'test_character_portrait',
      src: '/assets/characters/test_character/test-portrait.svg',
      contentType: 'image/svg+xml',
      widthPixels: 32,
      heightPixels: 32,
      readiness: 'production',
      budget: {
        estimatedBytes: 256,
        estimatedTextureBytes: 4096,
      },
    },
    vfxProfileId: 'test_character_vfx',
  };
}

function getValidationError(payload: unknown): CharacterPresentationValidationError {
  try {
    parseCharacterPresentationManifest(payload);
  } catch (error) {
    expect(error).toBeInstanceOf(CharacterPresentationValidationError);
    return error as CharacterPresentationValidationError;
  }
  throw new Error('Expected character presentation validation to fail.');
}

describe('character presentation schema', () => {
  test('parses a complete presentation manifest', () => {
    const parsed = parseCharacterPresentationManifest(makeValidPresentation());

    expect(parsed.schemaVersion).toBe(CHARACTER_PRESENTATION_SCHEMA_VERSION);
    expect(Object.keys(parsed.animationSet.stateClips).sort())
      .toEqual([...REQUIRED_CHARACTER_PRESENTATION_STATES].sort());
    expect(parsed.animationSet.atlas).toMatchObject({ columns: 2, rows: 2 });
    expect(Object.keys(parsed.animationSet.sheets)).toEqual(['test_animation_atlas']);
    expect(parsed.animationSet.clips.idle.sheetId).toBe('test_animation_atlas');
  });

  test('adds named sprite sheets and binds each clip to its authored sheet', () => {
    const payload = makeValidPresentation();
    const animationSet = payload.animationSet as Record<string, unknown>;
    const additionalSheet = structuredClone(animationSet.atlas) as Record<string, unknown>;
    additionalSheet.id = 'test_combat_sheet';
    additionalSheet.src = '/assets/characters/test_character/test-combat-sheet.png';
    animationSet.additionalSheets = [additionalSheet];
    const clips = animationSet.clips as Record<string, Record<string, unknown>>;
    clips.idle.sheetId = 'test_combat_sheet';
    clips.idle.frames = [3];

    const parsed = parseCharacterPresentationManifest(payload);

    expect(Object.keys(parsed.animationSet.sheets).sort()).toEqual([
      'test_animation_atlas',
      'test_combat_sheet',
    ]);
    expect(parsed.animationSet.clips.idle).toMatchObject({
      sheetId: 'test_combat_sheet',
      frames: [3],
    });
  });

  test('rejects unknown and duplicate sprite sheet ids', () => {
    const unknownPayload = makeValidPresentation();
    const unknownAnimationSet = unknownPayload.animationSet as Record<string, unknown>;
    const unknownClips = unknownAnimationSet.clips as Record<string, Record<string, unknown>>;
    unknownClips.idle.sheetId = 'missing_sheet';

    expect(getValidationError(unknownPayload).issues).toContainEqual({
      path: 'animationSet.clips.idle.sheetId',
      message: 'must reference a declared sprite sheet id.',
    });

    const duplicatePayload = makeValidPresentation();
    const duplicateAnimationSet = duplicatePayload.animationSet as Record<string, unknown>;
    duplicateAnimationSet.additionalSheets = [structuredClone(duplicateAnimationSet.atlas)];

    expect(getValidationError(duplicatePayload).issues).toContainEqual({
      path: 'animationSet.additionalSheets[0].id',
      message: 'duplicates sprite sheet id "test_animation_atlas".',
    });
  });

  test('requires every presentation state', () => {
    const payload = makeValidPresentation();
    const animationSet = payload.animationSet as Record<string, unknown>;
    const stateClips = animationSet.stateClips as Record<string, unknown>;
    const missingState = REQUIRED_CHARACTER_PRESENTATION_STATES[0];
    delete stateClips[missingState];

    const error = getValidationError(payload);

    expect(error.issues).toContainEqual({
      path: `animationSet.stateClips.${missingState}`,
      message: 'is required.',
    });
  });

  test.each([
    ['width', 'widthPixels', 63, 'declared frame layout requires 64px width'],
    ['height', 'heightPixels', 63, 'declared frame layout requires 64px height'],
  ])('rejects an atlas whose frame layout exceeds its %s', (_, field, value, diagnostic) => {
    const payload = makeValidPresentation();
    const animationSet = payload.animationSet as Record<string, unknown>;
    const atlas = animationSet.atlas as Record<string, unknown>;
    atlas[field] = value;

    const error = getValidationError(payload);

    expect(error.issues.some((entry) => entry.path === 'animationSet.atlas' && entry.message.includes(diagnostic)))
      .toBe(true);
  });

  test('rejects clip frames outside the declared atlas bounds', () => {
    const payload = makeValidPresentation();
    const animationSet = payload.animationSet as Record<string, unknown>;
    const clips = animationSet.clips as Record<string, Record<string, unknown>>;
    clips.idle.frames = [4];

    const error = getValidationError(payload);

    expect(error.issues).toContainEqual({
      path: 'animationSet.clips.idle.frames[0]',
      message: 'must be an integer inside atlas frame bounds 0-3.',
    });
  });

  test('validates frame bounds against the clip selected sheet', () => {
    const payload = makeValidPresentation();
    const animationSet = payload.animationSet as Record<string, unknown>;
    const additionalSheet = structuredClone(animationSet.atlas) as Record<string, unknown>;
    additionalSheet.id = 'single_frame_sheet';
    additionalSheet.src = '/assets/characters/test_character/single-frame-sheet.webp';
    additionalSheet.columns = 1;
    additionalSheet.rows = 1;
    animationSet.additionalSheets = [additionalSheet];
    const clips = animationSet.clips as Record<string, Record<string, unknown>>;
    clips.idle.sheetId = 'single_frame_sheet';
    clips.idle.frames = [1];

    const error = getValidationError(payload);

    expect(error.issues).toContainEqual({
      path: 'animationSet.clips.idle.frames[0]',
      message: 'must be an integer inside atlas frame bounds 0-0.',
    });
  });
});
