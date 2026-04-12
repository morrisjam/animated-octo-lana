import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHARACTER_BY_ID, CHARACTER_IDS } from '../src/sim/characters';

interface CharacterKitReportRow {
  id: string;
  displayName: string;
  mechanicsTag: string;
  presentation: string;
  enabledSpecials: string[];
  specialBehaviorId: string;
  specialKind: string;
  specialFuelCost: number;
  launchStartupFrames: number;
  launchRecoveryWhiffFrames: number;
  dunkStartupFrames: number;
  dunkRecoveryWhiffFrames: number;
  parryActiveFrames: number;
  breakRecoveryFrames: number;
  moveFuelPerSecond: number;
  boostHoldFuelPerSecond: number;
  superBoostStartFuelCost: number;
  superBoostNonCommitPenalty: number;
}

interface CharacterKitReport {
  generatedAt: string;
  characters: CharacterKitReportRow[];
}

function buildReport(): CharacterKitReport {
  const characters = CHARACTER_IDS.map((id) => {
    const character = CHARACTER_BY_ID[id];
    return {
      id: character.id,
      displayName: character.displayName,
      mechanicsTag: character.mechanicsTag,
      presentation: character.visuals.presentation,
      enabledSpecials: character.specials.filter((special) => special.enabled).map((special) => special.id),
      specialBehaviorId: character.moves.special.behaviorId,
      specialKind: character.moves.special.kind,
      specialFuelCost: character.moves.special.fuelCost,
      launchStartupFrames: character.moves.launch.startupFrames,
      launchRecoveryWhiffFrames: character.moves.launch.recoveryOnWhiffFrames,
      dunkStartupFrames: character.moves.dunk.startupFrames,
      dunkRecoveryWhiffFrames: character.moves.dunk.recoveryOnWhiffFrames,
      parryActiveFrames: character.moves.parry.activeFrames,
      breakRecoveryFrames: character.moves.break.recoveryFrames,
      moveFuelPerSecond: character.moves.movement.fuelPerSecond,
      boostHoldFuelPerSecond: character.moves.boost.holdFuelPerSecond,
      superBoostStartFuelCost: character.moves.superBoost.startFuelCost,
      superBoostNonCommitPenalty: character.moves.superBoost.nonCommitPenalty,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    characters,
  };
}

function toMarkdown(report: CharacterKitReport): string {
  const lines: string[] = [
    '# Character Kit Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Character | Tag | Presentation | Enabled specials | Behavior | Launch startup | Dunk startup | Parry active | Move fuel/s | Super start | Non-commit |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const character of report.characters) {
    lines.push(
      `| ${character.displayName} (\`${character.id}\`) | ${character.mechanicsTag} | ${character.presentation} | ${
        character.enabledSpecials.length > 0 ? character.enabledSpecials.map((special) => `\`${special}\``).join(', ') : 'none'
      } | \`${character.specialBehaviorId}\` | ${character.launchStartupFrames}f | ${character.dunkStartupFrames}f | ${character.parryActiveFrames}f | ${character.moveFuelPerSecond.toFixed(2)} | ${character.superBoostStartFuelCost.toFixed(2)} | ${character.superBoostNonCommitPenalty.toFixed(2)} |`,
    );
  }

  lines.push('', '## Per-character detail', '');

  for (const character of report.characters) {
    lines.push(`### ${character.displayName} (\`${character.id}\`)`);
    lines.push(`- Tag: ${character.mechanicsTag}`);
    lines.push(`- Presentation: ${character.presentation}`);
    lines.push(`- Enabled specials: ${character.enabledSpecials.length > 0 ? character.enabledSpecials.join(', ') : 'none'}`);
    lines.push(`- Special: \`${character.specialBehaviorId}\` (${character.specialKind}), fuel ${character.specialFuelCost}`);
    lines.push(`- Launch: startup ${character.launchStartupFrames}f, whiff recovery ${character.launchRecoveryWhiffFrames}f`);
    lines.push(`- Dunk: startup ${character.dunkStartupFrames}f, whiff recovery ${character.dunkRecoveryWhiffFrames}f`);
    lines.push(`- Parry active: ${character.parryActiveFrames}f`);
    lines.push(`- Break recovery: ${character.breakRecoveryFrames}f`);
    lines.push(`- Movement fuel: ${character.moveFuelPerSecond.toFixed(2)}/s`);
    lines.push(`- Boost hold fuel: ${character.boostHoldFuelPerSecond.toFixed(2)}/s`);
    lines.push(
      `- Super boost: start ${character.superBoostStartFuelCost.toFixed(2)}, non-commit penalty ${character.superBoostNonCommitPenalty.toFixed(2)}`,
    );
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function run(): void {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });

  const report = buildReport();
  const jsonPath = join(outputDir, 'character-kit-report.json');
  const markdownPath = join(outputDir, 'character-kit-report.md');

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, toMarkdown(report), 'utf8');

  console.info(`[character-kit-report] json written ${jsonPath}`);
  console.info(`[character-kit-report] markdown written ${markdownPath}`);
  for (const character of report.characters) {
    console.info(
      `[character-kit-report] ${character.id} behavior=${character.specialBehaviorId} launchStartup=${character.launchStartupFrames} dunkStartup=${character.dunkStartupFrames}`,
    );
  }
}

run();
