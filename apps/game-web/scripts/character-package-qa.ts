import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CharacterDefinition } from '../src/sim/characters';
import { CHARACTER_BY_ID } from '../src/sim/characters';
import { discoverNodeCharacterPackageFiles } from '../src/content/characterPackageLoader';
import { parseCharacterPackage } from '../src/content/characterPackageSchema';
import { computeStateChecksum } from '../src/sim/checksum';
import { createInitialState, step } from '../src/sim/sim';
import type { FrameInput } from '../src/sim/types';
import { DEFAULT_ASSET_MANIFEST } from '../src/view/assets/defaultManifest';
import type { AssetReadiness } from '../src/view/assets/types';
import { hasVoiceProfile } from '../src/view/audio/voiceLines';
import { hasCharacterVfxProfile } from '../src/view/vfx/presets';

interface CharacterQaIssue {
  path: string;
  message: string;
}

interface CharacterAssetBudgetLimits {
  bytes: number;
  triangles: number;
  vfxEmitters: number;
  referencedAssetIds: number;
}

interface CharacterAssetBudgetUsage {
  bytes: number;
  triangles: number;
  vfxEmitters: number;
  referencedAssetIds: number;
}

interface CharacterAssetBudgetReport {
  limits: CharacterAssetBudgetLimits;
  usage: CharacterAssetBudgetUsage;
  pass: boolean;
  violations: CharacterQaIssue[];
  unresolvedManifestRefs: string[];
  belowAlphaReadinessRefs: string[];
  unresolvedProfileRefs: string[];
  alphaContentReady: boolean;
}

interface CharacterPackageQaResult {
  file: string;
  id: string;
  checksumSmoke: {
    pass: boolean;
    frames: number;
    finalChecksum: number | null;
    firstDivergentFrame: number | null;
  };
  frameAndBalanceIssues: CharacterQaIssue[];
  assetBudget: CharacterAssetBudgetReport;
}

interface CharacterPackageQaReport {
  generatedAt: string;
  rootDir: string;
  filesScanned: number;
  packageCount: number;
  pass: boolean;
  summary: {
    checksumFailures: number;
    frameBalanceIssueCount: number;
    assetBudgetFailures: number;
  };
  packages: CharacterPackageQaResult[];
}

const DEFAULT_ROOT_DIR = 'content/characters';
const QA_FRAMES = 360;

const CHARACTER_ASSET_BUDGET_LIMITS: CharacterAssetBudgetLimits = {
  bytes: 4 * 1024 * 1024,
  triangles: 20_000,
  vfxEmitters: 16,
  referencedAssetIds: 16,
};

function parseDirArg(argv: string[]): string {
  const index = argv.findIndex((value) => value === '--dir');
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return DEFAULT_ROOT_DIR;
}

function readJson(path: URL): unknown {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

function toCharacterDefinition(payload: unknown): CharacterDefinition {
  const parsed = parseCharacterPackage(payload);
  return {
    id: parsed.id,
    displayName: parsed.displayName,
    blurb: parsed.blurb,
    mechanicsTag: parsed.mechanicsTag,
    stats: parsed.stats,
    ai: parsed.ai,
    visuals: parsed.visuals,
    audio: parsed.audio,
    moves: parsed.moves,
    specials: parsed.specials,
  };
}

function neutralInput(): FrameInput {
  return {
    p1: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
    p2: {
      moveX: 0,
      moveY: 0,
      boost: false,
      superBoost: false,
      special: false,
      launch: false,
      dunk: false,
      parry: false,
      breakLaunch: false,
    },
  };
}

function scriptedInputForFrame(frame: number): FrameInput {
  const input = neutralInput();
  input.p1.moveX = frame % 30 < 15 ? 1 : -1;
  input.p2.moveY = frame % 20 < 10 ? 1 : -1;
  input.p1.boost = frame % 45 === 0;
  input.p2.boost = frame % 55 === 0;
  input.p1.special = frame % 60 === 0;
  input.p2.special = frame % 75 === 0;
  input.p1.launch = frame % 90 === 0;
  input.p2.launch = frame % 110 === 0;
  input.p1.parry = frame % 80 === 0;
  input.p2.parry = frame % 95 === 0;
  input.p1.dunk = frame % 140 === 0;
  input.p2.dunk = frame % 165 === 0;
  input.p1.breakLaunch = frame % 100 === 0;
  input.p2.breakLaunch = frame % 120 === 0;
  return input;
}

function selectOpponentId(characterId: string): string {
  if (characterId !== 'vanguard' && CHARACTER_BY_ID.vanguard) {
    return 'vanguard';
  }
  for (const id of Object.keys(CHARACTER_BY_ID)) {
    if (id !== characterId) {
      return id;
    }
  }
  return characterId;
}

function runChecksumSmoke(character: CharacterDefinition): CharacterPackageQaResult['checksumSmoke'] {
  const previous = CHARACTER_BY_ID[character.id];
  CHARACTER_BY_ID[character.id] = character;
  try {
    const opponentId = selectOpponentId(character.id);
    const stateA = createInitialState({
      seed: 424242,
      loadout: { P1: character.id, P2: opponentId },
    });
    const stateB = createInitialState({
      seed: 424242,
      loadout: { P1: character.id, P2: opponentId },
    });

    let finalChecksum: number | null = null;
    for (let frame = 0; frame < QA_FRAMES; frame += 1) {
      const input = scriptedInputForFrame(frame);
      step(stateA, input, 1 / 60);
      step(stateB, input, 1 / 60);
      const checksumA = computeStateChecksum(stateA);
      const checksumB = computeStateChecksum(stateB);
      if (checksumA !== checksumB) {
        return {
          pass: false,
          frames: frame + 1,
          finalChecksum: checksumA,
          firstDivergentFrame: frame + 1,
        };
      }
      finalChecksum = checksumA;
    }

    return {
      pass: true,
      frames: QA_FRAMES,
      finalChecksum,
      firstDivergentFrame: null,
    };
  } finally {
    if (previous) {
      CHARACTER_BY_ID[character.id] = previous;
    } else {
      delete CHARACTER_BY_ID[character.id];
    }
  }
}

function checkBound(
  issues: CharacterQaIssue[],
  path: string,
  value: number,
  min: number,
  max: number,
): void {
  if (value < min || value > max) {
    issues.push({
      path,
      message: `out of QA bounds (${value}). Expected ${min}-${max}.`,
    });
  }
}

function checkFrameAndBalance(character: CharacterDefinition): CharacterQaIssue[] {
  const issues: CharacterQaIssue[] = [];
  const { stats, moves } = character;

  checkBound(issues, 'stats.fuelCapacityMultiplier', stats.fuelCapacityMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.moveAccelMultiplier', stats.moveAccelMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.boostSpeedMultiplier', stats.boostSpeedMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.superBoostSpeedMultiplier', stats.superBoostSpeedMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.launchBasePowerMultiplier', stats.launchBasePowerMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.launchChainBonusMultiplier', stats.launchChainBonusMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.launchDurationTakenMultiplier', stats.launchDurationTakenMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.specialFuelCostMultiplier', stats.specialFuelCostMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.superFuelMultiplier', stats.superFuelMultiplier, 0.5, 2.5);
  checkBound(issues, 'stats.dunkRecoveryFuelMultiplier', stats.dunkRecoveryFuelMultiplier, 0.5, 2.5);

  checkBound(issues, 'moves.launch.startupFrames', moves.launch.startupFrames, 0, 60);
  checkBound(issues, 'moves.launch.activeFrames', moves.launch.activeFrames, 1, 24);
  checkBound(issues, 'moves.launch.recoveryOnHitFrames', moves.launch.recoveryOnHitFrames, 0, 240);
  checkBound(issues, 'moves.launch.recoveryOnWhiffFrames', moves.launch.recoveryOnWhiffFrames, 0, 300);
  if (moves.launch.recoveryOnWhiffFrames < moves.launch.recoveryOnHitFrames) {
    issues.push({
      path: 'moves.launch.recoveryOnWhiffFrames',
      message: 'must be greater than or equal to moves.launch.recoveryOnHitFrames.',
    });
  }

  checkBound(issues, 'moves.dunk.startupFrames', moves.dunk.startupFrames, 0, 120);
  checkBound(issues, 'moves.dunk.activeFrames', moves.dunk.activeFrames, 1, 24);
  checkBound(issues, 'moves.dunk.recoveryOnHitFrames', moves.dunk.recoveryOnHitFrames, 0, 300);
  checkBound(issues, 'moves.dunk.recoveryOnWhiffFrames', moves.dunk.recoveryOnWhiffFrames, 0, 360);
  checkBound(issues, 'moves.dunk.hitRange', moves.dunk.hitRange, 0.5, 30);
  checkBound(issues, 'moves.dunk.startupPursuitSpeed', moves.dunk.startupPursuitSpeed, 0, 200);
  checkBound(issues, 'moves.dunk.startupTracking', moves.dunk.startupTracking, 0, 1);
  if (moves.dunk.recoveryOnWhiffFrames < moves.dunk.recoveryOnHitFrames) {
    issues.push({
      path: 'moves.dunk.recoveryOnWhiffFrames',
      message: 'must be greater than or equal to moves.dunk.recoveryOnHitFrames.',
    });
  }

  checkBound(issues, 'moves.parry.activeFrames', moves.parry.activeFrames, 0, 90);
  checkBound(issues, 'moves.parry.recoveryFrames', moves.parry.recoveryFrames, 0, 240);
  checkBound(issues, 'moves.parry.counterStunFrames', moves.parry.counterStunFrames, 0, 240);

  checkBound(issues, 'moves.break.recoveryFrames', moves.break.recoveryFrames, 0, 240);
  checkBound(issues, 'moves.break.velocityRetain', moves.break.velocityRetain, 0, 1);

  checkBound(issues, 'moves.movement.fuelPerSecond', moves.movement.fuelPerSecond, 0, 10);

  checkBound(issues, 'moves.special.fuelCost', moves.special.fuelCost, 0, 30);
  checkBound(issues, 'moves.special.timing.startupFrames', moves.special.timing.startupFrames, 0, 180);
  checkBound(issues, 'moves.special.timing.activeFrames', moves.special.timing.activeFrames, 1, 60);
  checkBound(issues, 'moves.special.timing.recoveryFrames', moves.special.timing.recoveryFrames, 0, 300);
  checkBound(issues, 'moves.special.timing.cooldownFrames', moves.special.timing.cooldownFrames, 0, 600);
  checkBound(issues, 'moves.special.size.range', moves.special.size.range, 1, 400);
  checkBound(issues, 'moves.special.size.radius', moves.special.size.radius, 0.1, 10);

  checkBound(issues, 'moves.boost.holdSpeedMultiplier', moves.boost.holdSpeedMultiplier, 0.2, 3);
  checkBound(issues, 'moves.boost.holdFuelPerSecond', moves.boost.holdFuelPerSecond, 0, 10);
  checkBound(issues, 'moves.superBoost.holdSpeedMultiplier', moves.superBoost.holdSpeedMultiplier, 0.2, 4);
  checkBound(issues, 'moves.superBoost.steerLerpMultiplier', moves.superBoost.steerLerpMultiplier, 0.1, 4);
  checkBound(issues, 'moves.superBoost.velocityBlendMultiplier', moves.superBoost.velocityBlendMultiplier, 0.1, 4);
  checkBound(issues, 'moves.superBoost.startFuelCost', moves.superBoost.startFuelCost, 0, 40);
  checkBound(issues, 'moves.superBoost.travelFuelPerDistance', moves.superBoost.travelFuelPerDistance, 0, 0.5);
  checkBound(issues, 'moves.superBoost.nonCommitPenalty', moves.superBoost.nonCommitPenalty, 0, 40);
  checkBound(issues, 'moves.superBoost.turnPenaltyGainMultiplier', moves.superBoost.turnPenaltyGainMultiplier, 0, 5);

  return issues;
}

function sumBudgetById(kind: 'models' | 'sprites' | 'textures' | 'audio', id: string): {
  bytes: number;
  triangles: number;
  vfxEmitters: number;
  resolved: boolean;
  readiness: AssetReadiness;
} {
  const entry = DEFAULT_ASSET_MANIFEST[kind].find((candidate) => candidate.id === id);
  if (!entry) {
    return {
      bytes: 0,
      triangles: 0,
      vfxEmitters: 0,
      resolved: false,
      readiness: 'prototype',
    };
  }
  return {
    bytes: entry.budget?.estimatedBytes ?? 0,
    triangles: entry.budget?.estimatedTriangles ?? 0,
    vfxEmitters: entry.budget?.estimatedVfxEmitters ?? 0,
    resolved: true,
    readiness: entry.readiness ?? 'prototype',
  };
}

function isAlphaReady(readiness: AssetReadiness): boolean {
  return readiness === 'alpha' || readiness === 'production';
}

function buildAssetBudget(character: CharacterDefinition): CharacterAssetBudgetReport {
  const usage: CharacterAssetBudgetUsage = {
    bytes: 0,
    triangles: 0,
    vfxEmitters: 0,
    referencedAssetIds: 0,
  };
  const unresolvedManifestRefs: string[] = [];
  const belowAlphaReadinessRefs: string[] = [];
  const unresolvedProfileRefs: string[] = [];
  const refs: Array<{ id: string; kind: 'models' | 'sprites' | 'textures' | 'audio' }> = [];
  if (
    (character.visuals.presentation === '3d' || character.visuals.presentation === 'hybrid')
    && character.visuals.modelId
  ) {
    refs.push({ id: character.visuals.modelId, kind: 'models' });
  }
  if (
    (character.visuals.presentation === 'sprite' || character.visuals.presentation === 'hybrid')
    && character.visuals.animationSetId
  ) {
    refs.push({ id: character.visuals.animationSetId, kind: 'sprites' });
  }
  refs.push({ id: character.visuals.hudPortraitId, kind: 'textures' });
  if (character.moves.special.projectile?.visualId) {
    refs.push({ id: character.moves.special.projectile.visualId, kind: 'textures' });
  }

  if (character.visuals.vfxProfileId && !hasCharacterVfxProfile(character.visuals.vfxProfileId)) {
    unresolvedProfileRefs.push(`vfx:${character.visuals.vfxProfileId}`);
  }
  if (character.audio.voiceProfileId && !hasVoiceProfile(character.audio.voiceProfileId)) {
    unresolvedProfileRefs.push(`voice:${character.audio.voiceProfileId}`);
  }
  if (character.audio.sfxProfileId) {
    unresolvedProfileRefs.push(`sfx:${character.audio.sfxProfileId}`);
  }
  if (character.audio.musicThemeId) {
    unresolvedProfileRefs.push(`music:${character.audio.musicThemeId}`);
  }

  const uniqueRefs = new Map<string, 'models' | 'sprites' | 'textures' | 'audio'>();
  for (const ref of refs) {
    if (!uniqueRefs.has(ref.id)) {
      uniqueRefs.set(ref.id, ref.kind);
    }
  }

  usage.referencedAssetIds = uniqueRefs.size;

  for (const [id, kind] of uniqueRefs.entries()) {
    const budget = sumBudgetById(kind, id);
    usage.bytes += budget.bytes;
    usage.triangles += budget.triangles;
    usage.vfxEmitters += budget.vfxEmitters;
    if (!budget.resolved) {
      unresolvedManifestRefs.push(id);
    } else if (!isAlphaReady(budget.readiness)) {
      belowAlphaReadinessRefs.push(id);
    }
  }

  const limits = CHARACTER_ASSET_BUDGET_LIMITS;
  const violations: CharacterQaIssue[] = [];
  if (usage.bytes > limits.bytes) {
    violations.push({
      path: 'assetBudget.bytes',
      message: `usage ${usage.bytes} exceeds limit ${limits.bytes}.`,
    });
  }
  if (usage.triangles > limits.triangles) {
    violations.push({
      path: 'assetBudget.triangles',
      message: `usage ${usage.triangles} exceeds limit ${limits.triangles}.`,
    });
  }
  if (usage.vfxEmitters > limits.vfxEmitters) {
    violations.push({
      path: 'assetBudget.vfxEmitters',
      message: `usage ${usage.vfxEmitters} exceeds limit ${limits.vfxEmitters}.`,
    });
  }
  if (usage.referencedAssetIds > limits.referencedAssetIds) {
    violations.push({
      path: 'assetBudget.referencedAssetIds',
      message: `usage ${usage.referencedAssetIds} exceeds limit ${limits.referencedAssetIds}.`,
    });
  }

  const alphaContentReady = unresolvedManifestRefs.length === 0
    && belowAlphaReadinessRefs.length === 0
    && unresolvedProfileRefs.length === 0;

  return {
    limits,
    usage,
    pass: violations.length === 0 && alphaContentReady,
    violations,
    unresolvedManifestRefs,
    belowAlphaReadinessRefs,
    unresolvedProfileRefs,
    alphaContentReady,
  };
}

function writeReport(report: CharacterPackageQaReport): string {
  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'character-package-qa-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function run(): void {
  const rootDirArg = parseDirArg(process.argv.slice(2));
  const absoluteRoot = resolve(process.cwd(), rootDirArg);
  let packageFiles;
  try {
    packageFiles = discoverNodeCharacterPackageFiles({
      rootUrl: pathToFileURL(`${absoluteRoot}${sep}`),
      sourceRoot: rootDirArg,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[character-package:qa] package discovery failed.');
    process.exitCode = 1;
    return;
  }

  if (packageFiles.length === 0) {
    console.error(`[character-package:qa] no package files found under ${rootDirArg}`);
    process.exitCode = 1;
    return;
  }

  const results: CharacterPackageQaResult[] = [];
  let checksumFailures = 0;
  let frameBalanceIssueCount = 0;
  let assetBudgetFailures = 0;

  for (const file of packageFiles) {
    const fileLabel = file.source;
    try {
      const payload = readJson(file.url);
      const character = toCharacterDefinition(payload);
      const checksumSmoke = runChecksumSmoke(character);
      const frameAndBalanceIssues = checkFrameAndBalance(character);
      const assetBudget = buildAssetBudget(character);

      if (!checksumSmoke.pass) {
        checksumFailures += 1;
      }
      if (frameAndBalanceIssues.length > 0) {
        frameBalanceIssueCount += frameAndBalanceIssues.length;
      }
      if (!assetBudget.pass) {
        assetBudgetFailures += 1;
      }

      results.push({
        file: fileLabel,
        id: character.id,
        checksumSmoke,
        frameAndBalanceIssues,
        assetBudget,
      });

      const contentIssueCount = assetBudget.unresolvedManifestRefs.length
        + assetBudget.belowAlphaReadinessRefs.length
        + assetBudget.unresolvedProfileRefs.length;
      const contentSuffix = contentIssueCount > 0
        ? ` contentIssues=${contentIssueCount}`
        : '';
      const checksSuffix = `checksum=${checksumSmoke.pass ? 'ok' : 'fail'} frameBounds=${frameAndBalanceIssues.length} assetBudget=${assetBudget.violations.length === 0 ? 'ok' : 'fail'} alphaAssets=${assetBudget.alphaContentReady ? 'ok' : 'fail'}`;
      console.info(`[character-package:qa] ${character.id} ${checksSuffix}${contentSuffix}`);
    } catch (error) {
      checksumFailures += 1;
      results.push({
        file: fileLabel,
        id: 'unknown',
        checksumSmoke: {
          pass: false,
          frames: 0,
          finalChecksum: null,
          firstDivergentFrame: null,
        },
        frameAndBalanceIssues: [{
          path: '$',
          message: error instanceof Error ? error.message : 'Unexpected QA parse error.',
        }],
        assetBudget: {
          limits: CHARACTER_ASSET_BUDGET_LIMITS,
          usage: {
            bytes: 0,
            triangles: 0,
            vfxEmitters: 0,
            referencedAssetIds: 0,
          },
          pass: false,
          violations: [{
            path: '$',
            message: 'Asset budget check skipped due to parse failure.',
          }],
          unresolvedManifestRefs: [],
          belowAlphaReadinessRefs: [],
          unresolvedProfileRefs: [],
          alphaContentReady: false,
        },
      });
      console.error(`[character-package:qa] invalid ${fileLabel}`);
      console.error(`  - ${error instanceof Error ? error.message : 'Unexpected QA parse error.'}`);
    }
  }

  const report: CharacterPackageQaReport = {
    generatedAt: new Date().toISOString(),
    rootDir: rootDirArg.replace(/\\/g, '/'),
    filesScanned: packageFiles.length,
    packageCount: results.length,
    pass: checksumFailures === 0 && frameBalanceIssueCount === 0 && assetBudgetFailures === 0,
    summary: {
      checksumFailures,
      frameBalanceIssueCount,
      assetBudgetFailures,
    },
    packages: results,
  };

  const reportPath = writeReport(report);
  console.info(`[character-package:qa] report written ${reportPath}`);

  if (!report.pass) {
    process.exitCode = 1;
  }
}

run();
