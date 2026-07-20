import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  loadCharacterPackagesFromModules,
  readNodeCharacterPackageModules,
} from './characterPackageLoader';
import {
  assertCharacterPresentationCoverage,
  assertCharacterPresentationModuleParity,
  buildCharacterPresentationAssetEntries,
  loadCharacterPresentationsFromModules,
  readNodeCharacterPresentationModules,
  readViteCharacterPresentationModules,
} from './characterPresentationLoader';
import { CHARACTER_PRESENTATION_SCHEMA_VERSION } from './characterPresentationSchema';
import type { CharacterDefinition } from '../sim/characters';
import { decodeAssetImageDimensions } from '../view/assets/loader';

function readPresentations() {
  return loadCharacterPresentationsFromModules(readNodeCharacterPresentationModules());
}

function makeSyntheticContent(): {
  character: CharacterDefinition;
  presentationModule: Record<string, unknown>;
  source: string;
} {
  const character = structuredClone(
    loadCharacterPackagesFromModules(readNodeCharacterPackageModules())
      .find((entry) => entry.visuals.presentation === 'sprite'),
  );
  if (!character) {
    throw new Error('Expected a packaged sprite character fixture.');
  }
  character.id = 'synthetic_third';
  character.visuals.animationSetId = 'synthetic_third_animset';
  character.visuals.hudPortraitId = 'synthetic_third_portrait';
  character.visuals.vfxProfileId = 'synthetic_third_vfx';

  const sourcePresentation = Object.values(readNodeCharacterPresentationModules())[0];
  const presentationModule = structuredClone(sourcePresentation) as Record<string, unknown>;
  presentationModule.characterId = character.id;
  presentationModule.vfxProfileId = character.visuals.vfxProfileId;
  const animationSet = presentationModule.animationSet as Record<string, unknown>;
  animationSet.id = character.visuals.animationSetId;
  const atlas = animationSet.atlas as Record<string, unknown>;
  atlas.id = character.visuals.animationSetId;
  atlas.src = '/assets/characters/synthetic_third/custom-sheet.svg?v=7';
  const portrait = presentationModule.portrait as Record<string, unknown>;
  portrait.id = character.visuals.hudPortraitId;
  portrait.src = '/assets/characters/synthetic_third/custom-portrait.svg?v=7';

  return {
    character,
    presentationModule,
    source: '../../content/characters/synthetic_third/arbitrary-name.character.presentation.json',
  };
}

describe('character presentation discovery', () => {
  test('parses every discovered module and keeps Vite and Node inventories in parity', () => {
    const nodeModules = readNodeCharacterPresentationModules();
    const moduleSources = Object.keys(nodeModules).sort();
    expect(moduleSources.length).toBeGreaterThan(0);

    const presentations = loadCharacterPresentationsFromModules(nodeModules);
    expect(presentations.map((presentation) => presentation.source)).toEqual(moduleSources);
    expect(presentations.every(
      (presentation) => presentation.schemaVersion === CHARACTER_PRESENTATION_SCHEMA_VERSION,
    )).toBe(true);

    const viteModules = readViteCharacterPresentationModules();
    expect(viteModules, 'Vitest should expose the Vite presentation inventory').not.toBeNull();
    expect(() => assertCharacterPresentationModuleParity(
      'vite',
      viteModules as Record<string, unknown>,
      'node',
      nodeModules,
    )).not.toThrow();
  });

  test('reports the discovered source when module parsing fails', () => {
    const modules = readNodeCharacterPresentationModules();
    const [source, payload] = Object.entries(modules)[0];
    const invalidPayload = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    delete invalidPayload.schemaVersion;

    expect(() => loadCharacterPresentationsFromModules({ [source]: invalidPayload }))
      .toThrow(`invalid presentation "${source}"`);
  });

  test('covers every sprite or hybrid character package', () => {
    const packages = loadCharacterPackagesFromModules(readNodeCharacterPackageModules());
    const presentations = readPresentations();

    expect(() => assertCharacterPresentationCoverage(packages, presentations)).not.toThrow();

    const presentationIds = new Set(presentations.map((presentation) => presentation.characterId));
    const presentedPackageIds = packages
      .filter((character) => character.visuals.presentation === 'sprite' || character.visuals.presentation === 'hybrid')
      .map((character) => character.id);
    expect(presentedPackageIds.length).toBeGreaterThan(0);
    expect(presentedPackageIds.every((id) => presentationIds.has(id))).toBe(true);
  });

  test('loads and binds a synthetic third character without a code allowlist', () => {
    const fixture = makeSyntheticContent();
    const presentations = loadCharacterPresentationsFromModules({
      [fixture.source]: fixture.presentationModule,
    });

    expect(presentations).toHaveLength(1);
    expect(presentations[0]).toMatchObject({
      source: fixture.source,
      characterId: fixture.character.id,
      animationSet: { id: fixture.character.visuals.animationSetId },
      portrait: { id: fixture.character.visuals.hudPortraitId },
    });
    expect(() => assertCharacterPresentationCoverage([fixture.character], presentations)).not.toThrow();
  });

  test('generates preload entries with presentation MIME and image metadata', () => {
    const presentations = readPresentations();
    const entries = buildCharacterPresentationAssetEntries(presentations);
    const sheets = presentations.flatMap((presentation) => Object.values(presentation.animationSet.sheets));

    expect(entries.sprites).toHaveLength(sheets.length);
    expect(entries.textures).toHaveLength(presentations.length);

    for (const presentation of presentations) {
      for (const sheet of Object.values(presentation.animationSet.sheets)) {
        expect(entries.sprites.find((entry) => entry.id === sheet.id)).toEqual({
          id: sheet.id,
          src: sheet.src,
          preload: true,
          readiness: sheet.readiness,
          contentTypes: [sheet.contentType],
          image: {
            width: sheet.widthPixels,
            height: sheet.heightPixels,
          },
          budget: { ...sheet.budget },
        });
      }
      expect(entries.textures.find((entry) => entry.id === presentation.portrait.id)).toEqual({
        id: presentation.portrait.id,
        src: presentation.portrait.src,
        preload: true,
        readiness: presentation.portrait.readiness,
        contentTypes: [presentation.portrait.contentType],
        image: {
          width: presentation.portrait.widthPixels,
          height: presentation.portrait.heightPixels,
        },
        budget: { ...presentation.portrait.budget },
      });
    }
  });

  test('discovers and preloads supplemental atlas sheets without changing legacy manifests', () => {
    const fixture = makeSyntheticContent();
    const animationSet = fixture.presentationModule.animationSet as Record<string, unknown>;
    const supplemental = structuredClone(animationSet.atlas) as Record<string, unknown>;
    supplemental.id = 'synthetic_third_combat_sheet';
    supplemental.src = '/assets/characters/synthetic_third/combat-sheet.webp?v=2';
    supplemental.contentType = 'image/webp';
    animationSet.additionalSheets = [supplemental];
    const clips = animationSet.clips as Record<string, Record<string, unknown>>;
    clips.special_active.sheetId = supplemental.id;

    const [presentation] = loadCharacterPresentationsFromModules({
      [fixture.source]: fixture.presentationModule,
    });
    const entries = buildCharacterPresentationAssetEntries([presentation]);

    expect(Object.keys(presentation.animationSet.sheets).sort()).toEqual([
      'synthetic_third_animset',
      'synthetic_third_combat_sheet',
    ]);
    expect(presentation.animationSet.clips.special_active.sheetId).toBe('synthetic_third_combat_sheet');
    expect(entries.sprites.map((entry) => entry.id).sort()).toEqual([
      'synthetic_third_animset',
      'synthetic_third_combat_sheet',
    ]);
  });

  test('checked-in presentation assets exist, fit their source budgets, and match declared SVG dimensions', async () => {
    for (const presentation of readPresentations()) {
      for (const asset of [...Object.values(presentation.animationSet.sheets), presentation.portrait]) {
        const pathname = new URL(asset.src, 'http://local.invalid').pathname;
        const fileUrl = new URL(`../../public${pathname}`, import.meta.url);
        const body = readFileSync(fileUrl);
        expect(body.byteLength, `${asset.id} exceeds its estimated source-byte budget`)
          .toBeLessThanOrEqual(asset.budget.estimatedBytes);

        if (asset.contentType === 'image/svg+xml') {
          const arrayBuffer = body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
          ) as ArrayBuffer;
          await expect(decodeAssetImageDimensions(arrayBuffer, asset.contentType))
            .resolves.toEqual({ width: asset.widthPixels, height: asset.heightPixels });
        }
      }
    }
  });
});
