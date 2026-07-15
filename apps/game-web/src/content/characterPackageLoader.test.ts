import { describe, expect, test } from 'vitest';
import vanguardPackage from '../../content/characters/vanguard/vanguard.character.package.json';
import {
  assertCharacterPackageModuleParity,
  CharacterPackageDiscoveryError,
  loadCharacterPackagesFromModules,
  readNodeCharacterPackageModules,
  readViteCharacterPackageModules,
} from './characterPackageLoader';

function clonePackage(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(vanguardPackage)) as Record<string, unknown>;
}

describe('character package discovery', () => {
  test('Vite and Node discover the same package paths and payloads', () => {
    const viteModules = readViteCharacterPackageModules();
    expect(viteModules, 'Vitest should expose the Vite package inventory').not.toBeNull();

    const nodeModules = readNodeCharacterPackageModules();
    expect(() => assertCharacterPackageModuleParity(
      'vite',
      viteModules as Record<string, unknown>,
      'node',
      nodeModules,
    )).not.toThrow();

    expect(Object.keys(nodeModules).sort()).toEqual([
      '../../content/characters/duelist/duelist.character.package.json',
      '../../content/characters/vanguard/vanguard.character.package.json',
    ]);
  });

  test('loads an additional package without a loader allowlist', () => {
    const scoutPackage = clonePackage();
    scoutPackage.id = 'scout';
    scoutPackage.displayName = 'Scout';

    const modules = {
      ...readNodeCharacterPackageModules(),
      '../../content/characters/scout/scout.character.package.json': scoutPackage,
    };
    const loaded = loadCharacterPackagesFromModules(modules);

    expect(loaded.map((character) => character.id)).toEqual(['duelist', 'scout', 'vanguard']);
    expect(loaded.find((character) => character.id === 'scout')?.package?.source)
      .toBe('../../content/characters/scout/scout.character.package.json');
  });

  test('rejects an empty package set deterministically', () => {
    expect(() => loadCharacterPackagesFromModules({}))
      .toThrowError(new CharacterPackageDiscoveryError('no character package files were discovered.'));
  });

  test('rejects invalid packages instead of silently skipping them', () => {
    expect(() => loadCharacterPackagesFromModules({
      '../../content/characters/broken/broken.character.package.json': {},
    })).toThrow(/invalid package .*broken\.character\.package\.json/);
  });

  test('rejects duplicate character ids with stable source ordering', () => {
    expect(() => loadCharacterPackagesFromModules({
      '../../content/characters/zeta/zeta.character.package.json': clonePackage(),
      '../../content/characters/alpha/alpha.character.package.json': clonePackage(),
    })).toThrow(
      'duplicate character id "vanguard" in "../../content/characters/alpha/alpha.character.package.json" and "../../content/characters/zeta/zeta.character.package.json"',
    );
  });

  test('rejects divergent package paths and payloads', () => {
    const path = '../../content/characters/vanguard/vanguard.character.package.json';
    const changedPackage = clonePackage();
    changedPackage.displayName = 'Changed';

    expect(() => assertCharacterPackageModuleParity(
      'browser',
      { [path]: vanguardPackage },
      'node',
      {},
    )).toThrow('browser/node package sets diverge');

    expect(() => assertCharacterPackageModuleParity(
      'browser',
      { [path]: vanguardPackage },
      'node',
      { [path]: changedPackage },
    )).toThrow(`browser/node package payloads diverge at "${path}"`);
  });
});
