import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  validateCharacterSpriteSources,
  type CharacterSpriteSourceDefinition,
} from './characterSpriteSourceValidation';

const temporaryRoots: string[] = [];

function write(root: string, path: string, contents: string | Buffer): void {
  const absolutePath = join(root, ...path.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function hash(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function normalizedTextHash(contents: Buffer): string {
  return createHash('sha256')
    .update(contents.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8')
    .digest('hex');
}

function fakePng(width: number, height: number, marker = 0): Buffer {
  const png = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png[24] = 8;
  png[25] = 6;
  png[26] = marker;
  return png;
}

function artifact(path: string, contents: Buffer, widthPixels: number, heightPixels: number) {
  return {
    path,
    sha256: hash(contents),
    bytes: contents.length,
    widthPixels,
    heightPixels,
  };
}

function createFixture(): {
  root: string;
  definition: CharacterSpriteSourceDefinition;
  sourcePath: string;
  runtimeAtlasPath: string;
  presentationPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'gw-character-sprite-source-'));
  temporaryRoots.push(root);
  const source = Buffer.from('print("source")\n');
  const helper = Buffer.from('print("helper")\n');
  const blend = Buffer.from('BLENDER-v1');
  const concept = Buffer.from('concept-reference');
  const reviewAtlas = fakePng(8, 8, 1);
  const reviewPortrait = fakePng(4, 4, 2);
  const runtimeAtlas = fakePng(4, 2, 3);
  const runtimePortrait = fakePng(2, 2, 4);
  const sourcePath = 'art/source/blender/test_sprite_v1.py';
  const helperPath = 'art/source/blender/render_helpers.py';
  const sourceBlendPath = 'art/source/blender/test_sprite_v1.blend';
  const conceptPath = 'art/source/generated/test/concept.png';
  const runtimeAtlasPath = 'apps/game-web/public/assets/characters/test/test-atlas.png';
  const runtimePortraitPath = 'apps/game-web/public/assets/characters/test/test-portrait.png';
  const presentationPath = 'apps/game-web/content/characters/test/test.character.presentation.json';
  const metricsPath = 'art/review/test_sprite_v1.metrics.json';

  write(root, sourcePath, source);
  write(root, helperPath, helper);
  write(root, sourceBlendPath, blend);
  write(root, conceptPath, concept);
  write(root, 'art/review/test_sprite_v1_atlas.png', reviewAtlas);
  write(root, 'art/review/test_sprite_v1_portrait.png', reviewPortrait);
  write(root, runtimeAtlasPath, runtimeAtlas);
  write(root, runtimePortraitPath, runtimePortrait);
  for (const [index, frame] of ['idle_a', 'idle_b', 'boost', 'special'].entries()) {
    write(root, `art/review/test_sprite_v1_frames/${String(index).padStart(2, '0')}_${frame}.png`, fakePng(4, 4, index));
  }

  write(root, metricsPath, `${JSON.stringify({
    schemaVersion: 'gw.character-sprite-source-metrics.v1',
    assetId: 'test_sprite_v1',
    characterId: 'test',
    blenderVersion: '5.2.0 LTS',
    renderEngine: 'BLENDER_WORKBENCH',
    source: sourcePath,
    sourceSha256: normalizedTextHash(source),
    sourceBlend: sourceBlendPath,
    sharedRenderHelpers: helperPath,
    sharedRenderHelpersSha256: normalizedTextHash(helper),
    conceptReference: { path: conceptPath, sha256: hash(concept), bytes: concept.length },
    frameOrder: ['idle_a', 'idle_b', 'boost', 'special'],
    runtimeLayout: {
      columns: 2,
      rows: 2,
      frameWidthPixels: 2,
      frameHeightPixels: 1,
      anchorX: 0.5,
      anchorY: 0.1,
    },
    artifacts: {
      reviewAtlas: artifact('art/review/test_sprite_v1_atlas.png', reviewAtlas, 8, 8),
      reviewPortrait: artifact('art/review/test_sprite_v1_portrait.png', reviewPortrait, 4, 4),
      runtimeAtlas: artifact(runtimeAtlasPath, runtimeAtlas, 4, 2),
      runtimePortrait: artifact(runtimePortraitPath, runtimePortrait, 2, 2),
    },
  }, null, 2)}\n`);

  write(root, presentationPath, `${JSON.stringify({
    schemaVersion: 'gw.character-presentation.v1',
    characterId: 'test',
    animationSet: {
      atlas: {
        src: '/assets/characters/test/test-atlas.png?v=1',
        contentType: 'image/png',
        readiness: 'alpha',
        widthPixels: 4,
        heightPixels: 2,
        columns: 2,
        rows: 2,
        frameWidthPixels: 2,
        frameHeightPixels: 1,
        anchorX: 0.5,
        anchorY: 0.1,
        budget: { estimatedBytes: 64, estimatedTextureBytes: 32 },
      },
    },
    portrait: {
      src: '/assets/characters/test/test-portrait.png?v=1',
      contentType: 'image/png',
      readiness: 'alpha',
      widthPixels: 2,
      heightPixels: 2,
      budget: { estimatedBytes: 64, estimatedTextureBytes: 16 },
    },
  }, null, 2)}\n`);

  return {
    root,
    definition: { characterId: 'test', metricsPath, presentationPath },
    sourcePath,
    runtimeAtlasPath,
    presentationPath,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('character sprite source validation', () => {
  test('accepts intact source provenance, PNGs, review frames, and presentation metadata', () => {
    const fixture = createFixture();
    const report = validateCharacterSpriteSources(
      fixture.root,
      [fixture.definition],
      '2026-07-17T00:00:00.000Z',
    );

    expect(report.valid).toBe(true);
    expect(report.characters[0]).toMatchObject({
      characterId: 'test',
      assetId: 'test_sprite_v1',
      valid: true,
      reviewedFrameCount: 4,
      issues: [],
    });
  });

  test('rejects a changed runtime atlas even when its PNG dimensions remain valid', () => {
    const fixture = createFixture();
    write(fixture.root, fixture.runtimeAtlasPath, fakePng(4, 2, 99));

    const report = validateCharacterSpriteSources(fixture.root, [fixture.definition]);

    expect(report.valid).toBe(false);
    expect(report.characters[0].issues).toContain('runtime atlas SHA-256 does not match its source metrics.');
  });

  test('treats CRLF and LF source checkouts as the same authored text', () => {
    const fixture = createFixture();
    write(fixture.root, fixture.sourcePath, Buffer.from('print("source")\r\n'));

    const report = validateCharacterSpriteSources(fixture.root, [fixture.definition]);

    expect(report.valid).toBe(true);
    expect(report.characters[0].issues).toEqual([]);
  });

  test('rejects presentation drift and missing human-review frames', () => {
    const fixture = createFixture();
    const presentation = JSON.parse(
      readFileSync(join(fixture.root, fixture.presentationPath), 'utf8'),
    );
    presentation.animationSet.atlas.src = '/assets/characters/test/wrong-atlas.png';
    presentation.animationSet.atlas.budget.estimatedBytes = 1;
    write(fixture.root, fixture.presentationPath, `${JSON.stringify(presentation)}\n`);
    rmSync(join(fixture.root, 'art/review/test_sprite_v1_frames/03_special.png'));

    const report = validateCharacterSpriteSources(fixture.root, [fixture.definition]);
    const issues = report.characters[0].issues.join('\n');

    expect(report.valid).toBe(false);
    expect(issues).toContain('review frame 3 is missing');
    expect(issues).toContain('presentation.animationSet.atlas.src must resolve to');
    expect(issues).toContain('presentation.animationSet.atlas.budget.estimatedBytes must cover');
  });
});
