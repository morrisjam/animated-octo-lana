import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from 'playwright-core';
import { assertSafeSmokeTarget } from '../../api/scripts/smokeTargetGuard';
import {
  LOCAL_RANKED_ROOT_SMOKE_INBOUND_DELAY_POLLS,
  LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION,
  resolveLocalRankedRootSmokeConfig,
  type LocalRankedRootSmokeSnapshot,
} from '../src/dev/localRankedRootSmoke';

const DEFAULT_ROOT_URL = 'http://127.0.0.1:5190/';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_REPORT_PATH = resolve('build-artifacts/ranked-root-browser-smoke.json');
const BROWSER_INSPECTION_TIMEOUT_MS = 10_000;

interface BrowserClient {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  consoleMessages: string[];
  pageErrors: string[];
}

interface RankedRootBrowserSmokeReport {
  schemaVersion: 'gw.ranked-root-browser-smoke.v4';
  ok: boolean;
  generatedAt: string;
  rootUrl: string;
  apiBaseUrl: string;
  forceRelayRequested: boolean;
  isolatedBrowserProcesses: boolean;
  browserProcessCount: number;
  sessionId?: string;
  accountIds?: string[];
  sides?: string[];
  connectionPaths?: string[];
  proofDigest?: string;
  proofRoundCount?: number;
  proofFrameCount?: number;
  replayId?: string;
  replayDigest?: string;
  rollbackApplications?: number[];
  rollbackFrames?: number[];
  maxRollbackDepths?: number[];
  inboundDelayPolls?: number[];
  recovery?: RankedRootRecoveryEvidence;
  ratingDeltas?: Array<{
    accountId: string;
    preRating: number;
    postRating: number;
    ratingDelta: number;
    result: string;
  }>;
  clients?: LocalRankedRootSmokeSnapshot[];
  consoleMessages?: string[][];
  pageErrors?: string[][];
  browserExecutable?: string;
  error?: string;
  failureScreenshots?: string[];
}

interface RankedRootRecoveryEvidence {
  triggerRoundEpoch: number;
  triggerSimulationFrames: number[];
  triggerOutboundFrames: number[];
  triggerMutuallyConfirmedThrough: number[];
  checkpointConfirmedThrough: number[];
  agreedThrough: number[];
  previousAttemptGeneration: number;
  recoveredAttemptGeneration: number;
  connectionPathsBefore: string[];
  connectionPathsAfter: string[];
  relayAvailableBefore: boolean[];
  relayAvailableAfter: boolean[];
  tailDrained: boolean[];
  tailDrainedRoundEpoch: number[];
  conflictingInputs: number[];
  tooLateInputs: number[];
}

function parseBooleanFlag(name: string, value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === '0' || normalized === 'false') {
    return false;
  }
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  throw new Error(`${name} must be 1, 0, true, or false.`);
}

function parseTimeout(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(parsed) || parsed < 30_000 || parsed > 15 * 60_000) {
    throw new Error('RANKED_ROOT_BROWSER_SMOKE_TIMEOUT_MS must be 30000 to 900000.');
  }
  return parsed;
}

function localBrowserCandidates(): string[] {
  if (process.platform === 'win32') {
    return [
      process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env['PROGRAMFILES(X86)']
        && `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ].filter((entry): entry is string => Boolean(entry));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
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
  const detected = localBrowserCandidates().find((candidate) => existsSync(candidate));
  if (!detected) {
    throw new Error(
      'Google Chrome, Microsoft Edge, or Chromium is required. Set BROWSER_EXECUTABLE_PATH when it is installed outside a standard location.',
    );
  }
  return detected;
}

function recordConsoleMessage(messages: string[], message: ConsoleMessage): void {
  const location = message.location();
  const source = location.url ? ` (${location.url}:${location.lineNumber + 1})` : '';
  messages.push(`[${message.type()}] ${message.text()}${source}`);
}

function writeJsonReport(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isExpectedTerminalHeartbeatConflict(
  entry: string,
  snapshot: LocalRankedRootSmokeSnapshot,
): boolean {
  return entry.startsWith('[error]')
    && entry.includes('409 (Conflict)')
    && entry.includes('/matchmaking/sessions/heartbeat')
    && snapshot.phase === 'match_over'
    && snapshot.session?.status === 'resolved'
    && snapshot.session.resolvedReason === 'completed'
    && snapshot.match?.result.status === 'accepted';
}

async function createBrowserClient(
  executablePath: string,
  rootUrl: string,
  timeoutMs: number,
): Promise<BrowserClient> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => recordConsoleMessage(consoleMessages, message));
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    await page.goto(rootUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForFunction(
      () => Boolean(window.__gravityWellLocalRankedRootSmoke),
      undefined,
      { timeout: Math.min(timeoutMs, 15_000) },
    );
    return { browser, context, page, consoleMessages, pageErrors };
  } catch (error) {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    throw error;
  }
}

async function readSnapshot(page: Page): Promise<LocalRankedRootSmokeSnapshot> {
  const snapshotPromise = page.evaluate(() => {
    const bridge = window.__gravityWellLocalRankedRootSmoke;
    if (!bridge) {
      throw new Error('Local ranked root smoke bridge is unavailable.');
    }
    return bridge.getSnapshot();
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Root smoke snapshot read timed out after ${BROWSER_INSPECTION_TIMEOUT_MS}ms.`));
    }, BROWSER_INSPECTION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([snapshotPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function invokeBridge(
  page: Page,
  action:
    | 'joinRankedQueue'
    | 'refreshRankedQueue'
    | 'armMidRoundRecovery'
    | 'triggerMidRoundRecovery'
    | 'refreshPersistedState',
): Promise<void> {
  await page.evaluate(async (requestedAction) => {
    const bridge = window.__gravityWellLocalRankedRootSmoke;
    if (!bridge) {
      throw new Error('Local ranked root smoke bridge is unavailable.');
    }
    await bridge[requestedAction]();
  }, action);
}

async function waitForSnapshots(
  clients: BrowserClient[],
  description: string,
  timeoutMs: number,
  predicate: (snapshots: LocalRankedRootSmokeSnapshot[]) => boolean,
): Promise<LocalRankedRootSmokeSnapshot[]> {
  const deadline = Date.now() + timeoutMs;
  let latest: LocalRankedRootSmokeSnapshot[] = [];
  while (Date.now() < deadline) {
    latest = await Promise.all(clients.map((client) => readSnapshot(client.page)));
    const bootstrapFailure = latest.find((snapshot) => snapshot.bootstrap?.status === 'failed');
    if (bootstrapFailure?.bootstrap) {
      throw new Error(`Root bootstrap failed: ${bootstrapFailure.bootstrap.detail}`);
    }
    const matchFailure = latest.find((snapshot) => snapshot.match?.result.status === 'failed');
    if (matchFailure?.match) {
      throw new Error(`Ranked result failed: ${matchFailure.match.result.detail}`);
    }
    const replayFailure = latest.find((snapshot) => snapshot.match?.replay.status === 'failed');
    if (replayFailure?.match) {
      throw new Error(`Canonical replay failed: ${replayFailure.match.replay.detail}`);
    }
    const recoveryFailure = latest.find((snapshot) => snapshot.match?.recovery?.phase === 'failed');
    if (recoveryFailure?.match?.recovery) {
      throw new Error(`WebRTC recovery failed: ${recoveryFailure.match.recovery.detail}`);
    }
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${description} timed out after ${timeoutMs}ms. Last snapshots: ${JSON.stringify(latest)}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requireRecovery(
  snapshot: LocalRankedRootSmokeSnapshot,
  index: number,
): NonNullable<NonNullable<LocalRankedRootSmokeSnapshot['match']>['recovery']> {
  invariant(snapshot.match, `Client ${index + 1} has no live match recovery state.`);
  invariant(snapshot.match.recovery, `Client ${index + 1} has no recovery smoke diagnostics.`);
  return snapshot.match.recovery;
}

function validateRecoveryReadySnapshots(
  snapshots: LocalRankedRootSmokeSnapshot[],
  forceRelay: boolean,
): void {
  invariant(snapshots.length === 2, 'Recovery smoke requires exactly two root clients.');
  const roundEpochs: number[] = [];
  const attemptGenerations: number[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const match = snapshot.match;
    const recovery = requireRecovery(snapshot, index);
    invariant(snapshot.phase === 'playing' && match, `Client ${index + 1} left live play before recovery.`);
    invariant(recovery.phase === 'ready', `Client ${index + 1} did not hold the pre-flush recovery boundary.`);
    invariant(recovery.triggerRoundEpoch !== null, `Client ${index + 1} has no recovery trigger epoch.`);
    invariant(recovery.triggerSimulationFrame !== null, `Client ${index + 1} has no recovery trigger frame.`);
    invariant(
      recovery.triggerMutuallyConfirmedThrough !== null,
      `Client ${index + 1} has no mutually confirmed recovery cursor.`,
    );
    invariant(recovery.triggerOutboundFrames > 0, `Client ${index + 1} captured an empty outbound tail.`);
    invariant(match.inputPump.outboundFrames > 0, `Client ${index + 1} flushed its outbound tail before recovery.`);
    invariant(
      recovery.triggerMutuallyConfirmedThrough < recovery.triggerSimulationFrame,
      `Client ${index + 1} had no speculative frames at the recovery boundary.`,
    );
    invariant(
      recovery.triggerAttemptGeneration === recovery.initialAttemptGeneration
      && match.transportAttemptGeneration === recovery.initialAttemptGeneration,
      `Client ${index + 1} changed generation before replacement.`,
    );
    invariant(
      match.roundEpoch === recovery.triggerRoundEpoch,
      `Client ${index + 1} changed round epoch before replacement.`,
    );
    if (forceRelay) {
      invariant(
        recovery.connectionPathBefore === 'relay' && recovery.relayAvailableBefore === true,
        `Client ${index + 1} did not enter recovery on the forced relay path.`,
      );
    }
    roundEpochs.push(recovery.triggerRoundEpoch);
    attemptGenerations.push(recovery.initialAttemptGeneration);
  }
  invariant(new Set(roundEpochs).size === 1, 'Root clients did not pause in the same round epoch.');
  invariant(new Set(attemptGenerations).size === 1, 'Root clients started from different transport generations.');
}

function validateRecoveredSnapshots(
  snapshots: LocalRankedRootSmokeSnapshot[],
  forceRelay: boolean,
): void {
  invariant(snapshots.length === 2, 'Recovery validation requires exactly two root clients.');
  const recoveredGenerations: number[] = [];
  const recoveredEpochs: number[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const match = snapshot.match;
    const recovery = requireRecovery(snapshot, index);
    invariant(match, `Client ${index + 1} lost its match state after recovery.`);
    invariant(recovery.phase === 'recovered', `Client ${index + 1} did not complete WebRTC replacement.`);
    invariant(recovery.recoveryCount === 1, `Client ${index + 1} completed ${recovery.recoveryCount} recoveries.`);
    invariant(
      recovery.recoveredAttemptGeneration === recovery.initialAttemptGeneration + 1
      && match.transportAttemptGeneration === recovery.recoveredAttemptGeneration,
      `Client ${index + 1} did not advance exactly one transport generation.`,
    );
    invariant(
      recovery.triggerRoundEpoch !== null
      && recovery.checkpointRoundEpoch === recovery.triggerRoundEpoch
      && recovery.recoveredRoundEpoch === recovery.triggerRoundEpoch,
      `Client ${index + 1} changed round epoch during replacement.`,
    );
    invariant(
      recovery.triggerSimulationFrame !== null
      && recovery.triggerMutuallyConfirmedThrough !== null
      && recovery.triggerOutboundFrames > 0
      && recovery.triggerMutuallyConfirmedThrough < recovery.triggerSimulationFrame
      && recovery.checkpointConfirmedThrough !== null
      && recovery.checkpointConfirmedThrough < recovery.triggerSimulationFrame,
      `Client ${index + 1} did not retain a speculative tail outside its checkpoint.`,
    );
    invariant(
      recovery.agreedThrough !== null
      && recovery.agreedThrough <= recovery.checkpointConfirmedThrough,
      `Client ${index + 1} recovery agreement exceeded its checkpoint.`,
    );
    invariant(
      (recovery.connectionPathBefore === 'direct' || recovery.connectionPathBefore === 'relay')
      && (recovery.connectionPathAfter === 'direct' || recovery.connectionPathAfter === 'relay')
      && recovery.relayAvailableBefore !== null
      && recovery.relayAvailableAfter !== null,
      `Client ${index + 1} has incomplete replacement path evidence.`,
    );
    if (forceRelay) {
      invariant(
        recovery.connectionPathAfter === 'relay'
        && recovery.relayAvailableAfter === true
        && recovery.iceTransportPolicyAfter === 'relay',
        `Client ${index + 1} did not retain forced relay through replacement.`,
      );
    }
    recoveredGenerations.push(recovery.recoveredAttemptGeneration);
    recoveredEpochs.push(recovery.recoveredRoundEpoch);
  }
  invariant(new Set(recoveredGenerations).size === 1, 'Root clients recovered on different generations.');
  invariant(new Set(recoveredEpochs).size === 1, 'Root clients recovered in different round epochs.');
}

function buildFinalRecoveryEvidence(
  snapshots: LocalRankedRootSmokeSnapshot[],
  forceRelay: boolean,
): RankedRootRecoveryEvidence {
  validateRecoveredSnapshots(snapshots, forceRelay);
  const recoveries = snapshots.map((snapshot, index) => requireRecovery(snapshot, index));
  for (const [index, recovery] of recoveries.entries()) {
    invariant(
      recovery.tailDrained
      && recovery.tailDrainedRoundEpoch === recovery.triggerRoundEpoch,
      `Client ${index + 1} did not drain its retained tail in the recovery round epoch.`,
    );
    invariant(
      recovery.conflictingInputs === 0 && recovery.tooLateInputs === 0,
      `Client ${index + 1} applied conflicting or too-late inputs after recovery.`,
    );
  }
  const triggerRoundEpoch = recoveries[0].triggerRoundEpoch;
  const previousAttemptGeneration = recoveries[0].initialAttemptGeneration;
  const recoveredAttemptGeneration = recoveries[0].recoveredAttemptGeneration;
  invariant(triggerRoundEpoch !== null, 'Final recovery evidence has no trigger round epoch.');
  invariant(recoveredAttemptGeneration !== null, 'Final recovery evidence has no recovered generation.');
  invariant(
    recoveries.every((recovery) => (
      recovery.triggerRoundEpoch === triggerRoundEpoch
      && recovery.initialAttemptGeneration === previousAttemptGeneration
      && recovery.recoveredAttemptGeneration === recoveredAttemptGeneration
    )),
    'Final peer recovery evidence does not describe one shared replacement.',
  );

  return {
    triggerRoundEpoch,
    triggerSimulationFrames: recoveries.map((recovery) => recovery.triggerSimulationFrame as number),
    triggerOutboundFrames: recoveries.map((recovery) => recovery.triggerOutboundFrames),
    triggerMutuallyConfirmedThrough: recoveries.map(
      (recovery) => recovery.triggerMutuallyConfirmedThrough as number,
    ),
    checkpointConfirmedThrough: recoveries.map(
      (recovery) => recovery.checkpointConfirmedThrough as number,
    ),
    agreedThrough: recoveries.map((recovery) => recovery.agreedThrough as number),
    previousAttemptGeneration,
    recoveredAttemptGeneration,
    connectionPathsBefore: recoveries.map((recovery) => recovery.connectionPathBefore as string),
    connectionPathsAfter: recoveries.map((recovery) => recovery.connectionPathAfter as string),
    relayAvailableBefore: recoveries.map((recovery) => recovery.relayAvailableBefore as boolean),
    relayAvailableAfter: recoveries.map((recovery) => recovery.relayAvailableAfter as boolean),
    tailDrained: recoveries.map((recovery) => recovery.tailDrained),
    tailDrainedRoundEpoch: recoveries.map((recovery) => recovery.tailDrainedRoundEpoch as number),
    conflictingInputs: recoveries.map((recovery) => recovery.conflictingInputs),
    tooLateInputs: recoveries.map((recovery) => recovery.tooLateInputs),
  };
}

function validateFinalSnapshots(
  snapshots: LocalRankedRootSmokeSnapshot[],
  forceRelay: boolean,
): {
  sessionId: string;
  accountIds: string[];
  sides: string[];
  connectionPaths: string[];
  proofDigest: string;
  proofRoundCount: number;
  proofFrameCount: number;
  replayId: string;
  replayDigest: string;
  rollbackApplications: number[];
  rollbackFrames: number[];
  maxRollbackDepths: number[];
  inboundDelayPolls: number[];
  recovery: RankedRootRecoveryEvidence;
  ratingDeltas: RankedRootBrowserSmokeReport['ratingDeltas'];
} {
  invariant(snapshots.length === 2, 'Ranked root smoke requires exactly two client snapshots.');
  const recovery = buildFinalRecoveryEvidence(snapshots, forceRelay);
  for (const [index, snapshot] of snapshots.entries()) {
    invariant(
      snapshot.schemaVersion === LOCAL_RANKED_ROOT_SMOKE_SCHEMA_VERSION,
      `Client ${index + 1} returned an unsupported root bridge schema.`,
    );
    invariant(snapshot.rootPath === '/', `Client ${index + 1} did not execute through /.`);
    invariant(
      snapshot.releaseProfile.environment === 'production'
      && snapshot.releaseProfile.onlineEnabled
      && snapshot.releaseProfile.rankedEnabled
      && snapshot.releaseProfile.onlineMatchRuntimeEnabled
      && !snapshot.releaseProfile.debugToolsEnabled,
      `Client ${index + 1} did not run the production release feature profile.`,
    );
    invariant(snapshot.releaseProfile.buildId.length > 0, `Client ${index + 1} has no release build id.`);
    invariant(snapshot.forceRelayRequested === forceRelay, `Client ${index + 1} relay intent changed.`);
    invariant(snapshot.account.accountId, `Client ${index + 1} has no signed account id.`);
    invariant(snapshot.account.signedAccessToken, `Client ${index + 1} has no signed bearer session.`);
    invariant(snapshot.ticket?.status === 'matched', `Client ${index + 1} did not retain a matched ticket.`);
    invariant(snapshot.phase === 'match_over', `Client ${index + 1} did not reach match_over.`);
    invariant(snapshot.match, `Client ${index + 1} has no composed online match state.`);
    invariant(snapshot.session?.status === 'resolved', `Client ${index + 1} did not read back a resolved session.`);
    invariant(
      snapshot.session.resolvedReason === 'completed',
      `Client ${index + 1} session resolved for ${snapshot.session.resolvedReason ?? 'no reason'}.`,
    );
    invariant(snapshot.match.proof, `Client ${index + 1} did not build a ranked proof.`);
    invariant(snapshot.match.result.status === 'accepted', `Client ${index + 1} result was not accepted.`);
    invariant(snapshot.match.result.persistedRead, `Client ${index + 1} did not read the persisted result.`);
    invariant(
      snapshot.match.result.settlementSource === 'player_consensus',
      `Client ${index + 1} result was not proof-consensus settlement.`,
    );
    invariant(snapshot.match.result.proofDigest, `Client ${index + 1} has no persisted proof digest.`);
    invariant(snapshot.match.replay.status === 'persisted', `Client ${index + 1} replay was not persisted.`);
    invariant(snapshot.match.replay.replayId, `Client ${index + 1} has no persisted replay id.`);
    invariant(snapshot.match.replay.digest, `Client ${index + 1} has no canonical replay digest.`);
    invariant(
      snapshot.match.replay.roundCount === snapshot.match.proof.roundCount
      && snapshot.match.replay.frameCount === snapshot.match.proof.frameCount,
      `Client ${index + 1} replay dimensions do not match its ranked proof.`,
    );
    invariant(snapshot.match.rollback.applications > 0, `Client ${index + 1} observed no live rollback.`);
    invariant(snapshot.match.rollback.totalFrames > 0, `Client ${index + 1} has no rollback frame evidence.`);
    invariant(snapshot.match.rollback.maxDepth > 0, `Client ${index + 1} has no rollback depth evidence.`);
    invariant(snapshot.match.smokeTransport, `Client ${index + 1} has no local smoke transport evidence.`);
    invariant(
      snapshot.match.smokeTransport.inboundDelayPolls === LOCAL_RANKED_ROOT_SMOKE_INBOUND_DELAY_POLLS,
      `Client ${index + 1} did not use the required deterministic inbound delay.`,
    );
    invariant(
      snapshot.match.smokeTransport.pollCount > snapshot.match.smokeTransport.inboundDelayPolls
      && snapshot.match.smokeTransport.releasedFrames > 0
      && snapshot.match.smokeTransport.maxBufferedFrames > 0,
      `Client ${index + 1} did not exercise delayed inbound frame release.`,
    );
    invariant(
      snapshot.match.smokeTransport.bufferedFrames === 0,
      `Client ${index + 1} retained delayed inbound frames after settlement.`,
    );
    invariant(snapshot.match.inputPump.outboundFrames === 0, `Client ${index + 1} retained outbound frames.`);
    invariant(
      snapshot.match.inputPump.uploadFailures === 0
      && snapshot.match.inputPump.pollFailures === 0
      && snapshot.match.inputPump.confirmationFailures === 0,
      `Client ${index + 1} recorded gameplay transport failures.`,
    );
    invariant(snapshot.match.driver?.shadowWinner, `Client ${index + 1} input driver did not reach a winner.`);
    invariant(
      snapshot.match.driver.rollbackProbeFramesGenerated === 1,
      `Client ${index + 1} did not generate the symmetric rollback probe.`,
    );
    invariant(snapshot.progression?.rating !== null, `Client ${index + 1} has no persisted rating snapshot.`);

    const expectedPath = forceRelay ? 'relay' : 'direct';
    const expectedPolicy = forceRelay ? 'relay' : 'all';
    invariant(
      snapshot.match.connectionPath === expectedPath,
      `Client ${index + 1} used ${snapshot.match.connectionPath}; expected ${expectedPath}.`,
    );
    invariant(
      snapshot.match.iceTransportPolicy === expectedPolicy,
      `Client ${index + 1} used ICE policy ${snapshot.match.iceTransportPolicy}; expected ${expectedPolicy}.`,
    );
    invariant(snapshot.match.relayAvailable, `Client ${index + 1} had no release-required relay fallback.`);
    invariant(
      snapshot.match.turnCredentialMode === 'time_limited',
      `Client ${index + 1} did not receive time-limited TURN credentials.`,
    );
  }

  const first = snapshots[0];
  const second = snapshots[1];
  const firstMatch = first.match;
  const secondMatch = second.match;
  invariant(firstMatch && secondMatch, 'Both client match snapshots are required.');
  const accountIds = [first.account.accountId, second.account.accountId] as string[];
  invariant(new Set(accountIds).size === 2, 'Root clients did not create distinct signed accounts.');
  invariant(firstMatch.sessionId === secondMatch.sessionId, 'Root clients did not share one session.');
  invariant(first.ticket?.sessionId === firstMatch.sessionId, 'First ticket did not hand off to its match.');
  invariant(second.ticket?.sessionId === firstMatch.sessionId, 'Second ticket did not hand off to its match.');
  invariant(
    firstMatch.remoteAccountId === secondMatch.localAccountId
    && secondMatch.remoteAccountId === firstMatch.localAccountId,
    'Root match handoff did not preserve peer account identity.',
  );
  const sides = [firstMatch.localPlayerId, secondMatch.localPlayerId];
  invariant(JSON.stringify([...sides].sort()) === JSON.stringify(['P1', 'P2']), 'Root clients did not receive opposite sides.');
  invariant(
    firstMatch.p1RoundWins === secondMatch.p1RoundWins
    && firstMatch.p2RoundWins === secondMatch.p2RoundWins,
    'Root clients did not converge on the same match score.',
  );
  invariant(
    Math.max(firstMatch.p1RoundWins, firstMatch.p2RoundWins) === 2,
    'Root match did not complete a best-of-three result.',
  );
  invariant(firstMatch.finalOutcome === secondMatch.finalOutcome, 'Root clients disagree on final outcome.');
  invariant(firstMatch.winnerAccountId === secondMatch.winnerAccountId, 'Root clients disagree on winner account.');
  invariant(firstMatch.proof && secondMatch.proof, 'Both root clients must retain proof summaries.');
  invariant(
    JSON.stringify(firstMatch.proof) === JSON.stringify(secondMatch.proof),
    'Root clients built different proof summaries.',
  );
  invariant(
    firstMatch.result.proofDigest === secondMatch.result.proofDigest,
    'Persisted peer proof digests did not match.',
  );
  invariant(firstMatch.replay.replayId === secondMatch.replay.replayId, 'Peers did not resolve one replay archive row.');
  invariant(firstMatch.replay.digest === secondMatch.replay.digest, 'Canonical peer replay digests did not match.');
  invariant(
    firstMatch.result.proofRoundCount === firstMatch.proof.roundCount
    && firstMatch.result.proofFrameCount === firstMatch.proof.frameCount,
    'Persisted proof dimensions do not match the root-recorded proof.',
  );
  invariant(
    secondMatch.result.proofRoundCount === secondMatch.proof.roundCount
    && secondMatch.result.proofFrameCount === secondMatch.proof.frameCount,
    'Second persisted proof dimensions do not match the root-recorded proof.',
  );
  invariant(
    firstMatch.proof.claimedOutcome === firstMatch.finalOutcome,
    'Root proof outcome does not match the completed game.',
  );

  const ratingDeltas = snapshots.map((snapshot, index) => {
    const match = snapshot.match as NonNullable<LocalRankedRootSmokeSnapshot['match']>;
    const accountId = snapshot.account.accountId as string;
    const delta = match.result.ratingDeltas.find((entry) => entry.accountId === accountId);
    invariant(delta, `Client ${index + 1} persisted result has no local rating delta.`);
    invariant(
      delta.postRating - delta.preRating === delta.ratingDelta,
      `Client ${index + 1} rating delta arithmetic is inconsistent.`,
    );
    invariant(delta.ratingDelta !== 0, `Client ${index + 1} rating did not change.`);
    invariant(
      snapshot.progression?.rating === delta.postRating,
      `Client ${index + 1} progression rating did not persist the accepted delta.`,
    );
    const recent = snapshot.progression?.recentDeltas[0];
    invariant(
      recent?.preRating === delta.preRating && recent.postRating === delta.postRating,
      `Client ${index + 1} progression history did not read back the accepted delta.`,
    );
    return {
      accountId,
      preRating: delta.preRating,
      postRating: delta.postRating,
      ratingDelta: delta.ratingDelta,
      result: delta.result,
    };
  });

  return {
    sessionId: firstMatch.sessionId,
    accountIds,
    sides,
    connectionPaths: [firstMatch.connectionPath, secondMatch.connectionPath],
    proofDigest: firstMatch.result.proofDigest as string,
    proofRoundCount: firstMatch.proof.roundCount,
    proofFrameCount: firstMatch.proof.frameCount,
    replayId: firstMatch.replay.replayId as string,
    replayDigest: firstMatch.replay.digest as string,
    rollbackApplications: [
      firstMatch.rollback.applications,
      secondMatch.rollback.applications,
    ],
    rollbackFrames: [
      firstMatch.rollback.totalFrames,
      secondMatch.rollback.totalFrames,
    ],
    maxRollbackDepths: [
      firstMatch.rollback.maxDepth,
      secondMatch.rollback.maxDepth,
    ],
    inboundDelayPolls: [
      firstMatch.smokeTransport?.inboundDelayPolls ?? 0,
      secondMatch.smokeTransport?.inboundDelayPolls ?? 0,
    ],
    recovery,
    ratingDeltas,
  };
}

async function captureFailureScreenshots(
  clients: BrowserClient[],
  basePath: string,
): Promise<string[]> {
  if (clients.length === 0) {
    return [];
  }
  const extensionIndex = basePath.toLowerCase().lastIndexOf('.png');
  const prefix = extensionIndex >= 0 ? basePath.slice(0, extensionIndex) : basePath;
  const paths = clients.map((_, index) => `${prefix}-client-${index + 1}.png`);
  mkdirSync(dirname(paths[0]), { recursive: true });
  await Promise.all(clients.map((client, index) => (
    client.page.screenshot({
      path: paths[index],
      fullPage: true,
      timeout: BROWSER_INSPECTION_TIMEOUT_MS,
    }).catch(() => undefined)
  )));
  return paths;
}

async function run(): Promise<void> {
  const apiBaseUrl = String(process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
  const forceRelay = parseBooleanFlag(
    'RANKED_ROOT_BROWSER_SMOKE_FORCE_RELAY',
    process.env.RANKED_ROOT_BROWSER_SMOKE_FORCE_RELAY,
  );
  const timeoutMs = parseTimeout(process.env.RANKED_ROOT_BROWSER_SMOKE_TIMEOUT_MS);
  const executablePath = resolveBrowserExecutable();
  const outputPath = resolve(
    process.env.RANKED_ROOT_BROWSER_SMOKE_REPORT_PATH ?? DEFAULT_REPORT_PATH,
  );
  const screenshotPath = resolve(
    process.env.RANKED_ROOT_BROWSER_SMOKE_FAILURE_SCREENSHOT
      ?? 'build-artifacts/ranked-root-browser-smoke-failure.png',
  );
  const rootUrl = new URL(process.env.RANKED_ROOT_SMOKE_URL ?? DEFAULT_ROOT_URL);
  rootUrl.pathname = '/';
  rootUrl.search = '';
  rootUrl.searchParams.set('rankedRootSmoke', '1');
  if (forceRelay) {
    rootUrl.searchParams.set('forceRelay', '1');
  }
  const smokeConfig = resolveLocalRankedRootSmokeConfig({
    buildEnabled: true,
    url: rootUrl.toString(),
  });
  invariant(smokeConfig.enabled, 'Ranked root browser smoke did not resolve its loopback root gate.');
  const clients: BrowserClient[] = [];

  try {
    await assertSafeSmokeTarget(apiBaseUrl, 'Ranked root browser smoke');
    const createdClients = await Promise.all([
      createBrowserClient(executablePath, rootUrl.toString(), timeoutMs),
      createBrowserClient(executablePath, rootUrl.toString(), timeoutMs),
    ]);
    clients.push(...createdClients);

    await waitForSnapshots(
      clients,
      'signed root sessions',
      Math.min(timeoutMs, 30_000),
      (snapshots) => snapshots.every((snapshot) => (
        Boolean(snapshot.account.accountId) && snapshot.account.signedAccessToken
      )),
    );

    await invokeBridge(clients[0].page, 'joinRankedQueue');
    await invokeBridge(clients[1].page, 'joinRankedQueue');
    await Promise.all(clients.map((client) => invokeBridge(client.page, 'refreshRankedQueue')));

    await waitForSnapshots(
      clients,
      'live root WebRTC match',
      timeoutMs,
      (snapshots) => snapshots.every((snapshot) => (
        snapshot.phase === 'playing' && Boolean(snapshot.match)
      )),
    );
    await Promise.all(clients.map((client) => invokeBridge(client.page, 'armMidRoundRecovery')));
    const recoveryReadySnapshots = await waitForSnapshots(
      clients,
      'speculative pre-flush recovery boundary',
      Math.min(timeoutMs, 30_000),
      (snapshots) => snapshots.every((snapshot) => (
        snapshot.phase === 'playing'
        && snapshot.match?.recovery?.phase === 'ready'
      )),
    );
    validateRecoveryReadySnapshots(recoveryReadySnapshots, forceRelay);

    await Promise.all(clients.map((client) => invokeBridge(client.page, 'triggerMidRoundRecovery')));
    const recoveredSnapshots = await waitForSnapshots(
      clients,
      'same-round WebRTC replacement',
      timeoutMs,
      (snapshots) => snapshots.every((snapshot) => (
        snapshot.match?.recovery?.phase === 'recovered'
      )),
    );
    validateRecoveredSnapshots(recoveredSnapshots, forceRelay);

    await waitForSnapshots(
      clients,
      'proof-backed ranked settlement',
      timeoutMs,
      (snapshots) => snapshots.every((snapshot) => (
        snapshot.phase === 'match_over'
        && snapshot.match?.result.status === 'accepted'
        && Boolean(snapshot.match.proof)
      )),
    );

    await Promise.all(clients.map((client) => invokeBridge(client.page, 'refreshPersistedState')));
    const finalSnapshots = await waitForSnapshots(
      clients,
      'persisted ranked readback',
      Math.min(timeoutMs, 30_000),
      (snapshots) => snapshots.every((snapshot) => (
        snapshot.match?.result.persistedRead === true
        && snapshot.match.replay.status === 'persisted'
        && snapshot.session?.status === 'resolved'
        && snapshot.progression?.rating !== null
      )),
    );
    const evidence = validateFinalSnapshots(finalSnapshots, forceRelay);
    const unexpectedConsoleErrors = clients.flatMap((client, clientIndex) => (
      client.consoleMessages
        .filter((entry) => (
          entry.startsWith('[error]')
          && !isExpectedTerminalHeartbeatConflict(entry, finalSnapshots[clientIndex])
        ))
        .map((entry) => `client ${clientIndex + 1}: ${entry}`)
    ));
    const pageErrors = clients.flatMap((client, clientIndex) => (
      client.pageErrors.map((entry) => `client ${clientIndex + 1}: ${entry}`)
    ));
    if (unexpectedConsoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error([...pageErrors, ...unexpectedConsoleErrors].join('\n'));
    }

    const report: RankedRootBrowserSmokeReport = {
      schemaVersion: 'gw.ranked-root-browser-smoke.v4',
      ok: true,
      generatedAt: new Date().toISOString(),
      rootUrl: rootUrl.toString(),
      apiBaseUrl,
      forceRelayRequested: forceRelay,
      isolatedBrowserProcesses: true,
      browserProcessCount: clients.length,
      ...evidence,
      clients: finalSnapshots,
      consoleMessages: clients.map((client) => client.consoleMessages),
      pageErrors: clients.map((client) => client.pageErrors),
      browserExecutable: executablePath,
    };
    writeJsonReport(outputPath, report);
    console.log(JSON.stringify({ ...report, reportPath: outputPath }, null, 2));
  } catch (error) {
    const failureScreenshots = await captureFailureScreenshots(clients, screenshotPath);
    const snapshots = await Promise.all(clients.map((client) => (
      readSnapshot(client.page).catch(() => null)
    )));
    const report: RankedRootBrowserSmokeReport = {
      schemaVersion: 'gw.ranked-root-browser-smoke.v4',
      ok: false,
      generatedAt: new Date().toISOString(),
      rootUrl: rootUrl.toString(),
      apiBaseUrl,
      forceRelayRequested: forceRelay,
      isolatedBrowserProcesses: clients.length === 2,
      browserProcessCount: clients.length,
      clients: snapshots.filter((entry): entry is LocalRankedRootSmokeSnapshot => entry !== null),
      consoleMessages: clients.map((client) => client.consoleMessages),
      pageErrors: clients.map((client) => client.pageErrors),
      browserExecutable: executablePath,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      failureScreenshots,
    };
    writeJsonReport(outputPath, report);
    console.error(JSON.stringify({ ...report, reportPath: outputPath }, null, 2));
    process.exitCode = 1;
  } finally {
    await Promise.all(clients.map(async (client) => {
      await client.context.close().catch(() => undefined);
      await client.browser.close().catch(() => undefined);
    }));
  }
}

void run();
