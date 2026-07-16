import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from 'playwright-core';
import { preview, type PreviewServer } from 'vite';
import {
  summarisePresentationFrameTiming,
  type PresentationFrameTimingStatistics,
} from '../src/build/presentationFrameTiming';
import {
  LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION,
  parseLocalRankedRootSmokeBuildAttestation,
} from '../src/build/localRankedRootSmokeBuild';
import {
  createVisualAlphaLoopbackApiStub,
  resolveVisualAlphaLoopbackApiStubConfig,
  VISUAL_ALPHA_STUB_ACCOUNT_ID,
  type VisualAlphaLoopbackApiStubConfig,
  type VisualAlphaLoopbackApiStubRequestRecord,
} from '../src/build/visualAlphaLoopbackApiStub';
import {
  traceReplayActionStarts,
  validateReplayPayload,
  type ReplayActionStartTrace,
} from '../src/sim/replay';
import {
  BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION,
  type BalanceLabExperimentBundle,
} from '../src/sim/balanceLab';

const LOOPBACK_HOST = '127.0.0.1';
const VIEWPORT = { width: 1280, height: 720 } as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const RANDOM_SEED = 0x4757_2026;
const REPORT_SCHEMA_VERSION = 'gw.visual-alpha-smoke.v11';
const EXPECTED_ALPHA_STAGE_ID = 'wormhole_authored_v4';
const EXPECTED_STAGE_MODEL_ID = 'wormhole_arena_lip_v1';
const EXPECTED_CHARACTER_ATLAS_IDS = [
  'character_duelist_animset',
  'character_vanguard_animset',
] as const;
const ALPHA_ACTION_MARKER_FRAMES = [24, 40, 56, 76, 95, 120, 140, 160, 161, 179] as const;
const REQUIRED_ALPHA_ACTION_STARTS = [
  { frame: 40, playerId: 'P1', action: 'special' },
  { frame: 120, playerId: 'P2', action: 'special' },
] as const satisfies readonly ReplayActionStartTrace[];
const FRAME_TIMING_WARMUP_FRAMES = 30;
const FRAME_TIMING_SAMPLE_INTERVALS = 180;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const distRoot = path.resolve(appRoot, 'dist');
const replayRoot = path.resolve(appRoot, 'replays');
const artifactRoot = path.resolve(appRoot, 'build-artifacts/visual-alpha-smoke');
const reportPath = path.resolve(artifactRoot, 'report.json');
const smokeFixturePath = path.resolve(replayRoot, 'smoke.replay.json');
const alphaFixturePath = path.resolve(replayRoot, 'alpha-visual.replay.json');
const localRankedRootSmokeBuildPath = path.resolve(distRoot, 'local-ranked-root-smoke-build.json');

interface FixtureSummary {
  fileName: string;
  url: string;
  status: number;
  contentType: string;
  frames: number;
}

interface WebGlSummary {
  canvasWidth: number;
  canvasHeight: number;
  cssWidth: number;
  cssHeight: number;
  contextType: 'webgl2' | 'webgl';
  renderer: string;
  version: string;
}

interface ScreenshotSummary {
  label: string;
  frame: number | null;
  path: string;
  bytes: number;
  sha256: string;
}

interface PresentationFrameTimingSummary extends PresentationFrameTimingStatistics {
  context: 'local_match';
  reportOnly: true;
  warmupFrames: number;
  visibilityState: DocumentVisibilityState;
  hardwareConcurrency: number;
}

interface ReplayActionCoverageSummary {
  fixture: string;
  loadout: { P1: string; P2: string };
  requiredActionStarts: ReplayActionStartTrace[];
  observedActionStarts: ReplayActionStartTrace[];
}

interface DiagnosticsQueryGuardSummary {
  attemptedOverride: '1';
  overlayElements: number;
  launcherElements: number;
  blocked: boolean;
}

interface AssetPreloadReadinessSummary {
  context: 'diagnostics_guard' | 'home' | 'balance_return';
  state: 'ready';
  bytesLoaded: number;
  stageModelState: 'ready';
  stageModelLoadedIds: string[];
  characterAssetState: 'ready';
  characterAssetRequiredIds: string[];
  characterAssetReadyIds: string[];
  characterAssetLoadingIds: string[];
  characterAssetFailedIds: string[];
  characterAssetFallbackIds: string[];
  selectedStageId: typeof EXPECTED_ALPHA_STAGE_ID;
  requestedStageModelId: typeof EXPECTED_STAGE_MODEL_ID;
  visibleStageModelId: typeof EXPECTED_STAGE_MODEL_ID;
}

interface LoopbackApiStubSummary {
  attestationSchemaVersion: typeof LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION;
  buildId: string;
  apiBaseUrl: string;
  accountId: typeof VISUAL_ALPHA_STUB_ACCOUNT_ID;
  requests: VisualAlphaLoopbackApiStubRequestRecord[];
}

interface LocalRoundReviewSummary {
  buttonLabel: 'Review Latest Local Round';
  balanceLabHiddenInOrdinarySparring: boolean;
  totalFrames: number;
  sourceLabel: string;
  p2DecisionTraceVisible: boolean;
  fightStoryStatus: 'maturing' | 'progressing' | 'watch' | 'blocked';
  fightStoryHeadline: string;
  fightStoryFocusStage: string | null;
  pausedStoryNodeStable: boolean;
  returnedToPausedMatch: boolean;
}

interface BalanceSparringSummary {
  modeLabel: 'Balance Sparring (Local)';
  humanPlayer: 'P1';
  aiPlayer: 'P2';
  probeId: 'human_post_control_agency';
  scenarioId: 'p1_control_return_pressure';
  stagedField: 'naturalRecoveryResetMultiplier';
  stagedValue: number;
  appliedValue: number;
  sameSeedRestart: boolean;
  pendingChangesAfterRestart: boolean;
  p1AiControllerHidden: boolean;
  p2AiControllerEnabled: boolean;
  baselineReviewLocked: boolean;
  baselineReviewSnapshotRetained: boolean;
  experimentSchemaVersion: typeof BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION;
  baselineChaseVerdict: 'blocked';
  candidateChaseVerdict: 'clear';
  separatePlaytestNotesRetained: boolean;
  replaySourceLabel: string;
  p2DecisionTraceVisible: boolean;
}

interface VisualSmokeReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  generatedAt: string;
  ok: boolean;
  localOnly: true;
  hostedServicesContacted: false;
  origin: string | null;
  viewport: typeof VIEWPORT;
  randomSeed: number;
  browserExecutable: string | null;
  fixtures: FixtureSummary[];
  webgl: WebGlSummary | null;
  presentationFrameTiming: PresentationFrameTimingSummary | null;
  alphaActionCoverage: ReplayActionCoverageSummary | null;
  diagnosticsQueryGuard: DiagnosticsQueryGuardSummary | null;
  assetPreloadReadiness: AssetPreloadReadinessSummary[];
  loopbackApiStub: LoopbackApiStubSummary | null;
  localRoundReview: LocalRoundReviewSummary | null;
  balanceSparring: BalanceSparringSummary | null;
  screenshots: ScreenshotSummary[];
  consoleMessages: string[];
  pageErrors: string[];
  failedSameOriginRequests: string[];
  blockedExternalRequests: string[];
  error?: string;
}

interface RawReplayFixture {
  header?: unknown;
  inputTimeline?: unknown;
}

async function verifyAlphaActionCoverage(fixturePath: string): Promise<ReplayActionCoverageSummary> {
  const rawFixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
  const validation = validateReplayPayload(rawFixture);
  if (validation.ok === false) {
    throw new Error(`Alpha visual replay is invalid: ${validation.error.message}`);
  }

  const loadout = validation.payload.header.loadout;
  if (loadout?.P1 !== 'vanguard' || loadout.P2 !== 'duelist') {
    throw new Error('Alpha visual replay must load Vanguard as P1 and Duelist as P2.');
  }

  const observedActionStarts = traceReplayActionStarts(validation.payload);
  for (const required of REQUIRED_ALPHA_ACTION_STARTS) {
    const observed = observedActionStarts.some((event) => (
      event.frame === required.frame
      && event.playerId === required.playerId
      && event.action === required.action
    ));
    if (!observed) {
      throw new Error(
        `Alpha visual replay did not accept ${required.playerId} ${required.action} at frame ${required.frame}.`,
      );
    }
  }

  return {
    fixture: path.basename(fixturePath),
    loadout: { P1: loadout.P1, P2: loadout.P2 },
    requiredActionStarts: REQUIRED_ALPHA_ACTION_STARTS.map((event) => ({ ...event })),
    observedActionStarts,
  };
}

function parseTimeout(): number {
  const timeout = Number(process.env.VISUAL_ALPHA_SMOKE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new Error('VISUAL_ALPHA_SMOKE_TIMEOUT_MS must be between 1000 and 120000.');
  }
  return Math.floor(timeout);
}

async function readLoopbackApiStubConfig(): Promise<VisualAlphaLoopbackApiStubConfig | null> {
  if (!existsSync(localRankedRootSmokeBuildPath)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(localRankedRootSmokeBuildPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `Local ranked-root smoke build attestation is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return resolveVisualAlphaLoopbackApiStubConfig(
    parseLocalRankedRootSmokeBuildAttestation(raw),
  );
}

function localBrowserCandidates(): string[] {
  if (process.platform === 'win32') {
    return [
      process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
      process.env['PROGRAMFILES(X86)']
        && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env['PROGRAMFILES(X86)']
        && `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter((candidate): candidate is string => Boolean(candidate));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

function resolveBrowserExecutable(): string {
  const explicit = String(process.env.BROWSER_EXECUTABLE_PATH ?? '').trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`BROWSER_EXECUTABLE_PATH does not exist: ${explicit}`);
    }
    return explicit;
  }
  const executable = localBrowserCandidates().find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      'Google Chrome, Microsoft Edge, or Chromium is required. Set BROWSER_EXECUTABLE_PATH when it is installed outside a standard location.',
    );
  }
  return executable;
}

function assertLoopbackUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' || (url.hostname !== LOOPBACK_HOST && url.hostname !== 'localhost')) {
    throw new Error(`Visual smoke target must be loopback HTTP, received ${url.origin}.`);
  }
  return url;
}

function reserveAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a loopback preview port.'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

function recordConsoleMessage(messages: string[], message: ConsoleMessage): void {
  messages.push(`[${message.type()}] ${message.text()}`);
}

function relativeArtifactPath(absolutePath: string): string {
  return path.relative(appRoot, absolutePath).split(path.sep).join('/');
}

async function writeReport(report: VisualSmokeReport): Promise<void> {
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function captureScreenshot(
  page: Page,
  screenshots: ScreenshotSummary[],
  label: string,
  frame: number | null,
): Promise<void> {
  const filePath = path.resolve(artifactRoot, `${label}.png`);
  await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled' });
  const contents = await readFile(filePath);
  if (contents.byteLength === 0) {
    throw new Error(`Screenshot ${label} was empty.`);
  }
  screenshots.push({
    label,
    frame,
    path: relativeArtifactPath(filePath),
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  });
}

async function captureElementScreenshot(
  page: Page,
  screenshots: ScreenshotSummary[],
  selector: string,
  label: string,
  frame: number | null,
): Promise<void> {
  const filePath = path.resolve(artifactRoot, `${label}.png`);
  await page.locator(selector).screenshot({ path: filePath, animations: 'disabled' });
  const contents = await readFile(filePath);
  if (contents.byteLength === 0) {
    throw new Error(`Screenshot ${label} was empty.`);
  }
  screenshots.push({
    label,
    frame,
    path: relativeArtifactPath(filePath),
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  });
}

async function captureCanvasFocusedScreenshot(
  page: Page,
  screenshots: ScreenshotSummary[],
  label: string,
  frame: number,
): Promise<void> {
  const overlays = page.locator('.replay-viewer, #hud');
  await overlays.evaluateAll((elements) => {
    for (const element of elements) {
      const htmlElement = element as HTMLElement;
      htmlElement.setAttribute('data-visual-smoke-visibility', htmlElement.style.visibility);
      htmlElement.style.visibility = 'hidden';
    }
  });
  try {
    await waitForRenderedFrame(page);
    await captureScreenshot(page, screenshots, label, frame);
  } finally {
    await overlays.evaluateAll((elements) => {
      for (const element of elements) {
        const htmlElement = element as HTMLElement;
        htmlElement.style.visibility = htmlElement.getAttribute('data-visual-smoke-visibility') ?? '';
        htmlElement.removeAttribute('data-visual-smoke-visibility');
      }
    });
  }
}

async function waitForRenderedFrame(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
    });
  });
}

async function waitForAssetPreload(
  page: Page,
  context: AssetPreloadReadinessSummary['context'],
  timeoutMs: number,
): Promise<AssetPreloadReadinessSummary> {
  await page.waitForFunction(
    () => {
      const state = document.documentElement.dataset.assetPreloadState;
      return state === 'ready' || state === 'failed';
    },
    undefined,
    { timeout: timeoutMs },
  );
  const rawResult = await page.evaluate(() => ({
    state: document.documentElement.dataset.assetPreloadState ?? 'missing',
    bytesLoaded: Number(document.documentElement.dataset.assetPreloadBytes ?? Number.NaN),
    stageModelState: document.documentElement.dataset.stageModelState ?? 'missing',
    stageModelLoadedIds: document.documentElement.dataset.stageModelLoadedIds,
    characterAssetState: document.documentElement.dataset.characterAssetState ?? 'missing',
    characterAssetRequiredIds: document.documentElement.dataset.characterAssetRequiredIds,
    characterAssetReadyIds: document.documentElement.dataset.characterAssetReadyIds,
    characterAssetLoadingIds: document.documentElement.dataset.characterAssetLoadingIds,
    characterAssetFailedIds: document.documentElement.dataset.characterAssetFailedIds,
    characterAssetFallbackIds: document.documentElement.dataset.characterAssetFallbackIds,
    selectedStageId: document.querySelector<HTMLCanvasElement>('canvas#game')?.dataset.stageAtmosphereId ?? 'missing',
    requestedStageModelId: document.querySelector<HTMLCanvasElement>('canvas#game')?.dataset.stageModelId ?? 'missing',
    visibleStageModelId: document.querySelector<HTMLCanvasElement>('canvas#game')?.dataset.stageModelVisibleId ?? 'missing',
  }));
  const parseIds = (value: string | undefined) => (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const result = {
    ...rawResult,
    stageModelLoadedIds: parseIds(rawResult.stageModelLoadedIds),
    characterAssetRequiredIds: parseIds(rawResult.characterAssetRequiredIds),
    characterAssetReadyIds: parseIds(rawResult.characterAssetReadyIds),
    characterAssetLoadingIds: parseIds(rawResult.characterAssetLoadingIds),
    characterAssetFailedIds: parseIds(rawResult.characterAssetFailedIds),
    characterAssetFallbackIds: parseIds(rawResult.characterAssetFallbackIds),
  };
  if (result.state !== 'ready') {
    throw new Error(`Asset preload reached ${result.state} before ${context}.`);
  }
  if (!Number.isSafeInteger(result.bytesLoaded) || result.bytesLoaded <= 0) {
    throw new Error(`Asset preload reported invalid byte evidence before ${context}: ${result.bytesLoaded}.`);
  }
  if (result.stageModelState !== 'ready') {
    throw new Error(`Stage model runtime reached ${result.stageModelState} before ${context}.`);
  }
  if (!result.stageModelLoadedIds.includes(EXPECTED_STAGE_MODEL_ID)) {
    throw new Error(`Stage model runtime did not load ${EXPECTED_STAGE_MODEL_ID} before ${context}.`);
  }
  const expectedCharacterAtlasIds = [...EXPECTED_CHARACTER_ATLAS_IDS];
  if (result.characterAssetState !== 'ready') {
    throw new Error(`Character atlas runtime reached ${result.characterAssetState} before ${context}.`);
  }
  if (result.characterAssetRequiredIds.join(',') !== expectedCharacterAtlasIds.join(',')) {
    throw new Error(
      `Character atlas runtime required ${result.characterAssetRequiredIds.join(',') || 'no IDs'} before ${context}; `
        + `expected ${expectedCharacterAtlasIds.join(',')}.`,
    );
  }
  if (result.characterAssetReadyIds.join(',') !== expectedCharacterAtlasIds.join(',')) {
    throw new Error(
      `Character atlas runtime readied ${result.characterAssetReadyIds.join(',') || 'no IDs'} before ${context}; `
        + `expected ${expectedCharacterAtlasIds.join(',')}.`,
    );
  }
  if (
    result.characterAssetLoadingIds.length > 0
    || result.characterAssetFailedIds.length > 0
    || result.characterAssetFallbackIds.length > 0
  ) {
    throw new Error(
      `Character atlas runtime retained non-ready IDs before ${context}: `
        + `loading=${result.characterAssetLoadingIds.join(',') || 'none'}, `
        + `failed=${result.characterAssetFailedIds.join(',') || 'none'}, `
        + `fallback=${result.characterAssetFallbackIds.join(',') || 'none'}.`,
    );
  }
  if (result.selectedStageId !== EXPECTED_ALPHA_STAGE_ID) {
    throw new Error(`Selected stage ${result.selectedStageId} does not match ${EXPECTED_ALPHA_STAGE_ID} before ${context}.`);
  }
  if (
    result.requestedStageModelId !== EXPECTED_STAGE_MODEL_ID
    || result.visibleStageModelId !== EXPECTED_STAGE_MODEL_ID
  ) {
    throw new Error(
      `Authored stage model was not visible before ${context}: `
        + `requested=${result.requestedStageModelId}, visible=${result.visibleStageModelId}.`,
    );
  }
  return {
    context,
    state: 'ready',
    bytesLoaded: result.bytesLoaded,
    stageModelState: 'ready',
    stageModelLoadedIds: result.stageModelLoadedIds,
    characterAssetState: 'ready',
    characterAssetRequiredIds: result.characterAssetRequiredIds,
    characterAssetReadyIds: result.characterAssetReadyIds,
    characterAssetLoadingIds: result.characterAssetLoadingIds,
    characterAssetFailedIds: result.characterAssetFailedIds,
    characterAssetFallbackIds: result.characterAssetFallbackIds,
    selectedStageId: EXPECTED_ALPHA_STAGE_ID,
    requestedStageModelId: EXPECTED_STAGE_MODEL_ID,
    visibleStageModelId: EXPECTED_STAGE_MODEL_ID,
  };
}

async function measurePresentationFrameTiming(page: Page): Promise<PresentationFrameTimingSummary> {
  const sample = await page.evaluate(async ({ warmupFrames, sampleIntervals }) => {
    for (let index = 0; index < warmupFrames; index += 1) {
      await new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => resolveFrame());
      });
    }
    const timestamps: number[] = [await new Promise<number>((resolveFrame) => {
      requestAnimationFrame((timestamp) => resolveFrame(timestamp));
    })];
    for (let index = 0; index < sampleIntervals; index += 1) {
      timestamps.push(await new Promise<number>((resolveFrame) => {
        requestAnimationFrame((timestamp) => resolveFrame(timestamp));
      }));
    }
    return {
      timestamps,
      visibilityState: document.visibilityState,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  }, {
    warmupFrames: FRAME_TIMING_WARMUP_FRAMES,
    sampleIntervals: FRAME_TIMING_SAMPLE_INTERVALS,
  });
  return {
    context: 'local_match',
    reportOnly: true,
    warmupFrames: FRAME_TIMING_WARMUP_FRAMES,
    visibilityState: sample.visibilityState,
    hardwareConcurrency: sample.hardwareConcurrency,
    ...summarisePresentationFrameTiming(
      sample.timestamps.slice(1).map((timestamp, index) => (
        timestamp - (sample.timestamps[index] ?? timestamp)
      )),
    ),
  };
}

async function verifyFixtureResponse(page: Page, origin: string, fileName: string): Promise<FixtureSummary> {
  const fixtureUrl = new URL(`/replays/${fileName}`, origin);
  const response = await page.evaluate(async (url) => {
    const result = await fetch(url, { cache: 'no-store' });
    return {
      status: result.status,
      contentType: result.headers.get('content-type') ?? '',
      body: await result.text(),
    };
  }, fixtureUrl.toString());

  if (response.status !== 200) {
    throw new Error(`${fixtureUrl.pathname} returned HTTP ${response.status}.`);
  }
  if (!response.contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `${fixtureUrl.pathname} returned ${response.contentType || 'no content type'} instead of JSON.`,
    );
  }

  let fixture: RawReplayFixture;
  try {
    fixture = JSON.parse(response.body) as RawReplayFixture;
  } catch {
    throw new Error(`${fixtureUrl.pathname} returned a non-JSON response body.`);
  }
  if (!fixture.header || !Array.isArray(fixture.inputTimeline) || fixture.inputTimeline.length === 0) {
    throw new Error(`${fixtureUrl.pathname} is not a non-empty replay payload.`);
  }

  return {
    fileName,
    url: fixtureUrl.toString(),
    status: response.status,
    contentType: response.contentType,
    frames: fixture.inputTimeline.length,
  };
}

async function verifyWebGl(page: Page): Promise<WebGlSummary> {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas#game');
    if (!canvas) {
      return { error: 'Missing canvas#game.' };
    }
    const context2 = canvas.getContext('webgl2');
    const context1 = context2 ? null : canvas.getContext('webgl');
    const gl = context2 ?? context1;
    if (!gl) {
      return { error: 'The game canvas has no WebGL context.' };
    }
    if (gl.isContextLost()) {
      return { error: 'The game WebGL context is lost.' };
    }
    const bounds = canvas.getBoundingClientRect();
    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      cssWidth: Math.round(bounds.width),
      cssHeight: Math.round(bounds.height),
      contextType: context2 ? 'webgl2' as const : 'webgl' as const,
      renderer: String(gl.getParameter(gl.RENDERER)),
      version: String(gl.getParameter(gl.VERSION)),
    };
  });

  if ('error' in result) {
    throw new Error(result.error);
  }
  if (
    result.canvasWidth !== VIEWPORT.width
    || result.canvasHeight !== VIEWPORT.height
    || result.cssWidth !== VIEWPORT.width
    || result.cssHeight !== VIEWPORT.height
  ) {
    throw new Error(
      `Game canvas was ${result.canvasWidth}x${result.canvasHeight} (${result.cssWidth}x${result.cssHeight} CSS), expected 1280x720.`,
    );
  }
  return result;
}

async function openReplayMenu(page: Page, timeoutMs: number): Promise<void> {
  const titleHeading = page.getByRole('heading', { name: 'Gravity Well', exact: true });
  await titleHeading.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  const loginHeading = page.getByRole('heading', { name: 'Login', exact: true });
  await loginHeading.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('button', { name: /^Continue(?: as Guest)?$/ }).click();

  const mainHeading = page.getByRole('heading', { name: 'Main Menu', exact: true });
  await mainHeading.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('button', { name: 'Replays', exact: true }).click();
  await page.getByRole('heading', { name: 'Replays', exact: true })
    .waitFor({ state: 'visible', timeout: timeoutMs });
}

async function openLocalMatch(
  page: Page,
  timeoutMs: number,
  requestedMode?: string,
): Promise<void> {
  const titleHeading = page.getByRole('heading', { name: 'Gravity Well', exact: true });
  await titleHeading.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  const loginHeading = page.getByRole('heading', { name: 'Login', exact: true });
  await loginHeading.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('button', { name: /^Continue(?: as Guest)?$/ }).click();

  const mainHeading = page.getByRole('heading', { name: 'Main Menu', exact: true });
  await mainHeading.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('heading', { name: 'Local', exact: true })
    .waitFor({ state: 'visible', timeout: timeoutMs });
  if (requestedMode) {
    const modeButton = page.getByRole('button', { name: /^Mode:/ });
    let selected = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if ((await modeButton.innerText()).trim() === `Mode: ${requestedMode}`) {
        selected = true;
        break;
      }
      await modeButton.click();
    }
    if (!selected) {
      throw new Error(`Local setup could not select mode ${requestedMode}.`);
    }
  }
  await page.getByRole('button', { name: 'Start Local Match', exact: true }).click();
  await page.locator('.start-menu').waitFor({ state: 'hidden', timeout: timeoutMs });
}

function readSeedFromMatchInfo(value: string): number {
  const match = /\bseed\s+(\d+)\b/i.exec(value);
  const seed = Number(match?.[1]);
  if (!Number.isInteger(seed) || seed < 1) {
    throw new Error(`Balance Sparring match info did not expose a valid seed: ${value}`);
  }
  return seed;
}

async function readBalanceExperimentDownload(downloadPath: string | null): Promise<BalanceLabExperimentBundle> {
  if (!downloadPath) {
    throw new Error('Balance Sparring experiment download did not provide a local file path.');
  }
  const value = JSON.parse(await readFile(downloadPath, 'utf8')) as Partial<BalanceLabExperimentBundle>;
  if (
    value.schemaVersion !== BALANCE_LAB_EXPERIMENT_SCHEMA_VERSION
    || value.purpose !== 'flow_first_manual_balance_review'
    || !value.review
  ) {
    throw new Error('Balance Sparring exported an invalid or outdated experiment payload.');
  }
  return value as BalanceLabExperimentBundle;
}

async function verifyBalanceSparring(
  page: Page,
  screenshots: ScreenshotSummary[],
  timeoutMs: number,
): Promise<BalanceSparringSummary> {
  const modeLabel = 'Balance Sparring (Local)' as const;
  const probeId = 'human_post_control_agency' as const;
  const scenarioId = 'p1_control_return_pressure' as const;
  await openLocalMatch(page, timeoutMs, modeLabel);
  const matchInfo = page.locator('#matchInfo');
  await matchInfo.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.waitForFunction(
    () => document.querySelector('#matchInfo')?.textContent?.includes('Mode: Balance Sparring') ?? false,
    undefined,
    { timeout: timeoutMs },
  );
  await page.keyboard.press('Escape');
  const pauseMenu = page.locator('.pause-menu');
  await pauseMenu.waitFor({ state: 'visible', timeout: timeoutMs });
  const balanceLabTab = pauseMenu.locator('.pause-tab-btn').filter({ hasText: /^Balance Lab$/ });
  await balanceLabTab.click();
  await pauseMenu.getByRole('heading', { name: 'Balance Lab', exact: true })
    .waitFor({ state: 'visible', timeout: timeoutMs });

  const probeSelect = pauseMenu.locator('.balance-test-recipe-picker select');
  await probeSelect.selectOption(probeId);
  await pauseMenu.locator('.balance-pending-change.scenario')
    .waitFor({ state: 'visible', timeout: timeoutMs });
  await pauseMenu.getByRole('button', { name: 'Apply + Restart Manually', exact: true }).click();
  await pauseMenu.waitFor({ state: 'hidden', timeout: timeoutMs });
  await page.waitForFunction(
    () => document.querySelector('#matchInfo')?.textContent?.includes('Probe: Human recovery agency') ?? false,
    undefined,
    { timeout: timeoutMs },
  );
  const initialSeed = readSeedFromMatchInfo(await matchInfo.innerText());
  await page.waitForTimeout(1_500);

  await page.keyboard.press('Escape');
  await pauseMenu.waitFor({ state: 'visible', timeout: timeoutMs });
  await balanceLabTab.click();
  if (await probeSelect.inputValue() !== probeId) {
    throw new Error('Balance Sparring did not retain the human recovery probe after restart.');
  }
  const activeScenario = await pauseMenu.locator('.balance-scenario-picker select').inputValue();
  if (activeScenario !== scenarioId) {
    throw new Error(`Balance Sparring activated scenario ${activeScenario}, expected ${scenarioId}.`);
  }

  const p1Controller = pauseMenu.locator('select[data-player-id="P1"]');
  const p2Controller = pauseMenu.locator('select[data-player-id="P2"]');
  const p1AiControllerHidden = !(await p1Controller.isVisible());
  const p2AiControllerEnabled = await p2Controller.isVisible() && !(await p2Controller.isDisabled());
  if (!p1AiControllerHidden || !p2AiControllerEnabled) {
    throw new Error('Balance Sparring did not present P1 as human and P2 as the only tunable AI role.');
  }

  const playtestReview = pauseMenu.locator('.balance-experiment-review');
  await playtestReview.locator('summary').click();
  const baselineChase = playtestReview.locator(
    'select[data-playtest-variant="baseline"][data-loop-stage="chase"]',
  );
  await baselineChase.selectOption('blocked');
  await playtestReview.getByLabel('Baseline notes').fill(
    'Pressure returned before I could make a deliberate spacing choice.',
  );
  await playtestReview.getByLabel('What are you trying to change?').fill(
    'Create a readable decision window after control returns.',
  );
  await pauseMenu.getByRole('button', { name: 'Capture Run As Baseline', exact: true }).click();

  const baselineNotes = playtestReview.getByLabel('Baseline notes');
  const baselineReviewLocked = await baselineNotes.isDisabled() && await baselineChase.isDisabled();
  if (!baselineReviewLocked) {
    throw new Error('Balance Sparring did not freeze the baseline review with its captured run.');
  }
  await baselineNotes.evaluate((element) => {
    (element as HTMLTextAreaElement).value = 'This post-capture mutation must not be exported.';
  });
  await baselineChase.evaluate((element) => {
    (element as HTMLSelectElement).value = 'clear';
  });

  const recoveryField = pauseMenu.locator(
    '[data-tuning-key="naturalRecoveryResetMultiplier"] input',
  );
  await recoveryField.waitFor({ state: 'visible', timeout: timeoutMs });
  if (await recoveryField.isDisabled()) {
    throw new Error('Balance Sparring did not enable local recovery tuning.');
  }
  const stagedValue = 0.75;
  await recoveryField.fill(String(stagedValue));
  await pauseMenu.locator('.balance-pending-change.global')
    .waitFor({ state: 'visible', timeout: timeoutMs });
  await captureElementScreenshot(
    page,
    screenshots,
    '.pause-menu',
    'balance-sparring-staged',
    null,
  );

  await pauseMenu.getByRole('button', { name: 'Apply + Restart Manually', exact: true }).click();
  await pauseMenu.waitFor({ state: 'hidden', timeout: timeoutMs });
  await page.waitForFunction(
    () => document.querySelector('#matchInfo')?.textContent?.includes('Probe: Human recovery agency') ?? false,
    undefined,
    { timeout: timeoutMs },
  );
  const restartedSeed = readSeedFromMatchInfo(await matchInfo.innerText());
  await page.waitForTimeout(1_500);

  await page.keyboard.press('Escape');
  await pauseMenu.waitFor({ state: 'visible', timeout: timeoutMs });
  await balanceLabTab.click();
  await recoveryField.waitFor({ state: 'visible', timeout: timeoutMs });
  const appliedValue = Number(await recoveryField.inputValue());
  const pendingChangesAfterRestart = await pauseMenu.locator('.balance-pending-change').count() > 0;
  if (appliedValue !== stagedValue) {
    throw new Error(`Balance Sparring restarted with recovery value ${appliedValue}, expected ${stagedValue}.`);
  }
  if (pendingChangesAfterRestart) {
    throw new Error('Balance Sparring still reported staged changes after applying the clean restart.');
  }
  if (restartedSeed !== initialSeed) {
    throw new Error(`Balance Sparring changed seed ${initialSeed} to ${restartedSeed} during a controlled restart.`);
  }

  const candidateChase = playtestReview.locator(
    'select[data-playtest-variant="candidate"][data-loop-stage="chase"]',
  );
  await candidateChase.selectOption('clear');
  await playtestReview.getByLabel('Candidate notes').fill(
    'The first reset remained visible long enough to choose a new approach.',
  );
  await playtestReview.getByLabel('Comparison conclusion').fill(
    'The candidate created a clearer Chase transition without changing the test question.',
  );
  await playtestReview.getByLabel('Decision').selectOption('iterate');
  await captureElementScreenshot(
    page,
    screenshots,
    '.balance-experiment-review',
    'balance-sparring-scorecard',
    null,
  );
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: timeoutMs }),
    pauseMenu.getByRole('button', { name: 'Export Experiment JSON', exact: true }).click(),
  ]);
  const experiment = await readBalanceExperimentDownload(await download.path());
  const baselineChaseVerdict = experiment.review.baseline.stages.chase;
  const candidateChaseVerdict = experiment.review.candidate.stages.chase;
  const separatePlaytestNotesRetained = (
    experiment.review.baseline.notes === 'Pressure returned before I could make a deliberate spacing choice.'
    && experiment.review.candidate.notes === 'The first reset remained visible long enough to choose a new approach.'
  );
  const baselineReviewSnapshotRetained = baselineChaseVerdict === 'blocked'
    && experiment.review.baseline.notes === 'Pressure returned before I could make a deliberate spacing choice.';
  const baselineDescriptor = experiment.baseline.scenario?.descriptor;
  const candidateDescriptor = experiment.candidate.scenario?.descriptor;
  if (
    baselineChaseVerdict !== 'blocked'
    || candidateChaseVerdict !== 'clear'
    || !separatePlaytestNotesRetained
    || !baselineReviewSnapshotRetained
  ) {
    throw new Error('Balance Sparring experiment export did not retain separate human playtest evidence.');
  }
  if (
    baselineDescriptor?.balanceTestRecipeId !== probeId
    || baselineDescriptor.startingSituationId !== scenarioId
    || baselineDescriptor.humanControlledPlayerId !== 'P1'
    || candidateDescriptor?.balanceTestRecipeId !== probeId
    || candidateDescriptor.startingSituationId !== scenarioId
    || candidateDescriptor.humanControlledPlayerId !== 'P1'
  ) {
    throw new Error('Balance Sparring experiment did not preserve named human recovery probe provenance.');
  }
  if (
    experiment.baseline.tuning.naturalRecoveryResetMultiplier !== 0
    || experiment.candidate.tuning.naturalRecoveryResetMultiplier !== stagedValue
  ) {
    throw new Error('Balance Sparring experiment did not compare the intended recovery rule.');
  }

  await pauseMenu.locator('.pause-tab-btn').filter({ hasText: /^Pause$/ }).click();
  const reviewButton = pauseMenu.getByRole('button', {
    name: 'Review Latest Local Round',
    exact: true,
  });
  await reviewButton.waitFor({ state: 'visible', timeout: timeoutMs });
  await reviewButton.click();
  await waitForReplayViewer(page, timeoutMs);
  const replaySourceLabel = (await page.locator('.replay-viewer-subtitle').innerText()).trim();
  if (!replaySourceLabel.includes('Live Balance Sparring round')) {
    throw new Error(`Balance Sparring replay has unexpected source label: ${replaySourceLabel}`);
  }
  if (!replaySourceLabel.includes('Human recovery agency')) {
    throw new Error(`Balance Sparring replay lost named probe provenance: ${replaySourceLabel}`);
  }
  const p2Decision = page.locator('.replay-decision-player.p2');
  await p2Decision.waitFor({ state: 'visible', timeout: timeoutMs });
  const p2DecisionTraceVisible = /P2\s*\|\s*F\d+/.test(await p2Decision.innerText());
  if (!p2DecisionTraceVisible) {
    throw new Error('Balance Sparring replay did not expose the P2 AI decision trace.');
  }
  await page.getByRole('button', { name: 'Exit [Esc]', exact: true }).click();
  await pauseMenu.waitFor({ state: 'visible', timeout: timeoutMs });

  return {
    modeLabel,
    humanPlayer: 'P1',
    aiPlayer: 'P2',
    probeId,
    scenarioId,
    stagedField: 'naturalRecoveryResetMultiplier',
    stagedValue,
    appliedValue,
    sameSeedRestart: restartedSeed === initialSeed,
    pendingChangesAfterRestart,
    p1AiControllerHidden,
    p2AiControllerEnabled,
    baselineReviewLocked,
    baselineReviewSnapshotRetained,
    experimentSchemaVersion: experiment.schemaVersion,
    baselineChaseVerdict,
    candidateChaseVerdict,
    separatePlaytestNotesRetained,
    replaySourceLabel,
    p2DecisionTraceVisible,
  };
}

async function verifyLazyPauseMenu(
  page: Page,
  screenshots: ScreenshotSummary[],
  timeoutMs: number,
): Promise<LocalRoundReviewSummary> {
  const reviewButtonLabel = 'Review Latest Local Round' as const;
  const pauseMenu = page.locator('.pause-menu');
  await page.keyboard.press('Escape');
  await pauseMenu.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('heading', { name: 'Paused', exact: true })
    .waitFor({ state: 'visible', timeout: timeoutMs });
  const ordinaryBalanceLabVisible = await pauseMenu
    .locator('.pause-tab-btn')
    .filter({ hasText: /^Balance Lab$/ })
    .isVisible();
  if (ordinaryBalanceLabVisible) {
    throw new Error('Ordinary production sparring exposed the local Balance Lab.');
  }
  await captureScreenshot(page, screenshots, 'pause-first-open', null);

  const reviewButton = pauseMenu.getByRole('button', { name: reviewButtonLabel, exact: true });
  await reviewButton.waitFor({ state: 'visible', timeout: timeoutMs });
  await reviewButton.click();
  const totalFrames = await waitForReplayViewer(page, timeoutMs);
  const sourceLabel = (await page.locator('.replay-viewer-subtitle').innerText()).trim();
  if (!sourceLabel.includes('Live AI sparring round')) {
    throw new Error(`Local round review has unexpected source label: ${sourceLabel}`);
  }
  const p2Decision = page.locator('.replay-decision-player.p2');
  await p2Decision.waitFor({ state: 'visible', timeout: timeoutMs });
  const p2DecisionTraceVisible = /P2\s*\|\s*F\d+/.test(await p2Decision.innerText());
  if (!p2DecisionTraceVisible) {
    throw new Error('Local sparring replay did not expose the P2 AI decision trace.');
  }
  const fightStory = page.locator('.replay-fight-story');
  await fightStory.waitFor({ state: 'visible', timeout: timeoutMs });
  const fightStoryStatus = await fightStory.getAttribute('data-story-status');
  if (
    fightStoryStatus !== 'maturing'
    && fightStoryStatus !== 'progressing'
    && fightStoryStatus !== 'watch'
    && fightStoryStatus !== 'blocked'
  ) {
    throw new Error(`Local sparring replay has invalid fight-story status: ${String(fightStoryStatus)}`);
  }
  const fightStoryHeadline = (
    await fightStory.locator('.balance-fight-story-header strong').innerText()
  ).trim();
  if (fightStoryHeadline.length === 0) {
    throw new Error('Local sparring replay rendered an empty fight-story headline.');
  }
  const fightStoryFocusStage = await fightStory.getAttribute('data-focus-stage');
  const pausedStoryNodeStable = await page.evaluate(async () => {
    const initialStory = document.querySelector('.replay-fight-story');
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
    return initialStory !== null && initialStory === document.querySelector('.replay-fight-story');
  });
  if (!pausedStoryNodeStable) {
    throw new Error('Paused Replay Review replaced its Fight story across animation frames.');
  }
  await fightStory.scrollIntoViewIfNeeded();
  await captureElementScreenshot(
    page,
    screenshots,
    '.replay-viewer',
    'local-round-review',
    0,
  );
  await page.getByRole('button', { name: 'Exit [Esc]', exact: true }).click();
  await pauseMenu.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByRole('heading', { name: 'Paused', exact: true })
    .waitFor({ state: 'visible', timeout: timeoutMs });
  await captureScreenshot(page, screenshots, 'pause-return-from-review', null);

  await pauseMenu.getByRole('button', { name: 'Resume', exact: true }).click();
  await pauseMenu.waitFor({ state: 'hidden', timeout: timeoutMs });

  await page.keyboard.press('Escape');
  await pauseMenu.waitFor({ state: 'visible', timeout: timeoutMs });
  await captureScreenshot(page, screenshots, 'pause-reopen', null);
  await pauseMenu.getByRole('button', { name: 'Resume', exact: true }).click();
  await pauseMenu.waitFor({ state: 'hidden', timeout: timeoutMs });

  return {
    buttonLabel: reviewButtonLabel,
    balanceLabHiddenInOrdinarySparring: !ordinaryBalanceLabVisible,
    totalFrames,
    sourceLabel,
    p2DecisionTraceVisible,
    fightStoryStatus,
    fightStoryHeadline,
    fightStoryFocusStage,
    pausedStoryNodeStable,
    returnedToPausedMatch: true,
  };
}

async function waitForReplayViewer(page: Page, timeoutMs: number): Promise<number> {
  const viewer = page.locator('.replay-viewer');
  await viewer.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.locator('.replay-viewer-title', { hasText: 'Replay Review' })
    .waitFor({ state: 'visible', timeout: timeoutMs });
  const seek = viewer.locator('input[type="range"]');
  await seek.waitFor({ state: 'visible', timeout: timeoutMs });
  const maximum = Number(await seek.getAttribute('max'));
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new Error(`Replay seek control has invalid maximum ${String(maximum)}.`);
  }
  return maximum + 1;
}

async function seekReplay(page: Page, frame: number, totalFrames: number, timeoutMs: number): Promise<void> {
  const seek = page.locator('.replay-viewer input[type="range"]');
  await seek.fill(String(frame));
  await page.waitForFunction(
    ({ expectedFrame, expectedTotal }) => Array.from(
      document.querySelectorAll<HTMLElement>('.replay-viewer-meta'),
    ).some((element) => element.textContent?.trim() === `Frame: ${expectedFrame + 1} / ${expectedTotal}`),
    { expectedFrame: frame, expectedTotal: totalFrames },
    { timeout: timeoutMs },
  );
  if (await seek.inputValue() !== String(frame)) {
    throw new Error(`Replay seek control did not retain frame ${frame}.`);
  }
  await waitForRenderedFrame(page);
}

function buildSeekFrames(totalFrames: number, requestedFrames?: readonly number[]): number[] {
  const maximum = totalFrames - 1;
  const frames = requestedFrames ?? [
    Math.max(1, Math.floor(maximum * 0.25)),
    Math.max(1, Math.floor(maximum * 0.55)),
    maximum,
  ];
  return Array.from(new Set(frames
    .map((frame) => Math.max(0, Math.min(maximum, Math.floor(frame))))
    .concat(maximum)))
    .sort((left, right) => left - right);
}

async function captureReplaySequence(
  page: Page,
  screenshots: ScreenshotSummary[],
  prefix: string,
  timeoutMs: number,
  markerFrames?: readonly number[],
  captureCanvasFocus = false,
): Promise<number> {
  const totalFrames = await waitForReplayViewer(page, timeoutMs);
  await waitForRenderedFrame(page);
  await captureScreenshot(page, screenshots, `${prefix}-initial`, 0);
  for (const frame of buildSeekFrames(totalFrames, markerFrames)) {
    await seekReplay(page, frame, totalFrames, timeoutMs);
    await captureScreenshot(
      page,
      screenshots,
      `${prefix}-frame-${String(frame).padStart(3, '0')}`,
      frame,
    );
    if (captureCanvasFocus) {
      await captureCanvasFocusedScreenshot(
        page,
        screenshots,
        `${prefix}-canvas-frame-${String(frame).padStart(3, '0')}`,
        frame,
      );
    }
  }
  return totalFrames;
}

async function verifyReplayReentryReview(
  page: Page,
  screenshots: ScreenshotSummary[],
  totalFrames: number,
  timeoutMs: number,
): Promise<void> {
  const review = await page.evaluate(() => {
    const briefExitCards = Array.from(
      document.querySelectorAll<HTMLElement>('.replay-flow-exchange-card.brief_exit'),
    );
    const reentryButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.replay-flow-reentry'),
    );
    const firstCard = briefExitCards[0] ?? null;
    const firstButton = reentryButtons[0] ?? null;
    const context = firstCard
      ?.querySelector<HTMLElement>('.replay-flow-reentry-context')
      ?.innerText
      .trim() ?? '';
    const expectedFrame = Number(firstButton?.dataset.seekFrame);
    firstButton?.scrollIntoView({ block: 'center', inline: 'nearest' });
    firstButton?.click();
    return {
      cardCount: briefExitCards.length,
      buttonCount: reentryButtons.length,
      context,
      expectedFrame,
    };
  });
  if (review.cardCount < 1 || review.buttonCount !== review.cardCount) {
    throw new Error(
      `Replay flow expected one re-entry control per brief exit, received ${review.buttonCount}/${review.cardCount}.`,
    );
  }
  const expectedFrame = review.expectedFrame;
  if (!Number.isInteger(expectedFrame) || expectedFrame < 0 || expectedFrame >= totalFrames) {
    throw new Error(`Replay re-entry control exposed invalid frame ${String(expectedFrame)}.`);
  }
  if (
    !review.context.includes('closing')
    || !review.context.includes('P1 approach + boost active')
    || !review.context.includes('P2 approach + boost active')
  ) {
    throw new Error(`Replay re-entry control omitted its causal movement context: ${review.context}`);
  }
  await page.waitForFunction(
    ({ expected, total }) => Array.from(
      document.querySelectorAll<HTMLElement>('.replay-viewer-meta'),
    ).some((element) => element.textContent?.trim() === `Frame: ${expected + 1} / ${total}`),
    { expected: expectedFrame, total: totalFrames },
    { timeout: timeoutMs },
  );
  await waitForRenderedFrame(page);
  await captureScreenshot(page, screenshots, 'replay-alpha-reentry', expectedFrame);
}

function assertNoBrowserFailures(report: VisualSmokeReport): void {
  const stubFailures = (report.loopbackApiStub?.requests ?? [])
    .filter((request) => request.status >= 400)
    .map((request) => (
      `loopback API stub: ${request.method} ${request.endpoint} returned HTTP ${request.status}`
    ));
  const consoleErrors = report.consoleMessages.filter((message) => message.startsWith('[error]'));
  const failures = [
    ...report.pageErrors.map((message) => `pageerror: ${message}`),
    ...consoleErrors,
    ...report.failedSameOriginRequests.map((message) => `request: ${message}`),
    ...report.blockedExternalRequests.map((message) => `blocked external request: ${message}`),
    ...stubFailures,
  ];
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

function assertLoopbackApiStubCoverage(report: VisualSmokeReport): void {
  if (!report.loopbackApiStub) {
    return;
  }
  const requiredRequests = [
    { method: 'POST', endpoint: '/accounts' },
    { method: 'GET', endpoint: '/profile' },
  ] as const;
  const missing = requiredRequests.filter((required) => !report.loopbackApiStub?.requests.some((request) => (
    request.method === required.method
    && request.endpoint === required.endpoint
    && request.status < 400
  )));
  if (missing.length > 0) {
    throw new Error(
      `Online-enabled production build omitted expected loopback bootstrap requests: ${missing
        .map((request) => `${request.method} ${request.endpoint}`)
        .join(', ')}.`,
    );
  }
}

async function run(): Promise<void> {
  const report: VisualSmokeReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: false,
    localOnly: true,
    hostedServicesContacted: false,
    origin: null,
    viewport: VIEWPORT,
    randomSeed: RANDOM_SEED,
    browserExecutable: null,
    fixtures: [],
    webgl: null,
    presentationFrameTiming: null,
    alphaActionCoverage: null,
    diagnosticsQueryGuard: null,
    assetPreloadReadiness: [],
    loopbackApiStub: null,
    localRoundReview: null,
    balanceSparring: null,
    screenshots: [],
    consoleMessages: [],
    pageErrors: [],
    failedSameOriginRequests: [],
    blockedExternalRequests: [],
  };
  let previewServer: PreviewServer | null = null;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  await mkdir(artifactRoot, { recursive: true });

  try {
    const timeoutMs = parseTimeout();
    const distIndexPath = path.resolve(distRoot, 'index.html');
    const emittedSmokePath = path.resolve(distRoot, 'replays/smoke.replay.json');
    if (!existsSync(distIndexPath)) {
      throw new Error(`Production dist is missing at ${distIndexPath}. Run the game build first.`);
    }
    if (!existsSync(emittedSmokePath)) {
      throw new Error(
        `Production replay fixture is missing at ${emittedSmokePath}. Rebuild so the replay fixture plugin can emit it.`,
      );
    }
    if (!existsSync(smokeFixturePath)) {
      throw new Error(`Source smoke fixture is missing at ${smokeFixturePath}.`);
    }
    if (!existsSync(alphaFixturePath)) {
      throw new Error(`Source alpha visual fixture is missing at ${alphaFixturePath}.`);
    }
    report.alphaActionCoverage = await verifyAlphaActionCoverage(alphaFixturePath);
    const loopbackApiStubConfig = await readLoopbackApiStubConfig();

    const browserExecutable = resolveBrowserExecutable();
    report.browserExecutable = browserExecutable;
    const port = await reserveAvailablePort();
    const origin = `http://${LOOPBACK_HOST}:${port}`;
    assertLoopbackUrl(origin);
    report.origin = origin;

    previewServer = await preview({
      root: appRoot,
      configFile: path.resolve(appRoot, 'vite.config.ts'),
      preview: {
        host: LOOPBACK_HOST,
        port,
        strictPort: true,
        open: false,
      },
      logLevel: 'warn',
    });

    browser = await chromium.launch({
      executablePath: browserExecutable,
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--enable-webgl',
        '--enable-unsafe-swiftshader',
      ],
    });
    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      acceptDownloads: true,
      locale: 'en-GB',
      timezoneId: 'Europe/London',
      serviceWorkers: 'block',
    });
    page = await context.newPage();
    await page.addInitScript((seed: number) => {
      let state = seed >>> 0;
      Math.random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
      };
    }, RANDOM_SEED);

    const allowedOrigin = new URL(origin).origin;
    const loopbackApiStub = loopbackApiStubConfig
      ? createVisualAlphaLoopbackApiStub(loopbackApiStubConfig, allowedOrigin)
      : null;
    if (loopbackApiStubConfig && loopbackApiStub) {
      report.loopbackApiStub = {
        attestationSchemaVersion: LOCAL_RANKED_ROOT_SMOKE_BUILD_SCHEMA_VERSION,
        buildId: loopbackApiStubConfig.buildId,
        apiBaseUrl: loopbackApiStubConfig.apiBaseUrl,
        accountId: VISUAL_ALPHA_STUB_ACCOUNT_ID,
        requests: loopbackApiStub.requests,
      };
    }
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      let parsed: URL;
      try {
        parsed = new URL(requestUrl);
      } catch {
        report.blockedExternalRequests.push(requestUrl);
        await route.abort('blockedbyclient');
        return;
      }
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin !== allowedOrigin) {
        const stubResponse = loopbackApiStub?.resolve({
          method: route.request().method(),
          url: requestUrl,
          headers: route.request().headers(),
          body: route.request().postData(),
        });
        if (stubResponse) {
          await route.fulfill(stubResponse);
          return;
        }
        report.blockedExternalRequests.push(requestUrl);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    page.on('console', (message) => recordConsoleMessage(report.consoleMessages, message));
    page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
    page.on('requestfailed', (request) => {
      const requestUrl = request.url();
      try {
        if (new URL(requestUrl).origin === allowedOrigin) {
          report.failedSameOriginRequests.push(
            `${request.method()} ${requestUrl}: ${request.failure()?.errorText ?? 'unknown failure'}`,
          );
        }
      } catch {
        report.failedSameOriginRequests.push(`${request.method()} ${requestUrl}: invalid URL`);
      }
    });
    page.on('response', (response) => {
      const responseUrl = response.url();
      try {
        if (new URL(responseUrl).origin === allowedOrigin && response.status() >= 400) {
          report.failedSameOriginRequests.push(
            `${response.request().method()} ${responseUrl}: HTTP ${response.status()}`,
          );
        }
      } catch {
        report.failedSameOriginRequests.push(`Response used invalid URL: ${responseUrl}`);
      }
    });
    page.on('websocket', (socket) => {
      const socketUrl = socket.url();
      try {
        const parsed = new URL(socketUrl);
        const expectedHost = new URL(allowedOrigin).host;
        if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') || parsed.host !== expectedHost) {
          report.blockedExternalRequests.push(socketUrl);
        }
      } catch {
        report.blockedExternalRequests.push(socketUrl);
      }
    });

    const diagnosticsGuardUrl = new URL('/?diagnostics=1', origin).toString();
    assertLoopbackUrl(diagnosticsGuardUrl);
    await page.goto(diagnosticsGuardUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.locator('canvas#game').waitFor({ state: 'visible', timeout: timeoutMs });
    report.assetPreloadReadiness.push(await waitForAssetPreload(page, 'diagnostics_guard', timeoutMs));
    const overlayElements = await page.locator('.online-diagnostics-overlay').count();
    const launcherElements = await page.locator('.online-diagnostics-launcher').count();
    report.diagnosticsQueryGuard = {
      attemptedOverride: '1',
      overlayElements,
      launcherElements,
      blocked: overlayElements === 0 && launcherElements === 0,
    };
    if (!report.diagnosticsQueryGuard.blocked) {
      throw new Error('Production diagnostics were enabled by the diagnostics=1 query override.');
    }

    const targetUrl = new URL('/', origin).toString();
    assertLoopbackUrl(targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.locator('canvas#game').waitFor({ state: 'visible', timeout: timeoutMs });
    report.assetPreloadReadiness.push(await waitForAssetPreload(page, 'home', timeoutMs));
    await page.getByRole('heading', { name: 'Gravity Well', exact: true })
      .waitFor({ state: 'visible', timeout: timeoutMs });
    report.webgl = await verifyWebGl(page);
    report.fixtures.push(await verifyFixtureResponse(page, origin, 'smoke.replay.json'));
    report.fixtures.push(await verifyFixtureResponse(page, origin, 'alpha-visual.replay.json'));
    await waitForRenderedFrame(page);
    await captureScreenshot(page, report.screenshots, 'home', null);

    await openReplayMenu(page, timeoutMs);
    await page.getByRole('button', { name: 'Replay Review (Smoke Fixture)', exact: true }).click();
    const smokeFrames = await captureReplaySequence(
      page,
      report.screenshots,
      'replay-smoke',
      timeoutMs,
    );
    const emittedSmoke = report.fixtures.find((fixture) => fixture.fileName === 'smoke.replay.json');
    if (emittedSmoke?.frames !== smokeFrames) {
      throw new Error(
        `Bundled smoke replay rendered ${smokeFrames} frames but its emitted JSON contains ${emittedSmoke?.frames ?? 0}.`,
      );
    }

    await page.getByRole('button', { name: 'Exit [Esc]', exact: true }).click();
    await openReplayMenu(page, timeoutMs);
    const localReplayInput = page.locator('input[type="file"][accept*="json"]');
    if (await localReplayInput.count() !== 1) {
      throw new Error('Replay menu is missing its unique local JSON file input.');
    }
    await localReplayInput.setInputFiles(alphaFixturePath);
    const alphaFrames = await captureReplaySequence(
      page,
      report.screenshots,
      'replay-alpha',
      timeoutMs,
      ALPHA_ACTION_MARKER_FRAMES,
      true,
    );
    const emittedAlpha = report.fixtures.find((fixture) => fixture.fileName === 'alpha-visual.replay.json');
    if (emittedAlpha?.frames !== alphaFrames) {
      throw new Error(
        `Local alpha replay rendered ${alphaFrames} frames but its emitted JSON contains ${emittedAlpha?.frames ?? 0}.`,
      );
    }
    await verifyReplayReentryReview(
      page,
      report.screenshots,
      alphaFrames,
      timeoutMs,
    );

    await page.getByRole('button', { name: 'Exit [Esc]', exact: true }).click();
    await openLocalMatch(page, timeoutMs);
    report.presentationFrameTiming = await measurePresentationFrameTiming(page);
    report.localRoundReview = await verifyLazyPauseMenu(page, report.screenshots, timeoutMs);

    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.locator('canvas#game').waitFor({ state: 'visible', timeout: timeoutMs });
    report.assetPreloadReadiness.push(await waitForAssetPreload(page, 'balance_return', timeoutMs));
    report.balanceSparring = await verifyBalanceSparring(page, report.screenshots, timeoutMs);

    await page.waitForLoadState('networkidle', { timeout: timeoutMs });
    assertLoopbackApiStubCoverage(report);
    assertNoBrowserFailures(report);
    report.ok = true;
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    if (page) {
      try {
        await captureScreenshot(page, report.screenshots, 'failure', null);
      } catch {
        // Preserve the original gate failure when screenshot capture is unavailable.
      }
    }
    await writeReport(report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await previewServer?.close().catch(() => undefined);
  }
}

void run();
