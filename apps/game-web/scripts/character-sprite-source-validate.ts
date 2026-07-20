import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCharacterSpriteSources } from '../src/build/characterSpriteSourceValidation';

const gameWebRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const report = validateCharacterSpriteSources(repoRoot);
const reportPath = join(gameWebRoot, 'build-artifacts', 'character-sprite-source-validation-report.json');

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(`[character-sprite-source] report written ${reportPath}`);

for (const character of report.characters) {
  console.info(
    `[character-sprite-source] ${character.characterId}: ${character.valid ? 'pass' : 'fail'}, `
      + `${character.reviewedFrameCount} review frames`,
  );
  for (const issue of character.issues) {
    console.error(`[character-sprite-source] ${character.characterId}: ${issue}`);
  }
}

if (!report.valid) {
  process.exitCode = 1;
} else {
  console.info('[character-sprite-source] pass');
}
