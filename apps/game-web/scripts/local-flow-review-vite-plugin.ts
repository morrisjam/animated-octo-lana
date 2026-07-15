import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import {
  LOCAL_FLOW_REVIEW_CATALOG_SCHEMA,
  LOCAL_FLOW_REVIEW_ENDPOINT,
  type LocalFlowReviewCase,
  type LocalFlowReviewCatalog,
} from '../src/dev/localFlowReviewCatalog';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(currentDir, '../build-artifacts');
const reportPath = path.resolve(artifactRoot, 'local-flow-review.json');
const MAX_REPLAY_BYTES = 16 * 1024 * 1024;

interface RawReviewReplay {
  kind?: unknown;
  status?: unknown;
  summary?: unknown;
  path?: unknown;
  label?: unknown;
  p1?: unknown;
  p2?: unknown;
  difficulty?: unknown;
  gameNumber?: unknown;
  roundNumber?: unknown;
  setSeed?: unknown;
  roundSeed?: unknown;
  focusFrame?: unknown;
  endFrame?: unknown;
  frames?: unknown;
}

interface RawBatchReport {
  schemaVersion?: unknown;
  generatedAt?: unknown;
  reviewReplays?: unknown;
}

function isSafeRelativeReplayPath(value: string): boolean {
  return value.startsWith('local-flow-review-replays/')
    && value.endsWith('-replay.json')
    && !value.includes('\\')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function parseReviewCase(raw: RawReviewReplay, index: number): LocalFlowReviewCase {
  const requiredStrings = ['kind', 'summary', 'path', 'label', 'p1', 'p2', 'difficulty'] as const;
  for (const field of requiredStrings) {
    if (typeof raw[field] !== 'string' || raw[field].trim().length === 0) {
      throw new Error(`Review replay ${index} has invalid ${field}.`);
    }
  }
  if (!isSafeRelativeReplayPath(raw.path as string)) {
    throw new Error(`Review replay ${index} has an unsafe path.`);
  }
  if (raw.status !== 'blocked' && raw.status !== 'watch' && raw.status !== 'representative') {
    throw new Error(`Review replay ${index} has invalid status.`);
  }
  const requiredIntegers = [
    'gameNumber',
    'roundNumber',
    'setSeed',
    'roundSeed',
    'focusFrame',
    'frames',
  ] as const;
  for (const field of requiredIntegers) {
    if (typeof raw[field] !== 'number' || !Number.isInteger(raw[field]) || raw[field] < 0) {
      throw new Error(`Review replay ${index} has invalid ${field}.`);
    }
  }
  if (raw.endFrame !== null && (
    typeof raw.endFrame !== 'number'
    || !Number.isInteger(raw.endFrame)
    || raw.endFrame < 0
  )) {
    throw new Error(`Review replay ${index} has invalid endFrame.`);
  }
  return {
    id: raw.path as string,
    kind: raw.kind as string,
    status: raw.status,
    summary: raw.summary as string,
    label: raw.label as string,
    p1: raw.p1 as string,
    p2: raw.p2 as string,
    difficulty: raw.difficulty as string,
    gameNumber: raw.gameNumber as number,
    roundNumber: raw.roundNumber as number,
    setSeed: raw.setSeed as number,
    roundSeed: raw.roundSeed as number,
    focusFrame: raw.focusFrame as number,
    endFrame: raw.endFrame as number | null,
    frames: raw.frames as number,
  };
}

async function loadCatalog(): Promise<LocalFlowReviewCatalog> {
  const raw = JSON.parse(await readFile(reportPath, 'utf8')) as RawBatchReport;
  if (typeof raw.schemaVersion !== 'string' || typeof raw.generatedAt !== 'string') {
    throw new Error('The local flow-review report header is invalid.');
  }
  if (!Array.isArray(raw.reviewReplays)) {
    throw new Error('The local flow-review report has no replay catalog.');
  }
  return {
    schemaVersion: LOCAL_FLOW_REVIEW_CATALOG_SCHEMA,
    generatedAt: raw.generatedAt,
    reportSchemaVersion: raw.schemaVersion,
    cases: raw.reviewReplays.map((entry, index) => parseReviewCase(entry as RawReviewReplay, index)),
  };
}

function sendJson(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`${JSON.stringify(value)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function localFlowReviewVitePlugin(): Plugin {
  return {
    name: 'gravity-well-local-flow-reviews',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== LOCAL_FLOW_REVIEW_ENDPOINT
          && requestUrl.pathname !== `${LOCAL_FLOW_REVIEW_ENDPOINT}/replay`) {
          next();
          return;
        }

        try {
          const catalog = await loadCatalog();
          if (requestUrl.pathname === LOCAL_FLOW_REVIEW_ENDPOINT) {
            sendJson(response, 200, catalog);
            return;
          }

          const id = requestUrl.searchParams.get('id') ?? '';
          const reviewCase = catalog.cases.find((entry) => entry.id === id);
          if (!reviewCase) {
            sendJson(response, 404, { error: 'Unknown local flow-review replay id.' });
            return;
          }
          const replayPath = path.resolve(artifactRoot, reviewCase.id);
          const rootPrefix = `${artifactRoot}${path.sep}`;
          if (!replayPath.startsWith(rootPrefix)) {
            sendJson(response, 400, { error: 'Local flow-review replay path escaped the artifact directory.' });
            return;
          }
          const replayStat = await stat(replayPath);
          if (!replayStat.isFile() || replayStat.size > MAX_REPLAY_BYTES) {
            sendJson(response, 413, { error: 'Local flow-review replay is missing or exceeds 16 MB.' });
            return;
          }
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(await readFile(replayPath));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          sendJson(response, code === 'ENOENT' ? 404 : 500, {
            error: code === 'ENOENT'
              ? 'No generated local AI flow review is available.'
              : `Local AI flow review could not be loaded: ${errorMessage(error)}`,
            hint: 'Run `npm run ai:flow-review` from the repository root, then reload this menu.',
          });
        }
      });
    },
  };
}
