import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface NewCharacterArgs {
  id: string;
  displayName: string;
  author: string;
  rootDir: string;
  force: boolean;
  dryRun: boolean;
}

const CHARACTER_ID_REGEX = /^[a-z0-9_]{2,32}$/;

function printUsage(): void {
  console.info('Usage: tsx scripts/character-package-new.ts --id <character_id> [options]');
  console.info('');
  console.info('Options:');
  console.info('  --id <value>             Required. Lowercase id using [a-z0-9_], 2-32 chars.');
  console.info('  --display-name <value>   Optional. Default: titleized id.');
  console.info('  --author <value>         Optional. Default: Your Name');
  console.info('  --dir <path>             Optional. Default: content/characters');
  console.info('  --force                  Optional. Overwrite existing package file if present.');
  console.info('  --dry-run                Optional. Print output path and JSON without writing.');
  console.info('  --help                   Show this help.');
}

function requireArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function toDefaultDisplayName(id: string): string {
  return id
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function parseArgs(argv: string[]): NewCharacterArgs | null {
  if (argv.includes('--help')) {
    printUsage();
    return null;
  }

  let id = '';
  let displayName = '';
  let author = 'Your Name';
  let rootDir = 'content/characters';
  let force = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--id':
        id = requireArgValue(argv, i, '--id').trim();
        i += 1;
        break;
      case '--display-name':
        displayName = requireArgValue(argv, i, '--display-name').trim();
        i += 1;
        break;
      case '--author':
        author = requireArgValue(argv, i, '--author').trim();
        i += 1;
        break;
      case '--dir':
        rootDir = requireArgValue(argv, i, '--dir').trim();
        i += 1;
        break;
      case '--force':
        force = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default:
        if (!token.startsWith('--')) {
          continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!id) {
    throw new Error('Missing required --id argument.');
  }
  if (!CHARACTER_ID_REGEX.test(id)) {
    throw new Error('Invalid --id. Use lowercase [a-z0-9_], length 2-32.');
  }

  const resolvedDisplayName = displayName || toDefaultDisplayName(id);
  if (!resolvedDisplayName) {
    throw new Error('Display name cannot be empty.');
  }

  return {
    id,
    displayName: resolvedDisplayName,
    author: author || 'Your Name',
    rootDir,
    force,
    dryRun,
  };
}

function createPackagePayload(args: NewCharacterArgs): Record<string, unknown> {
  const idPrefix = `character_${args.id}`;
  return {
    schemaVersion: 'gw.character-package.v1',
    id: args.id,
    displayName: args.displayName,
    blurb: 'TODO: Add character fantasy and role summary.',
    mechanicsTag: 'future: define mechanics identity',
    metadata: {
      author: args.author,
      version: '0.1.0',
      tags: ['custom', 'todo'],
    },
    stats: {
      fuelCapacityMultiplier: 1,
      moveAccelMultiplier: 1,
      boostSpeedMultiplier: 1,
      superBoostSpeedMultiplier: 1,
      launchBasePowerMultiplier: 1,
      launchChainBonusMultiplier: 1,
      launchDurationTakenMultiplier: 1,
      specialFuelCostMultiplier: 1,
      superFuelMultiplier: 1,
      dunkRecoveryFuelMultiplier: 1,
    },
    visuals: {
      presentation: 'sprite',
      modelId: null,
      animationSetId: `${idPrefix}_animset`,
      vfxProfileId: null,
      projectileVisualId: null,
      hudPortraitId: `${idPrefix}_portrait`,
    },
    audio: {
      sfxProfileId: null,
      voiceProfileId: `${idPrefix}_voice`,
      musicThemeId: null,
    },
    moves: {
      launch: {
        startupFrames: 6,
        activeFrames: 3,
        recoveryOnHitFrames: 30,
        recoveryOnWhiffFrames: 42,
      },
      dunk: {
        startupFrames: 30,
        activeFrames: 4,
        recoveryOnHitFrames: 24,
        recoveryOnWhiffFrames: 66,
        hitRange: 8,
        startupPursuitSpeed: 58,
        startupTracking: 0.18,
      },
      parry: {
        startupFrames: 0,
        activeFrames: 11,
        recoveryFrames: 13,
        counterStunFrames: 45,
      },
      break: {
        startupFrames: 0,
        activeFrames: 1,
        recoveryFrames: 24,
        velocityRetain: 0.3,
      },
      movement: {
        fuelPerSecond: 0.65,
      },
      special: {
        id: 'basic_projectile',
        label: 'Basic Projectile',
        behaviorId: 'special.projectile.v1',
        kind: 'projectile',
        fuelCost: 5,
        timing: {
          startupFrames: 0,
          activeFrames: 1,
          recoveryFrames: 0,
          cooldownFrames: 19,
        },
        size: {
          range: 100,
          radius: 0.8,
          width: 1.6,
          length: 1.6,
        },
        projectile: {
          speed: 42,
          lifeSeconds: 2,
          hitRadius: 0.8,
          stunSeconds: 0.7,
          fuelDamage: 4,
          visualId: `${idPrefix}_projectile`,
        },
      },
      boost: {
        holdSpeedMultiplier: 1,
        holdFuelPerSecond: 0.2,
      },
      superBoost: {
        holdSpeedMultiplier: 1,
        steerLerpMultiplier: 1,
        velocityBlendMultiplier: 1,
        startFuelCost: 6,
        travelFuelPerDistance: 0.05,
        nonCommitPenalty: 2.5,
        turnPenaltyGainMultiplier: 1,
      },
    },
    specials: [
      {
        id: 'special_alpha',
        label: 'Special Alpha',
        enabled: false,
      },
      {
        id: 'special_beta',
        label: 'Special Beta',
        enabled: false,
      },
    ],
  };
}

function run(argv: string[]): void {
  const args = parseArgs(argv);
  if (!args) {
    return;
  }

  const characterDir = join(process.cwd(), args.rootDir, args.id);
  const packagePath = join(characterDir, `${args.id}.character.package.json`);
  const payload = createPackagePayload(args);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  if (existsSync(packagePath) && !args.force) {
    throw new Error(`Package already exists: ${packagePath}. Use --force to overwrite.`);
  }

  if (args.dryRun) {
    console.info(`[character-package:new] dry-run -> ${packagePath}`);
    console.info(serialized);
    return;
  }

  mkdirSync(characterDir, { recursive: true });
  writeFileSync(packagePath, serialized, 'utf8');
  console.info(`[character-package:new] created ${packagePath}`);
  console.info('[character-package:new] next steps:');
  console.info('  1) Fill TODO fields in the package.');
  console.info('  2) Run npm run character:validate -w @gravity-well/game-web');
}

try {
  run(process.argv.slice(2));
} catch (error) {
  console.error(`[character-package:new] ${error instanceof Error ? error.message : 'Unexpected error.'}`);
  printUsage();
  process.exitCode = 1;
}
