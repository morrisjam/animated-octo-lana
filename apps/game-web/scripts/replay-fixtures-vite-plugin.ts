import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const replayRoot = path.resolve(currentDir, '../replays');
const SMOKE_FIXTURE_NAME = 'smoke.replay.json';

export function replayFixturesVitePlugin(): Plugin {
  return {
    name: 'gravity-well-replay-fixtures',
    apply: 'build',
    async buildStart() {
      const entries = await readdir(replayRoot, { withFileTypes: true });
      const fixtureNames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.replay.json'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      if (!fixtureNames.includes(SMOKE_FIXTURE_NAME)) {
        this.error(`Required replay fixture is missing: ${path.join(replayRoot, SMOKE_FIXTURE_NAME)}`);
      }

      for (const fixtureName of fixtureNames) {
        const fixturePath = path.join(replayRoot, fixtureName);
        const source = await readFile(fixturePath, 'utf8');
        try {
          JSON.parse(source);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.error(`Replay fixture ${fixtureName} is not valid JSON: ${message}`);
        }
        this.addWatchFile(fixturePath);
        this.emitFile({
          type: 'asset',
          fileName: `replays/${fixtureName}`,
          source,
        });
      }
    },
  };
}
