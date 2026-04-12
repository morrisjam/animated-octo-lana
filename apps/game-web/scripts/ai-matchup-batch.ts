import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHARACTER_IDS, isCharacterId, type CharacterId } from '../src/sim/characters';
import {
  AI_DIFFICULTY_ORDER,
  createAiController,
  tickAiController,
  type AiDifficultyId,
} from '../src/sim/ai';
import { resolveBalanceProfile } from '../src/sim/balanceProfiles';
import { createInitialState, step } from '../src/sim/sim';

interface CliOptions {
  gamesPerPairing: number;
  maxRoundSeconds: number;
  profileId: string;
  difficultyIds: AiDifficultyId[];
  pairings: Array<{ p1: CharacterId; p2: CharacterId }>;
}

interface MatchSummary {
  p1: CharacterId;
  p2: CharacterId;
  difficulty: AiDifficultyId;
  profileId: string;
  games: number;
  p1SetWins: number;
  p2SetWins: number;
  drawnSets: number;
  totalRoundTimeouts: number;
  averageSetSeconds: number;
  averageRoundsPerSet: number;
}

interface BatchReport {
  generatedAt: string;
  options: {
    gamesPerPairing: number;
    maxRoundSeconds: number;
    profileId: string;
    difficultyIds: AiDifficultyId[];
    pairings: Array<{ p1: CharacterId; p2: CharacterId }>;
  };
  summaries: MatchSummary[];
}

const FIXED_DT = 1 / 60;
const DEFAULT_GAMES_PER_PAIRING = 12;
const DEFAULT_MAX_ROUND_SECONDS = 90;
const DEFAULT_PROFILE_ID = 'default';
const ROUNDS_TO_WIN = 2;
const MAX_ROUNDS_PER_SET = 5;

function parseIntegerArg(argv: string[], flag: string, fallback: number): number {
  const index = argv.findIndex((value) => value === flag);
  const raw = index >= 0 ? Number(argv[index + 1]) : Number.NaN;
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(1, Math.floor(raw));
}

function parseStringArg(argv: string[], flag: string): string | null {
  const index = argv.findIndex((value) => value === flag);
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1]?.trim();
  return value ? value : null;
}

function getPositionalArgs(argv: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith('--')) {
      index += 1;
      continue;
    }
    values.push(value);
  }
  return values;
}

function parseDifficultyIds(raw: string | null): AiDifficultyId[] {
  if (!raw || raw.toLowerCase() === 'all') {
    return [...AI_DIFFICULTY_ORDER];
  }
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is AiDifficultyId => AI_DIFFICULTY_ORDER.includes(value as AiDifficultyId));
  return parsed.length > 0 ? [...new Set(parsed)] : ['cadet'];
}

function buildPairings(p1Raw: string | null, p2Raw: string | null): Array<{ p1: CharacterId; p2: CharacterId }> {
  if (p1Raw && p2Raw && isCharacterId(p1Raw) && isCharacterId(p2Raw)) {
    return [{ p1: p1Raw, p2: p2Raw }];
  }

  const pairings: Array<{ p1: CharacterId; p2: CharacterId }> = [];
  for (const p1 of CHARACTER_IDS) {
    for (const p2 of CHARACTER_IDS) {
      if (p1 === p2) {
        continue;
      }
      pairings.push({ p1, p2 });
    }
  }
  return pairings;
}

function parseArgs(argv: string[]): CliOptions {
  const positionalArgs = getPositionalArgs(argv);
  const gamesPerPairing = parseIntegerArg(argv, '--games', Number(positionalArgs[0] ?? DEFAULT_GAMES_PER_PAIRING));
  const maxRoundSeconds = parseIntegerArg(argv, '--max-round-seconds', DEFAULT_MAX_ROUND_SECONDS);
  const profileId = parseStringArg(argv, '--profile') ?? DEFAULT_PROFILE_ID;
  const difficultyIds = parseDifficultyIds(parseStringArg(argv, '--difficulty') ?? positionalArgs[1] ?? null);
  const pairings = buildPairings(parseStringArg(argv, '--p1') ?? positionalArgs[2] ?? null, parseStringArg(argv, '--p2') ?? positionalArgs[3] ?? null);

  return {
    gamesPerPairing,
    maxRoundSeconds,
    profileId,
    difficultyIds,
    pairings,
  };
}

function simulateSet(
  p1: CharacterId,
  p2: CharacterId,
  difficulty: AiDifficultyId,
  profileId: string,
  setSeed: number,
  maxRoundSeconds: number,
): {
  winner: 'P1' | 'P2' | null;
  roundsPlayed: number;
  totalFrames: number;
  timeoutRounds: number;
} {
  const balanceProfile = resolveBalanceProfile(profileId);
  const maxRoundFrames = Math.max(1, Math.floor(maxRoundSeconds / FIXED_DT));
  let p1RoundWins = 0;
  let p2RoundWins = 0;
  let totalFrames = 0;
  let timeoutRounds = 0;

  for (let round = 0; round < MAX_ROUNDS_PER_SET; round += 1) {
    const state = createInitialState({
      loadout: { P1: p1, P2: p2 },
      seed: (setSeed + round) >>> 0,
      rules: { allowDunkWin: true },
    });
    state.tuning = { ...balanceProfile.tuning };

    let p1Controller = createAiController({
      seed: ((setSeed + round) ^ 0x517cc1b7) >>> 0,
      profileId: difficulty,
    });
    let p2Controller = createAiController({
      seed: ((setSeed + round) ^ 0x9e3779b9) >>> 0,
      profileId: difficulty,
    });

    let roundWinner: 'P1' | 'P2' | null = null;
    for (let frame = 0; frame < maxRoundFrames; frame += 1) {
      const p1AiTick = tickAiController(state, 'P1', p1Controller);
      p1Controller = p1AiTick.next;
      const p2AiTick = tickAiController(state, 'P2', p2Controller);
      p2Controller = p2AiTick.next;
      step(state, {
        p1: p1AiTick.input,
        p2: p2AiTick.input,
      }, FIXED_DT);
      totalFrames += 1;
      if (state.winner) {
        roundWinner = state.winner;
        break;
      }
    }

    if (!roundWinner) {
      timeoutRounds += 1;
      break;
    }

    if (roundWinner === 'P1') {
      p1RoundWins += 1;
    } else {
      p2RoundWins += 1;
    }

    if (p1RoundWins >= ROUNDS_TO_WIN || p2RoundWins >= ROUNDS_TO_WIN) {
      return {
        winner: p1RoundWins > p2RoundWins ? 'P1' : 'P2',
        roundsPlayed: round + 1,
        totalFrames,
        timeoutRounds,
      };
    }
  }

  return {
    winner: null,
    roundsPlayed: Math.max(p1RoundWins + p2RoundWins, 1),
    totalFrames,
    timeoutRounds,
  };
}

function formatSummaryMarkdown(report: BatchReport): string {
  const lines: string[] = [
    '# AI Matchup Batch Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Profile: \`${report.options.profileId}\``,
    `Games per pairing: ${report.options.gamesPerPairing}`,
    `Max round seconds: ${report.options.maxRoundSeconds}`,
    '',
    '| P1 | P2 | Difficulty | Games | P1 wins | P2 wins | Draws | Timeout rounds | Avg set sec | Avg rounds |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const summary of report.summaries) {
    lines.push(
      `| \`${summary.p1}\` | \`${summary.p2}\` | \`${summary.difficulty}\` | ${summary.games} | ${summary.p1SetWins} | ${summary.p2SetWins} | ${summary.drawnSets} | ${summary.totalRoundTimeouts} | ${summary.averageSetSeconds.toFixed(2)} | ${summary.averageRoundsPerSet.toFixed(2)} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function run(): void {
  const cli = parseArgs(process.argv.slice(2));
  resolveBalanceProfile(cli.profileId);

  const summaries: MatchSummary[] = [];
  let seedCursor = 0x10293847;

  for (const difficulty of cli.difficultyIds) {
    for (const pairing of cli.pairings) {
      let p1SetWins = 0;
      let p2SetWins = 0;
      let drawnSets = 0;
      let totalRoundTimeouts = 0;
      let totalFrames = 0;
      let totalRoundsPlayed = 0;

      for (let game = 0; game < cli.gamesPerPairing; game += 1) {
        seedCursor = (seedCursor + 0x9e3779b9) >>> 0;
        const result = simulateSet(
          pairing.p1,
          pairing.p2,
          difficulty,
          cli.profileId,
          seedCursor,
          cli.maxRoundSeconds,
        );

        totalFrames += result.totalFrames;
        totalRoundsPlayed += result.roundsPlayed;
        totalRoundTimeouts += result.timeoutRounds;
        if (result.winner === 'P1') {
          p1SetWins += 1;
        } else if (result.winner === 'P2') {
          p2SetWins += 1;
        } else {
          drawnSets += 1;
        }
      }

      summaries.push({
        p1: pairing.p1,
        p2: pairing.p2,
        difficulty,
        profileId: cli.profileId,
        games: cli.gamesPerPairing,
        p1SetWins,
        p2SetWins,
        drawnSets,
        totalRoundTimeouts,
        averageSetSeconds: (totalFrames / cli.gamesPerPairing) * FIXED_DT,
        averageRoundsPerSet: totalRoundsPlayed / cli.gamesPerPairing,
      });
    }
  }

  const report: BatchReport = {
    generatedAt: new Date().toISOString(),
    options: {
      gamesPerPairing: cli.gamesPerPairing,
      maxRoundSeconds: cli.maxRoundSeconds,
      profileId: cli.profileId,
      difficultyIds: cli.difficultyIds,
      pairings: cli.pairings,
    },
    summaries,
  };

  const outputDir = join(process.cwd(), 'build-artifacts');
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, 'ai-matchup-batch-report.json');
  const markdownPath = join(outputDir, 'ai-matchup-batch-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, formatSummaryMarkdown(report), 'utf8');

  console.info(`[ai-batch] json written ${jsonPath}`);
  console.info(`[ai-batch] markdown written ${markdownPath}`);
  for (const summary of summaries) {
    console.info(
      `[ai-batch] ${summary.difficulty} ${summary.p1} vs ${summary.p2} => ${summary.p1SetWins}-${summary.p2SetWins} draws=${summary.drawnSets} avgSet=${summary.averageSetSeconds.toFixed(2)}s`,
    );
  }
}

run();
