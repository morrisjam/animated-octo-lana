import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import {
  extractInitialJavaScriptReferences,
  inspectProductionBundle,
  type ProductionBundleLimits,
} from './productionBundleBudget';

const temporaryDirectories: string[] = [];
const generousLimits: ProductionBundleLimits = {
  maxInitialJavaScriptBytes: 100_000,
  maxInitialJavaScriptGzipBytes: 100_000,
  maxEntryChunkBytes: 100_000,
  maxJavaScriptChunkBytes: 100_000,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function createFixture(indexHtml: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gw-bundle-budget-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'index.html'), indexHtml, 'utf8');
  for (const file of [
    'game-test.js',
    'three-test.js',
    'pauseMenu-test.js',
    'replayViewer-test.js',
    'onlineDevMenu-test.js',
    'balanceLab-test.js',
    'replayReview-test.js',
    'rankedProofReview-test.js',
  ]) {
    await writeFile(join(directory, 'assets', file), `export const id = '${file}';\n`, 'utf8');
  }
  return directory;
}

describe('production bundle budget', () => {
  test('extracts only entry and modulepreload JavaScript references', () => {
    expect(extractInitialJavaScriptReferences(`
      <script type="module" src="/assets/game.js"></script>
      <script src="/runtime.js?rev=1"></script>
      <link rel="modulepreload" href="/assets/three.js">
      <link rel="stylesheet" href="/assets/game.css">
    `)).toEqual([
      { kind: 'entry', href: '/assets/game.js', external: false },
      { kind: 'entry', href: '/runtime.js?rev=1', external: false },
      { kind: 'modulepreload', href: '/assets/three.js', external: false },
    ]);
  });

  test('passes only when optional surfaces exist outside the initial graph', async () => {
    const directory = await createFixture(`
      <script type="module" src="/assets/game-test.js"></script>
      <link rel="modulepreload" href="/assets/three-test.js">
    `);

    const report = await inspectProductionBundle(directory, generousLimits);

    expect(report.ok).toBe(true);
    expect(report.buildProfile).toBe('production');
    expect(report.assets.filter((asset) => asset.initial).map((asset) => asset.path)).toEqual([
      'assets/game-test.js',
      'assets/three-test.js',
    ]);
    expect(report.checks.filter((check) => check.id.startsWith('lazy-')).every((check) => check.passed))
      .toBe(true);
  });

  test('fails when an optional surface is preloaded or initial JavaScript is external', async () => {
    const directory = await createFixture(`
      <script type="module" src="https://cdn.example/game.js"></script>
      <script type="module" src="/assets/game-test.js"></script>
      <link rel="modulepreload" href="/assets/pauseMenu-test.js">
    `);

    const report = await inspectProductionBundle(directory, generousLimits);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'no-external-initial-javascript')?.passed)
      .toBe(false);
    expect(report.checks.find((check) => check.id === 'lazy-pauseMenu')?.passed).toBe(false);
  });
});
