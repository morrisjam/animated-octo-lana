import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright-core';
import type {
  OnlineFrameEnvelope,
  OnlineFrameSubmission,
  OnlineFrameTransport,
} from '../src/net/onlineInputPump';
import type {
  PeerSmokeLifecycleDiagnostics,
  PeerSmokeTransportDiagnostics,
} from '../src/dev/webRtcPeerSmoke';
import {
  runWebRtcRollbackScenario,
  type WebRtcRollbackScenarioReport,
} from '../src/dev/webRtcRollbackScenario';
import { buildLocalSmokeRtcConfiguration } from '../src/dev/localSmokeIceConfig';
import { resolveWebRtcSoakReleaseIdentity } from '../src/dev/webRtcSoakReleaseIdentity';

interface BrowserSmokeReport {
  schemaVersion?: string;
  ok?: boolean;
  forceRelayRequested?: boolean;
  expectedReleaseSha?: string | null;
  sessionId?: string;
  accounts?: string[];
  connectionPaths?: string[];
  relayAvailable?: boolean;
  iceTransportPolicies?: string[];
  turnCredentialModes?: string[];
  acknowledgedFrames?: number[];
  receivedFrameAccounts?: Array<string | null>;
  peerConfirmations?: number[];
  recovery?: {
    serverDisconnectObserved?: boolean;
    serverReconnectObserved?: boolean;
    staleAttemptRejected?: boolean;
    previousAttemptGeneration?: number;
    recoveredAttemptGeneration?: number;
    recoveredAttemptId?: string;
    connectionPaths?: string[];
    checkpointChecksum?: number;
    acknowledgedFrames?: number[];
    receivedFrameAccounts?: Array<string | null>;
    peerConfirmations?: number[];
  };
  lifecycle?: {
    suspendedAccountId?: string;
    disconnectObserved?: boolean;
    duplicateSuspendDeduplicated?: boolean;
    reconnectDeadlineStable?: boolean;
    resumedConnected?: boolean;
    disconnectRequests?: number;
    reconnectRequests?: number;
    lifecycleEvents?: string[];
    lifecycleErrors?: string[];
    postResumeAcknowledgedFrames?: number[];
    postResumeReceivedFrameAccounts?: Array<string | null>;
    postResumePeerConfirmations?: number[];
  };
  rollback?: {
    schemaVersion?: string;
    continuousSimulation?: boolean;
    frameCount?: number;
    deliveryIntervalFrames?: number;
    epoch?: number;
    canonicalChecksum?: number;
    canonicalConvergence?: boolean;
    peers?: Record<'P1' | 'P2', {
      checksum?: number;
      predictedAdvanceFrames?: number;
      acceptedRemoteFrames?: number;
      rollbackApplications?: number;
      synchronized?: boolean;
      rollback?: {
        totalRollbacks?: number;
        maxRollbackDepth?: number;
        correctionEvents?: unknown[];
        conflictingAuthoritativeFrames?: number;
        tooLateAuthoritativeFrames?: number;
      };
      pump?: {
        outboundFrames?: number;
        contiguousRemoteFrame?: number;
        peerConfirmedThrough?: number;
        confirmationSentThrough?: number;
        uploadFailures?: number;
        pollFailures?: number;
        confirmationFailures?: number;
      };
    }>;
  };
  twoClient?: TwoClientBrowserSmokeReport;
}

interface RunnerSmokeAccount {
  id: string;
  accessToken: string;
}

interface RunnerSmokeMatchStart {
  sessionId: string;
  sessionToken: string;
  heartbeatIntervalSeconds?: number;
  reconnectGraceSeconds?: number;
  transportAttempt: {
    attemptId: string;
    generation: number;
    createdAt: string;
  };
  localPlayer: { accountId: string; side: 'P1' | 'P2' };
  peer: { accountId: string; side: 'P1' | 'P2' };
}

interface RunnerSmokeTicket {
  ticketId: string;
  status: 'queued' | 'matched' | 'closed';
  matchStart?: RunnerSmokeMatchStart;
}

interface RunnerSmokeIceConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  relayAvailable: boolean;
  turnCredentialMode: 'none' | 'static' | 'time_limited';
}

interface RunnerSmokeSession {
  status: 'active' | 'resolved';
  resolvedReason?: string;
  reconnectGraceSeconds?: number;
  participants?: Array<{
    accountId: string;
    connectionStatus: 'connected' | 'disconnected';
    disconnectedAt?: string;
    reconnectDeadlineAt?: string;
  }>;
}

interface RunnerPeerIdentity {
  localAccountId: string;
  remoteAccountId: string;
  side: 'P1' | 'P2';
  sessionId: string;
  connectionPath: 'direct' | 'relay';
}

interface RunnerPeerPollResult {
  frames: OnlineFrameEnvelope[];
  peerConfirmedThrough: number;
}

interface BrowserSoakOptions {
  enabled: boolean;
  durationSeconds: number;
  frameRate: number;
  deliveryIntervalFrames: number;
  maxRollbackDepthFrames: number;
  minimumDurationRatio: number;
  outputPath: string | null;
}

interface TwoClientRollbackSoakReport {
  schemaVersion: 'gw.webrtc-two-client-rollback-soak.v1';
  passed: boolean;
  networkProfile: 'reliable-ordered-datachannel-with-delayed-application-input';
  requestedDurationSeconds: number;
  observedDurationSeconds: number;
  durationRatio: number;
  frameRate: number;
  frameCount: number;
  deliveryIntervalFrames: number;
  thresholds: {
    minimumDurationRatio: number;
    maxRollbackDepthFrames: number;
    maxTransportFailures: 0;
    maxProtocolErrors: 0;
    maxDisconnects: 0;
  };
  rollback: WebRtcRollbackScenarioReport;
  transportDiagnostics: [PeerSmokeTransportDiagnostics, PeerSmokeTransportDiagnostics];
  failures: string[];
}

interface TwoClientLifecycleStallReport {
  schemaVersion: 'gw.webrtc-two-client-lifecycle-stall.v1';
  suspendedAccountId: string;
  requestedStallMs: number;
  observedStallMs: number;
  scriptExecutionDisabled: boolean;
  freshTimerAfterResume: boolean;
  serverDisconnectObserved: boolean;
  peerStayedConnected: boolean;
  serverReconnectObserved: boolean;
  lifecycleDiagnostics: [PeerSmokeLifecycleDiagnostics, PeerSmokeLifecycleDiagnostics];
  postResumeAcknowledgedFrames: number[];
  postResumeReceivedFrameAccounts: Array<string | null>;
  postResumePeerConfirmations: number[];
  transportDiagnostics: [PeerSmokeTransportDiagnostics, PeerSmokeTransportDiagnostics];
}

interface TwoClientBrowserSmokeReport {
  schemaVersion: 'gw.webrtc-two-client-smoke.v5';
  forceRelayRequested: boolean;
  buildVersion: string;
  isolatedBrowserContexts: boolean;
  pageCount: number;
  sessionId: string;
  accounts: string[];
  sides: Array<'P1' | 'P2'>;
  connectionPaths: Array<'direct' | 'relay'>;
  relayAvailable: boolean;
  iceTransportPolicies: RTCIceTransportPolicy[];
  turnCredentialModes: Array<'none' | 'static' | 'time_limited'>;
  acknowledgedFrames: number[];
  receivedFrameAccounts: Array<string | null>;
  peerConfirmations: number[];
  completionResolved: boolean;
  consoleErrorCount: number;
  pageErrorCount: number;
  transportDiagnostics: [PeerSmokeTransportDiagnostics, PeerSmokeTransportDiagnostics];
  rollbackSoak: TwoClientRollbackSoakReport | null;
  lifecycleStall: TwoClientLifecycleStallReport;
}

const DEFAULT_WEB_URL = 'http://127.0.0.1:5190/webrtc-smoke.html';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FAILURE_SCREENSHOT = resolve('build-artifacts/webrtc-browser-smoke-failure.png');
const DEFAULT_SOAK_DURATION_SECONDS = 30 * 60;
const DEFAULT_SOAK_FRAME_RATE = 60;
const DEFAULT_SOAK_DELIVERY_INTERVAL_FRAMES = 12;
const DEFAULT_SOAK_OUTPUT = resolve('build-artifacts/webrtc-browser-soak-report.json');

function parseTimeout(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    throw new Error('WEBRTC_BROWSER_SMOKE_TIMEOUT_MS must be at least 1000.');
  }
  return Math.floor(parsed);
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

function readCliOption(name: string): string | undefined {
  const args = process.argv.slice(2);
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === name) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value.`);
      }
      values.push(value);
      index += 1;
    } else if (argument.startsWith(`${name}=`)) {
      values.push(argument.slice(name.length + 1));
    }
  }
  if (values.length > 1) {
    throw new Error(`${name} may only be provided once.`);
  }
  return values[0];
}

function parseFiniteOption(
  name: string,
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (
    !Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (integer && !Number.isInteger(value))
  ) {
    const integerLabel = integer ? ' integer' : '';
    throw new Error(`${name} must be an${integerLabel} value from ${minimum} to ${maximum}.`);
  }
  return value;
}

function parseSoakOptions(): BrowserSoakOptions {
  const args = process.argv.slice(2);
  const knownFlags = new Set([
    '--soak',
    '--duration-seconds',
    '--frame-rate',
    '--delivery-interval-frames',
    '--max-rollback-depth-frames',
    '--minimum-duration-ratio',
    '--output',
  ]);
  for (const argument of args) {
    if (!argument.startsWith('--') || argument === '--') {
      continue;
    }
    const flag = argument.split('=', 1)[0] ?? argument;
    if (!knownFlags.has(flag)) {
      throw new Error(`Unknown WebRTC browser smoke option: ${flag}`);
    }
  }

  const durationRaw = readCliOption('--duration-seconds')
    ?? process.env.WEBRTC_BROWSER_SOAK_DURATION_SECONDS;
  const enabled = args.includes('--soak') || durationRaw !== undefined;
  const durationSeconds = parseFiniteOption(
    'soak duration seconds',
    durationRaw,
    enabled ? DEFAULT_SOAK_DURATION_SECONDS : 0,
    enabled ? 0.1 : 0,
    24 * 60 * 60,
  );
  const frameRate = parseFiniteOption(
    'soak frame rate',
    readCliOption('--frame-rate') ?? process.env.WEBRTC_BROWSER_SOAK_FRAME_RATE,
    DEFAULT_SOAK_FRAME_RATE,
    1,
    120,
    true,
  );
  const deliveryIntervalFrames = parseFiniteOption(
    'soak delivery interval frames',
    readCliOption('--delivery-interval-frames')
      ?? process.env.WEBRTC_BROWSER_SOAK_DELIVERY_INTERVAL_FRAMES,
    DEFAULT_SOAK_DELIVERY_INTERVAL_FRAMES,
    2,
    30,
    true,
  );
  const maxRollbackDepthFrames = parseFiniteOption(
    'maximum rollback depth frames',
    readCliOption('--max-rollback-depth-frames')
      ?? process.env.WEBRTC_BROWSER_SOAK_MAX_ROLLBACK_DEPTH_FRAMES,
    Math.max(30, deliveryIntervalFrames),
    deliveryIntervalFrames,
    600,
    true,
  );
  const minimumDurationRatio = parseFiniteOption(
    'minimum duration ratio',
    readCliOption('--minimum-duration-ratio')
      ?? process.env.WEBRTC_BROWSER_SOAK_MINIMUM_DURATION_RATIO,
    0.95,
    0.5,
    1,
  );
  const output = readCliOption('--output')
    ?? process.env.WEBRTC_BROWSER_SMOKE_REPORT_PATH
    ?? (enabled ? DEFAULT_SOAK_OUTPUT : undefined);

  return {
    enabled,
    durationSeconds,
    frameRate,
    deliveryIntervalFrames,
    maxRollbackDepthFrames,
    minimumDurationRatio,
    outputPath: output ? resolve(output) : null,
  };
}

function writeJsonReport(path: string | null, value: unknown): void {
  if (!path) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

function transportDiagnosticsHealthy(diagnostics: PeerSmokeTransportDiagnostics): boolean {
  return diagnostics.channelState === 'open'
    && diagnostics.submittedFrames === diagnostics.acceptedFrames
    && diagnostics.submitFailures === 0
    && diagnostics.pollFailures === 0
    && diagnostics.confirmationFailures === 0
    && diagnostics.protocolErrors.length === 0
    && diagnostics.recoverableDisconnects.length === 0;
}

function validateReport(
  report: BrowserSmokeReport,
  forceRelayExpected: boolean,
  soakOptions: BrowserSoakOptions,
  expectedBuildVersion: string,
): void {
  if (
    report.schemaVersion !== 'gw.webrtc-browser-smoke.v8'
    || report.ok !== true
    || report.forceRelayRequested !== forceRelayExpected
    || !report.sessionId
  ) {
    throw new Error('Browser smoke did not report a completed online session.');
  }
  const accounts = report.accounts;
  if (!accounts || accounts.length !== 2 || new Set(accounts).size !== 2) {
    throw new Error('Browser smoke did not create two distinct signed accounts.');
  }
  if (
    report.connectionPaths?.length !== 2
    || report.connectionPaths.some((path) => path !== 'direct' && path !== 'relay')
  ) {
    throw new Error('Browser smoke did not establish a valid direct or relay path for both peers.');
  }
  if (
    typeof report.relayAvailable !== 'boolean'
    || report.iceTransportPolicies?.length !== 2
    || report.iceTransportPolicies.some((policy) => policy !== 'all' && policy !== 'relay')
    || report.turnCredentialModes?.length !== 2
    || report.turnCredentialModes.some((mode) => (
      mode !== 'none' && mode !== 'static' && mode !== 'time_limited'
    ))
  ) {
    throw new Error('Browser smoke did not report a valid account-scoped ICE configuration.');
  }
  if (report.acknowledgedFrames?.length !== 2 || report.acknowledgedFrames.some((count) => count !== 1)) {
    throw new Error('Browser smoke did not acknowledge exactly one frame from each peer.');
  }
  if (report.peerConfirmations?.length !== 2 || report.peerConfirmations.some((frame) => frame !== 0)) {
    throw new Error('Browser smoke peer confirmations did not converge through frame 0.');
  }
  if (
    report.receivedFrameAccounts?.length !== 2
    || report.receivedFrameAccounts[0] !== accounts[1]
    || report.receivedFrameAccounts[1] !== accounts[0]
  ) {
    throw new Error('Browser smoke did not preserve peer identity while routing frames.');
  }
  const recovery = report.recovery;
  if (
    !recovery
    || recovery.serverDisconnectObserved !== true
    || recovery.serverReconnectObserved !== true
    || recovery.staleAttemptRejected !== true
    || !Number.isInteger(recovery.previousAttemptGeneration)
    || recovery.recoveredAttemptGeneration !== Number(recovery.previousAttemptGeneration) + 1
    || !recovery.recoveredAttemptId
    || recovery.connectionPaths?.length !== 2
    || recovery.connectionPaths.some((path) => path !== 'direct' && path !== 'relay')
    || recovery.checkpointChecksum !== report.rollback?.canonicalChecksum
    || recovery.acknowledgedFrames?.length !== 2
    || recovery.acknowledgedFrames.some((count) => count !== 1)
    || recovery.receivedFrameAccounts?.length !== 2
    || recovery.receivedFrameAccounts[0] !== accounts[1]
    || recovery.receivedFrameAccounts[1] !== accounts[0]
    || recovery.peerConfirmations?.length !== 2
    || recovery.peerConfirmations.some((frame) => frame !== 120)
  ) {
    throw new Error('Browser smoke did not prove attempt-scoped DataChannel recovery.');
  }
  const lifecycle = report.lifecycle;
  if (
    !lifecycle
    || lifecycle.suspendedAccountId !== accounts[0]
    || lifecycle.disconnectObserved !== true
    || lifecycle.duplicateSuspendDeduplicated !== true
    || lifecycle.reconnectDeadlineStable !== true
    || lifecycle.resumedConnected !== true
    || lifecycle.disconnectRequests !== 1
    || lifecycle.reconnectRequests !== 1
    || JSON.stringify(lifecycle.lifecycleEvents) !== JSON.stringify([
      'suspended:visibility_hidden',
      'reconnecting:visibility_visible',
      'resumed:visibility_visible',
    ])
    || lifecycle.lifecycleErrors?.length !== 0
    || lifecycle.postResumeAcknowledgedFrames?.length !== 2
    || lifecycle.postResumeAcknowledgedFrames.some((count) => count !== 1)
    || lifecycle.postResumeReceivedFrameAccounts?.length !== 2
    || lifecycle.postResumeReceivedFrameAccounts[0] !== accounts[1]
    || lifecycle.postResumeReceivedFrameAccounts[1] !== accounts[0]
    || lifecycle.postResumePeerConfirmations?.length !== 2
    || lifecycle.postResumePeerConfirmations.some((frame) => frame !== 0)
  ) {
    throw new Error('Browser smoke did not prove suspend, nonce reconnect, and post-resume traffic.');
  }
  const rollback = report.rollback;
  if (
    !rollback
    || rollback.schemaVersion !== 'gw.webrtc-rollback-smoke.v2'
    || rollback.continuousSimulation !== true
    || !Number.isInteger(rollback.frameCount)
    || Number(rollback.frameCount) < 60
    || !Number.isInteger(rollback.deliveryIntervalFrames)
    || Number(rollback.deliveryIntervalFrames) < 2
    || rollback.canonicalConvergence !== true
    || !Number.isInteger(rollback.canonicalChecksum)
  ) {
    throw new Error('Browser smoke did not report a valid delayed-input rollback scenario.');
  }
  const frameCount = Number(rollback.frameCount);
  const delayFrames = Number(rollback.deliveryIntervalFrames);
  for (const playerId of ['P1', 'P2'] as const) {
    const peer = rollback.peers?.[playerId];
    const rollbackDiagnostics = peer?.rollback;
    const pumpDiagnostics = peer?.pump;
    if (
      !peer
      || !rollbackDiagnostics
      || !pumpDiagnostics
      || peer.checksum !== rollback.canonicalChecksum
      || peer.predictedAdvanceFrames !== frameCount
      || peer.acceptedRemoteFrames !== frameCount
      || !Number.isInteger(peer.rollbackApplications)
      || Number(peer.rollbackApplications) <= 0
      || peer.synchronized !== true
      || !Number.isInteger(rollbackDiagnostics.totalRollbacks)
      || Number(rollbackDiagnostics.totalRollbacks) <= 0
      || !Number.isInteger(rollbackDiagnostics.maxRollbackDepth)
      || Number(rollbackDiagnostics.maxRollbackDepth) < delayFrames
      || !Array.isArray(rollbackDiagnostics.correctionEvents)
      || rollbackDiagnostics.correctionEvents.length <= 0
      || rollbackDiagnostics.conflictingAuthoritativeFrames !== 0
      || rollbackDiagnostics.tooLateAuthoritativeFrames !== 0
      || pumpDiagnostics.outboundFrames !== 0
      || pumpDiagnostics.contiguousRemoteFrame !== frameCount - 1
      || pumpDiagnostics.peerConfirmedThrough !== frameCount - 1
      || pumpDiagnostics.confirmationSentThrough !== frameCount - 1
      || pumpDiagnostics.uploadFailures !== 0
      || pumpDiagnostics.pollFailures !== 0
      || pumpDiagnostics.confirmationFailures !== 0
    ) {
      throw new Error(`Browser smoke did not prove rollback convergence for ${playerId}.`);
    }
  }
  const twoClient = report.twoClient;
  if (
    !twoClient
    || twoClient.schemaVersion !== 'gw.webrtc-two-client-smoke.v5'
    || twoClient.forceRelayRequested !== forceRelayExpected
    || twoClient.buildVersion !== expectedBuildVersion
    || twoClient.isolatedBrowserContexts !== true
    || twoClient.pageCount !== 2
    || !twoClient.sessionId
    || twoClient.accounts.length !== 2
    || new Set(twoClient.accounts).size !== 2
    || JSON.stringify([...twoClient.sides].sort()) !== JSON.stringify(['P1', 'P2'])
    || twoClient.connectionPaths.length !== 2
    || twoClient.connectionPaths.some((path) => path !== 'direct' && path !== 'relay')
    || typeof twoClient.relayAvailable !== 'boolean'
    || twoClient.iceTransportPolicies.length !== 2
    || twoClient.iceTransportPolicies.some((policy) => policy !== 'all' && policy !== 'relay')
    || twoClient.turnCredentialModes.length !== 2
    || twoClient.turnCredentialModes.some((mode) => (
      mode !== 'none' && mode !== 'static' && mode !== 'time_limited'
    ))
    || twoClient.acknowledgedFrames.length !== 2
    || twoClient.acknowledgedFrames.some((count) => count !== 1)
    || twoClient.receivedFrameAccounts.length !== 2
    || twoClient.receivedFrameAccounts[0] !== twoClient.accounts[1]
    || twoClient.receivedFrameAccounts[1] !== twoClient.accounts[0]
    || twoClient.peerConfirmations.length !== 2
    || twoClient.peerConfirmations.some((frame) => frame !== 0)
    || twoClient.completionResolved !== true
    || twoClient.consoleErrorCount !== 0
    || twoClient.pageErrorCount !== 0
    || twoClient.transportDiagnostics.length !== 2
    || twoClient.transportDiagnostics.some((diagnostics) => !transportDiagnosticsHealthy(diagnostics))
  ) {
    throw new Error('Browser smoke did not prove isolated two-client authentication and frame routing.');
  }
  const lifecycleStall = twoClient.lifecycleStall;
  const suspendedLifecycle = lifecycleStall?.lifecycleDiagnostics[0];
  const peerLifecycle = lifecycleStall?.lifecycleDiagnostics[1];
  if (
    !lifecycleStall
    || lifecycleStall.schemaVersion !== 'gw.webrtc-two-client-lifecycle-stall.v1'
    || lifecycleStall.suspendedAccountId !== twoClient.accounts[0]
    || lifecycleStall.requestedStallMs < 150
    || lifecycleStall.observedStallMs < lifecycleStall.requestedStallMs
    || lifecycleStall.scriptExecutionDisabled !== true
    || lifecycleStall.freshTimerAfterResume !== true
    || lifecycleStall.serverDisconnectObserved !== true
    || lifecycleStall.peerStayedConnected !== true
    || lifecycleStall.serverReconnectObserved !== true
    || !suspendedLifecycle
    || suspendedLifecycle.phase !== 'active'
    || suspendedLifecycle.heartbeatRunning !== true
    || suspendedLifecycle.heartbeatRequests < 1
    || suspendedLifecycle.disconnectRequests !== 1
    || suspendedLifecycle.reconnectRequests !== 1
    || JSON.stringify(suspendedLifecycle.events) !== JSON.stringify([
      'suspended:visibility_hidden',
      'reconnecting:visibility_visible',
      'resumed:visibility_visible',
    ])
    || suspendedLifecycle.errors.length !== 0
    || !peerLifecycle
    || peerLifecycle.phase !== 'active'
    || peerLifecycle.heartbeatRunning !== true
    || peerLifecycle.heartbeatRequests < 1
    || peerLifecycle.disconnectRequests !== 0
    || peerLifecycle.reconnectRequests !== 0
    || peerLifecycle.errors.length !== 0
    || lifecycleStall.postResumeAcknowledgedFrames.length !== 2
    || lifecycleStall.postResumeAcknowledgedFrames.some((count) => count !== 1)
    || lifecycleStall.postResumeReceivedFrameAccounts.length !== 2
    || lifecycleStall.postResumeReceivedFrameAccounts[0] !== twoClient.accounts[1]
    || lifecycleStall.postResumeReceivedFrameAccounts[1] !== twoClient.accounts[0]
    || lifecycleStall.postResumePeerConfirmations.length !== 2
    || lifecycleStall.postResumePeerConfirmations.some((frame) => frame !== 0)
    || lifecycleStall.transportDiagnostics.some((diagnostics) => !transportDiagnosticsHealthy(diagnostics))
  ) {
    throw new Error('Browser smoke did not prove isolated-client lifecycle stall recovery.');
  }
  if (soakOptions.enabled) {
    const soak = twoClient.rollbackSoak;
    if (
      !soak
      || soak.schemaVersion !== 'gw.webrtc-two-client-rollback-soak.v1'
      || soak.passed !== true
      || soak.failures.length !== 0
      || soak.requestedDurationSeconds !== soakOptions.durationSeconds
      || soak.frameRate !== soakOptions.frameRate
      || soak.deliveryIntervalFrames !== soakOptions.deliveryIntervalFrames
      || soak.thresholds.maxRollbackDepthFrames !== soakOptions.maxRollbackDepthFrames
      || soak.durationRatio < soakOptions.minimumDurationRatio
      || soak.rollback.canonicalConvergence !== true
      || soak.transportDiagnostics.some((diagnostics) => !transportDiagnosticsHealthy(diagnostics))
      || soak.rollback.peers.P1.rollback.maxRollbackDepth > soakOptions.maxRollbackDepthFrames
      || soak.rollback.peers.P2.rollback.maxRollbackDepth > soakOptions.maxRollbackDepthFrames
    ) {
      throw new Error('Browser soak did not stay inside its duration, transport, rollback, and convergence limits.');
    }
  } else if (twoClient.rollbackSoak !== null) {
    throw new Error('Browser smoke unexpectedly reported soak evidence when soak mode was disabled.');
  }
  if (forceRelayExpected && (
    report.relayAvailable !== true
    || report.connectionPaths.some((path) => path !== 'relay')
    || report.recovery?.connectionPaths?.some((path) => path !== 'relay')
    || report.iceTransportPolicies.some((policy) => policy !== 'relay')
    || report.turnCredentialModes.some((mode) => mode !== 'time_limited')
    || twoClient.relayAvailable !== true
    || twoClient.connectionPaths.some((path) => path !== 'relay')
    || twoClient.iceTransportPolicies.some((policy) => policy !== 'relay')
    || twoClient.turnCredentialModes.some((mode) => mode !== 'time_limited')
  )) {
    throw new Error('Forced-relay smoke did not keep every browser connection on short-lived TURN relay.');
  }
  if (!forceRelayExpected && (
    report.connectionPaths.some((path) => path !== 'direct')
    || report.recovery?.connectionPaths?.some((path) => path !== 'direct')
    || report.iceTransportPolicies.some((policy) => policy !== 'all')
    || twoClient.connectionPaths.some((path) => path !== 'direct')
    || twoClient.iceTransportPolicies.some((policy) => policy !== 'all')
  )) {
    throw new Error('Direct smoke did not keep every browser connection off the TURN relay.');
  }
}

function recordConsoleMessage(messages: string[], message: ConsoleMessage): void {
  const location = message.location();
  const source = location.url ? ` (${location.url}:${location.lineNumber + 1})` : '';
  messages.push(`[${message.type()}] ${message.text()}${source}`);
}

function isExpectedStaleAttemptConflict(message: string): boolean {
  return message.startsWith('[error] Failed to load resource: the server responded with a status of 409 (Conflict)')
    && /\/matchmaking\/sessions\/[^/?]+\/signals\?transportAttemptId=[^&]+&afterSignalId=0&limit=1/.test(message);
}

async function captureFailure(page: Page | null, path: string): Promise<void> {
  if (!page) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true }).catch(() => undefined);
}

async function assertSafeSmokeTarget(apiBaseUrl: string): Promise<void> {
  if (process.env.ALLOW_REMOTE_DATABASE_SMOKE === '1') {
    return;
  }
  const response = await fetch(`${apiBaseUrl}/health`);
  if (!response.ok) {
    throw new Error(`WebRTC browser smoke could not verify API health (${response.status}).`);
  }
  const health = await response.json() as { databaseTarget?: string };
  if (health.databaseTarget !== 'local') {
    throw new Error(
      `WebRTC browser smoke refused database target "${health.databaseTarget ?? 'unreported'}". Set ALLOW_REMOTE_DATABASE_SMOKE=1 only for an intentional isolated staging run.`,
    );
  }
}

async function requestRunnerJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve text errors in the thrown diagnostic.
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function createRunnerAccount(baseUrl: string): Promise<RunnerSmokeAccount> {
  return await requestRunnerJson(baseUrl, '/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

async function joinRunnerQueue(
  baseUrl: string,
  account: RunnerSmokeAccount,
  characterId: 'vanguard' | 'duelist',
  buildVersion: string,
): Promise<RunnerSmokeTicket> {
  return await requestRunnerJson(baseUrl, '/matchmaking/queue/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      queueType: 'ranked',
      regionPreferences: ['eu-west'],
      buildVersion,
      rulesetVersion: 'prototype-2026.09',
      balanceProfileId: 'default',
      platform: 'web',
      characterId,
    }),
  }, account.accessToken);
}

async function resolveRunnerMatch(
  baseUrl: string,
  account: RunnerSmokeAccount,
  ticket: RunnerSmokeTicket,
): Promise<RunnerSmokeMatchStart> {
  const resolved = ticket.status === 'matched'
    ? ticket
    : await requestRunnerJson<RunnerSmokeTicket>(
      baseUrl,
      `/matchmaking/queue/tickets/${ticket.ticketId}`,
      {},
      account.accessToken,
    );
  if (!resolved.matchStart) {
    throw new Error(`Two-client ticket ${ticket.ticketId} did not resolve to a match.`);
  }
  return resolved.matchStart;
}

async function requestRunnerIceConfig(
  baseUrl: string,
  account: RunnerSmokeAccount,
  match: RunnerSmokeMatchStart,
  forceRelay: boolean,
): Promise<RunnerSmokeIceConfig> {
  return await requestRunnerJson(baseUrl, '/matchmaking/network/ice-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: match.sessionId,
      sessionToken: match.sessionToken,
      forceRelay,
    }),
  }, account.accessToken);
}

async function readRunnerSession(
  baseUrl: string,
  account: RunnerSmokeAccount,
  match: RunnerSmokeMatchStart,
): Promise<RunnerSmokeSession> {
  return await requestRunnerJson(
    baseUrl,
    `/matchmaking/sessions/${match.sessionId}`,
    {},
    account.accessToken,
  );
}

async function waitForRunnerSession(
  baseUrl: string,
  account: RunnerSmokeAccount,
  match: RunnerSmokeMatchStart,
  timeoutMs: number,
  predicate: (session: RunnerSmokeSession) => boolean,
): Promise<RunnerSmokeSession> {
  const deadline = Date.now() + timeoutMs;
  let latest: RunnerSmokeSession | null = null;
  while (Date.now() < deadline) {
    latest = await readRunnerSession(baseUrl, account, match);
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Session lifecycle condition was not met: ${JSON.stringify(latest)}`);
}

function createRunnerFrameInput(moveX: number, launch: boolean) {
  return {
    moveX,
    moveY: 0,
    boost: false,
    superBoost: false,
    special: false,
    launch,
    dunk: false,
    parry: false,
    breakLaunch: false,
  };
}

function createPageFrameTransport(page: Page): OnlineFrameTransport {
  return {
    submitFrames: async (frames: OnlineFrameSubmission[]) => await page.evaluate(
      async (submissions) => {
        const runtime = window.gravityWellPeerSmoke;
        if (!runtime) {
          throw new Error('Peer runtime is unavailable.');
        }
        return await runtime.submitFrames(submissions);
      },
      frames,
    ),
    pollFrames: async (epoch: number, sinceFrame: number) => await page.evaluate(
      async ({ frameEpoch, afterFrame }) => {
        const runtime = window.gravityWellPeerSmoke;
        if (!runtime) {
          throw new Error('Peer runtime is unavailable.');
        }
        return await runtime.pollFrames(frameEpoch, afterFrame);
      },
      { frameEpoch: epoch, afterFrame: sinceFrame },
    ),
    confirmFrames: async (epoch: number, confirmedThrough: number) => await page.evaluate(
      async ({ frameEpoch, throughFrame }) => {
        const runtime = window.gravityWellPeerSmoke;
        if (!runtime) {
          throw new Error('Peer runtime is unavailable.');
        }
        return await runtime.confirmFrames(frameEpoch, throughFrame);
      },
      { frameEpoch: epoch, throughFrame: confirmedThrough },
    ),
  };
}

async function readPageTransportDiagnostics(page: Page): Promise<PeerSmokeTransportDiagnostics> {
  return await page.evaluate(() => {
    const runtime = window.gravityWellPeerSmoke;
    if (!runtime) {
      throw new Error('Peer runtime is unavailable.');
    }
    return runtime.getTransportDiagnostics();
  });
}

async function readPageLifecycleDiagnostics(page: Page): Promise<PeerSmokeLifecycleDiagnostics> {
  return await page.evaluate(() => {
    const runtime = window.gravityWellPeerSmoke;
    if (!runtime) {
      throw new Error('Peer runtime is unavailable.');
    }
    return runtime.getLifecycleDiagnostics();
  });
}

async function runTwoClientRollbackSoak(
  page1: Page,
  page2: Page,
  identity1: RunnerPeerIdentity,
  identity2: RunnerPeerIdentity,
  account1: RunnerSmokeAccount,
  account2: RunnerSmokeAccount,
  options: BrowserSoakOptions,
): Promise<TwoClientRollbackSoakReport> {
  const frameCount = Math.max(
    options.deliveryIntervalFrames,
    Math.round(options.durationSeconds * options.frameRate),
  );
  const pagesBySide = identity1.side === 'P1'
    ? { P1: page1, P2: page2 }
    : { P1: page2, P2: page1 };
  const accountIds = identity1.side === 'P1'
    ? { P1: account1.id, P2: account2.id }
    : { P1: account2.id, P2: account1.id };
  const loadout = identity1.side === 'P1'
    ? { P1: 'vanguard' as const, P2: 'duelist' as const }
    : { P1: 'duelist' as const, P2: 'vanguard' as const };
  const startedAt = Date.now();
  const rollback = await runWebRtcRollbackScenario({
    transports: {
      P1: createPageFrameTransport(pagesBySide.P1),
      P2: createPageFrameTransport(pagesBySide.P2),
    },
    accountIds,
    loadout,
    epoch: 1,
    frameCount,
    deliveryIntervalFrames: options.deliveryIntervalFrames,
    paceThroughFrame: async (throughFrame) => {
      const targetElapsedMs = ((throughFrame + 1) / options.frameRate) * 1_000;
      const remainingMs = targetElapsedMs - (Date.now() - startedAt);
      if (remainingMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, remainingMs));
      }
    },
    settleTransport: () => new Promise((resolveDelay) => setTimeout(resolveDelay, 10)),
  });
  const observedDurationSeconds = (Date.now() - startedAt) / 1_000;
  const durationRatio = observedDurationSeconds / options.durationSeconds;
  const transportDiagnostics = await Promise.all([
    readPageTransportDiagnostics(page1),
    readPageTransportDiagnostics(page2),
  ]) as [PeerSmokeTransportDiagnostics, PeerSmokeTransportDiagnostics];
  const failures: string[] = [];
  if (durationRatio < options.minimumDurationRatio) {
    failures.push(
      `observed duration ratio ${durationRatio.toFixed(3)} was below ${options.minimumDurationRatio}`,
    );
  }
  for (const playerId of ['P1', 'P2'] as const) {
    const depth = rollback.peers[playerId].rollback.maxRollbackDepth;
    if (depth > options.maxRollbackDepthFrames) {
      failures.push(`${playerId} rollback depth ${depth} exceeded ${options.maxRollbackDepthFrames}`);
    }
  }
  transportDiagnostics.forEach((diagnostics, index) => {
    if (!transportDiagnosticsHealthy(diagnostics)) {
      failures.push(`browser peer ${index + 1} reported a transport failure or disconnect`);
    }
  });

  return {
    schemaVersion: 'gw.webrtc-two-client-rollback-soak.v1',
    passed: failures.length === 0,
    networkProfile: 'reliable-ordered-datachannel-with-delayed-application-input',
    requestedDurationSeconds: options.durationSeconds,
    observedDurationSeconds: Number(observedDurationSeconds.toFixed(3)),
    durationRatio: Number(durationRatio.toFixed(4)),
    frameRate: options.frameRate,
    frameCount,
    deliveryIntervalFrames: options.deliveryIntervalFrames,
    thresholds: {
      minimumDurationRatio: options.minimumDurationRatio,
      maxRollbackDepthFrames: options.maxRollbackDepthFrames,
      maxTransportFailures: 0,
      maxProtocolErrors: 0,
      maxDisconnects: 0,
    },
    rollback,
    transportDiagnostics,
    failures,
  };
}

async function runTwoClientLifecycleStall(
  page1: Page,
  page2: Page,
  apiBaseUrl: string,
  account1: RunnerSmokeAccount,
  account2: RunnerSmokeAccount,
  match1: RunnerSmokeMatchStart,
  timeoutMs: number,
): Promise<TwoClientLifecycleStallReport> {
  await page1.evaluate(async () => {
    const runtime = window.gravityWellPeerSmoke;
    if (!runtime) {
      throw new Error('Peer runtime is unavailable.');
    }
    await runtime.suspend('visibility_hidden');
  });

  const disconnectedSession = await waitForRunnerSession(
    apiBaseUrl,
    account2,
    match1,
    timeoutMs,
    (session) => session.participants?.some((participant) => (
      participant.accountId === account1.id
      && participant.connectionStatus === 'disconnected'
      && Boolean(participant.reconnectDeadlineAt)
    )) === true,
  );
  const suspendedParticipant = disconnectedSession.participants?.find(
    (participant) => participant.accountId === account1.id,
  );
  const peerParticipant = disconnectedSession.participants?.find(
    (participant) => participant.accountId === account2.id,
  );
  const serverDisconnectObserved = suspendedParticipant?.connectionStatus === 'disconnected'
    && Boolean(suspendedParticipant.reconnectDeadlineAt);
  const peerStayedConnected = peerParticipant?.connectionStatus === 'connected';

  const reconnectGraceSeconds = Math.max(
    1,
    Number(match1.reconnectGraceSeconds ?? disconnectedSession.reconnectGraceSeconds ?? 5),
  );
  const requestedStallMs = Math.max(
    150,
    Math.min(750, Math.floor(reconnectGraceSeconds * 1_000 * 0.35)),
  );
  const cdp = await page1.context().newCDPSession(page1);
  let scriptExecutionDisabled = false;
  const stallStartedAt = Date.now();
  try {
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    scriptExecutionDisabled = true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, requestedStallMs));
  } finally {
    if (scriptExecutionDisabled) {
      await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
    }
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await cdp.detach();
  }
  const observedStallMs = Date.now() - stallStartedAt;
  const freshTimerAfterResume = await page1.evaluate(async () => await new Promise<boolean>(
    (resolveTimer) => setTimeout(() => resolveTimer(true), 20),
  ));

  await page1.evaluate(async () => {
    const runtime = window.gravityWellPeerSmoke;
    if (!runtime) {
      throw new Error('Peer runtime is unavailable.');
    }
    await runtime.resume('visibility_visible');
  });
  const reconnectedSession = await waitForRunnerSession(
    apiBaseUrl,
    account2,
    match1,
    timeoutMs,
    (session) => session.participants?.every((participant) => (
      participant.connectionStatus === 'connected'
    )) === true,
  );
  const serverReconnectObserved = reconnectedSession.participants?.find(
    (participant) => participant.accountId === account1.id,
  )?.connectionStatus === 'connected';

  const postResumeAcknowledgements = await Promise.all([
    page1.evaluate(async ({ input }) => {
      const runtime = window.gravityWellPeerSmoke;
      if (!runtime) {
        throw new Error('Peer runtime is unavailable.');
      }
      return await runtime.submitFrame(2, 0, input);
    }, { input: createRunnerFrameInput(0.5, false) }),
    page2.evaluate(async ({ input }) => {
      const runtime = window.gravityWellPeerSmoke;
      if (!runtime) {
        throw new Error('Peer runtime is unavailable.');
      }
      return await runtime.submitFrame(2, 0, input);
    }, { input: createRunnerFrameInput(-0.5, true) }),
  ]);
  const [receivedBy1, receivedBy2] = await Promise.all([
    page1.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(2, -1)),
    page2.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(2, -1)),
  ]) as [RunnerPeerPollResult, RunnerPeerPollResult];
  await Promise.all([
    page1.evaluate(async () => await window.gravityWellPeerSmoke?.confirmFrames(2, 0)),
    page2.evaluate(async () => await window.gravityWellPeerSmoke?.confirmFrames(2, 0)),
  ]);
  let postResumeConfirmations: [number, number] = [-1, -1];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    const [confirmation1, confirmation2] = await Promise.all([
      page1.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(2, 0)),
      page2.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(2, 0)),
    ]) as [RunnerPeerPollResult, RunnerPeerPollResult];
    postResumeConfirmations = [
      confirmation1.peerConfirmedThrough,
      confirmation2.peerConfirmedThrough,
    ];
    if (postResumeConfirmations[0] === 0 && postResumeConfirmations[1] === 0) {
      break;
    }
  }

  const lifecycleDiagnostics = await Promise.all([
    readPageLifecycleDiagnostics(page1),
    readPageLifecycleDiagnostics(page2),
  ]) as [PeerSmokeLifecycleDiagnostics, PeerSmokeLifecycleDiagnostics];
  const transportDiagnostics = await Promise.all([
    readPageTransportDiagnostics(page1),
    readPageTransportDiagnostics(page2),
  ]) as [PeerSmokeTransportDiagnostics, PeerSmokeTransportDiagnostics];

  return {
    schemaVersion: 'gw.webrtc-two-client-lifecycle-stall.v1',
    suspendedAccountId: account1.id,
    requestedStallMs,
    observedStallMs,
    scriptExecutionDisabled,
    freshTimerAfterResume,
    serverDisconnectObserved,
    peerStayedConnected,
    serverReconnectObserved,
    lifecycleDiagnostics,
    postResumeAcknowledgedFrames: postResumeAcknowledgements.map(Number),
    postResumeReceivedFrameAccounts: [
      receivedBy1.frames[0]?.accountId ?? null,
      receivedBy2.frames[0]?.accountId ?? null,
    ],
    postResumePeerConfirmations: postResumeConfirmations,
    transportDiagnostics,
  };
}

async function runTwoClientBrowserSmoke(
  browser: Browser,
  webUrl: string,
  apiBaseUrl: string,
  timeoutMs: number,
  forceRelay: boolean,
  soakOptions: BrowserSoakOptions,
  buildVersion: string,
): Promise<TwoClientBrowserSmokeReport> {
  const [account1, account2] = await Promise.all([
    createRunnerAccount(apiBaseUrl),
    createRunnerAccount(apiBaseUrl),
  ]);
  const ticket1 = await joinRunnerQueue(apiBaseUrl, account1, 'vanguard', buildVersion);
  const ticket2 = await joinRunnerQueue(apiBaseUrl, account2, 'duelist', buildVersion);
  const [match1, match2] = await Promise.all([
    resolveRunnerMatch(apiBaseUrl, account1, ticket1),
    resolveRunnerMatch(apiBaseUrl, account2, ticket2),
  ]);
  if (
    match1.sessionId !== match2.sessionId
    || match1.localPlayer.accountId !== account1.id
    || match2.localPlayer.accountId !== account2.id
  ) {
    throw new Error('Two-client peers did not receive consistent account/session bindings.');
  }
  const [iceConfig1, iceConfig2] = await Promise.all([
    requestRunnerIceConfig(apiBaseUrl, account1, match1, forceRelay),
    requestRunnerIceConfig(apiBaseUrl, account2, match2, forceRelay),
  ]);
  const rtcConfig1 = buildLocalSmokeRtcConfiguration(iceConfig1, forceRelay);
  const rtcConfig2 = buildLocalSmokeRtcConfiguration(iceConfig2, forceRelay);

  const peerUrl = new URL('/webrtc-peer-smoke.html', webUrl).toString();
  const consoleMessages: [string[], string[]] = [[], []];
  const pageErrors: [string[], string[]] = [[], []];
  let page1: Page | null = null;
  let page2: Page | null = null;

  try {
    [page1, page2] = await Promise.all([browser.newPage(), browser.newPage()]);
    page1.on('console', (message) => recordConsoleMessage(consoleMessages[0], message));
    page2.on('console', (message) => recordConsoleMessage(consoleMessages[1], message));
    page1.on('pageerror', (error) => pageErrors[0].push(error.stack ?? error.message));
    page2.on('pageerror', (error) => pageErrors[1].push(error.stack ?? error.message));
    await Promise.all([
      page1.goto(peerUrl, { waitUntil: 'networkidle', timeout: timeoutMs }),
      page2.goto(peerUrl, { waitUntil: 'networkidle', timeout: timeoutMs }),
    ]);
    await Promise.all([
      page1.waitForFunction(
        () => typeof window.gravityWellPeerSmoke?.connect === 'function',
        undefined,
        { timeout: timeoutMs },
      ),
      page2.waitForFunction(
        () => typeof window.gravityWellPeerSmoke?.connect === 'function',
        undefined,
        { timeout: timeoutMs },
      ),
    ]);

    const isolationKey = `gravity-well-two-client-${Date.now()}`;
    await page1.evaluate((key) => localStorage.setItem(key, 'peer-1'), isolationKey);
    const leakedToPeer2 = await page2.evaluate((key) => localStorage.getItem(key), isolationKey);
    await page2.evaluate((key) => localStorage.setItem(key, 'peer-2'), isolationKey);
    const [peer1Marker, peer2Marker] = await Promise.all([
      page1.evaluate((key) => localStorage.getItem(key), isolationKey),
      page2.evaluate((key) => localStorage.getItem(key), isolationKey),
    ]);
    const isolatedBrowserContexts = leakedToPeer2 === null
      && peer1Marker === 'peer-1'
      && peer2Marker === 'peer-2';
    if (!isolatedBrowserContexts) {
      throw new Error('Two-client pages shared browser storage instead of isolated contexts.');
    }

    const [identity1, identity2] = await Promise.all([
      page1.evaluate(async (options) => {
        const runtime = window.gravityWellPeerSmoke;
        if (!runtime) {
          throw new Error('Peer runtime is unavailable.');
        }
        return await runtime.connect(options);
      }, { apiBaseUrl, account: account1, match: match1, iceConfig: rtcConfig1 }),
      page2.evaluate(async (options) => {
        const runtime = window.gravityWellPeerSmoke;
        if (!runtime) {
          throw new Error('Peer runtime is unavailable.');
        }
        return await runtime.connect(options);
      }, { apiBaseUrl, account: account2, match: match2, iceConfig: rtcConfig2 }),
    ]) as [RunnerPeerIdentity, RunnerPeerIdentity];
    if (
      identity1.localAccountId !== account1.id
      || identity1.remoteAccountId !== account2.id
      || identity2.localAccountId !== account2.id
      || identity2.remoteAccountId !== account1.id
      || identity1.sessionId !== match1.sessionId
      || identity2.sessionId !== match1.sessionId
    ) {
      throw new Error('Two-client page runtime reported an invalid peer identity binding.');
    }

    const acknowledgements = await Promise.all([
      page1.evaluate(async ({ input }) => {
        const runtime = window.gravityWellPeerSmoke;
        if (!runtime) {
          throw new Error('Peer runtime is unavailable.');
        }
        return await runtime.submitFrame(0, 0, input);
      }, { input: createRunnerFrameInput(1, true) }),
      page2.evaluate(async ({ input }) => {
        const runtime = window.gravityWellPeerSmoke;
        if (!runtime) {
          throw new Error('Peer runtime is unavailable.');
        }
        return await runtime.submitFrame(0, 0, input);
      }, { input: createRunnerFrameInput(-1, false) }),
    ]);
    const [receivedBy1, receivedBy2] = await Promise.all([
      page1.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(0, -1)),
      page2.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(0, -1)),
    ]) as [RunnerPeerPollResult, RunnerPeerPollResult];
    if (
      receivedBy1.frames[0]?.accountId !== account2.id
      || receivedBy2.frames[0]?.accountId !== account1.id
    ) {
      throw new Error('Two-client DataChannel routing did not preserve remote account identity.');
    }

    await Promise.all([
      page1.evaluate(async () => await window.gravityWellPeerSmoke?.confirmFrames(0, 0)),
      page2.evaluate(async () => await window.gravityWellPeerSmoke?.confirmFrames(0, 0)),
    ]);
    let confirmations: [number, number] = [-1, -1];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const [confirmation1, confirmation2] = await Promise.all([
        page1.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(0, 0)),
        page2.evaluate(async () => await window.gravityWellPeerSmoke?.pollFrames(0, 0)),
      ]) as [RunnerPeerPollResult, RunnerPeerPollResult];
      confirmations = [confirmation1.peerConfirmedThrough, confirmation2.peerConfirmedThrough];
      if (confirmations[0] === 0 && confirmations[1] === 0) {
        break;
      }
    }
    if (confirmations[0] !== 0 || confirmations[1] !== 0) {
      throw new Error('Two-client confirmation handshake did not converge through frame 0.');
    }

    const rollbackSoak = soakOptions.enabled
      ? await runTwoClientRollbackSoak(
        page1,
        page2,
        identity1,
        identity2,
        account1,
        account2,
        soakOptions,
      )
      : null;
    if (rollbackSoak && !rollbackSoak.passed) {
      throw new Error(`Two-client rollback soak failed: ${rollbackSoak.failures.join('; ')}`);
    }

    const lifecycleStall = await runTwoClientLifecycleStall(
      page1,
      page2,
      apiBaseUrl,
      account1,
      account2,
      match1,
      timeoutMs,
    );

    const firstCompletion = await requestRunnerJson<RunnerSmokeSession>(
      apiBaseUrl,
      '/matchmaking/sessions/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: match1.sessionId, sessionToken: match1.sessionToken }),
      },
      account1.accessToken,
    );
    const completion = await requestRunnerJson<RunnerSmokeSession>(
      apiBaseUrl,
      '/matchmaking/sessions/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: match2.sessionId, sessionToken: match2.sessionToken }),
      },
      account2.accessToken,
    );
    const completionResolved = firstCompletion.status === 'active'
      && completion.status === 'resolved'
      && completion.resolvedReason === 'completed';
    if (!completionResolved) {
      throw new Error('Two-client completion attestations did not resolve the session.');
    }

    const unexpectedConsoleErrors = consoleMessages.flat().filter((entry) => entry.startsWith('[error]'));
    const flattenedPageErrors = pageErrors.flat();
    if (unexpectedConsoleErrors.length > 0 || flattenedPageErrors.length > 0) {
      throw new Error([
        ...flattenedPageErrors.map((entry) => `pageerror: ${entry}`),
        ...unexpectedConsoleErrors,
      ].join('\n'));
    }
    const transportDiagnostics = await Promise.all([
      readPageTransportDiagnostics(page1),
      readPageTransportDiagnostics(page2),
    ]) as [PeerSmokeTransportDiagnostics, PeerSmokeTransportDiagnostics];

    return {
      schemaVersion: 'gw.webrtc-two-client-smoke.v5',
      forceRelayRequested: forceRelay,
      buildVersion,
      isolatedBrowserContexts,
      pageCount: 2,
      sessionId: match1.sessionId,
      accounts: [account1.id, account2.id],
      sides: [identity1.side, identity2.side],
      connectionPaths: [identity1.connectionPath, identity2.connectionPath],
      relayAvailable: iceConfig1.relayAvailable && iceConfig2.relayAvailable,
      iceTransportPolicies: [iceConfig1.iceTransportPolicy, iceConfig2.iceTransportPolicy],
      turnCredentialModes: [iceConfig1.turnCredentialMode, iceConfig2.turnCredentialMode],
      acknowledgedFrames: acknowledgements.map(Number),
      receivedFrameAccounts: [
        receivedBy1.frames[0]?.accountId ?? null,
        receivedBy2.frames[0]?.accountId ?? null,
      ],
      peerConfirmations: confirmations,
      completionResolved,
      consoleErrorCount: unexpectedConsoleErrors.length,
      pageErrorCount: flattenedPageErrors.length,
      transportDiagnostics,
      rollbackSoak,
      lifecycleStall,
    };
  } finally {
    await Promise.all([
      page1?.evaluate(() => window.gravityWellPeerSmoke?.close()).catch(() => undefined),
      page2?.evaluate(() => window.gravityWellPeerSmoke?.close()).catch(() => undefined),
    ]);
    await Promise.all([
      page1?.close().catch(() => undefined),
      page2?.close().catch(() => undefined),
    ]);
  }
}

async function run(): Promise<void> {
  const webUrl = String(process.env.WEBRTC_SMOKE_URL ?? DEFAULT_WEB_URL).trim();
  const apiBaseUrl = String(
    process.env.WEBRTC_BROWSER_SMOKE_API_BASE_URL
    ?? process.env.API_BASE_URL
    ?? DEFAULT_API_BASE_URL
  ).trim().replace(/\/+$/, '');
  const timeoutMs = parseTimeout(process.env.WEBRTC_BROWSER_SMOKE_TIMEOUT_MS);
  const forceRelay = parseBooleanFlag(
    'WEBRTC_BROWSER_SMOKE_FORCE_RELAY',
    process.env.WEBRTC_BROWSER_SMOKE_FORCE_RELAY,
  );
  const soakOptions = parseSoakOptions();
  const releaseIdentity = resolveWebRtcSoakReleaseIdentity({
    configuredBuildVersion: process.env.WEBRTC_BROWSER_SMOKE_BUILD_VERSION,
    expectedReleaseSha: process.env.WEBRTC_BROWSER_SMOKE_EXPECT_RELEASE_SHA,
    fallbackBuildVersion: `webrtc-two-client-smoke-${Date.now()}`,
  });
  const screenshotPath = resolve(
    process.env.WEBRTC_BROWSER_SMOKE_FAILURE_SCREENSHOT ?? DEFAULT_FAILURE_SCREENSHOT,
  );
  const executablePath = resolveBrowserExecutable();
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    await assertSafeSmokeTarget(apiBaseUrl);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    page = await browser.newPage();
    page.on('console', (message) => recordConsoleMessage(consoleMessages, message));
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

    const harnessUrl = new URL(webUrl);
    if (forceRelay) {
      harnessUrl.searchParams.set('forceRelay', '1');
    }
    await page.goto(harnessUrl.toString(), { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.locator('#api-base').fill(apiBaseUrl);
    await page.locator('#run-smoke').click();
    const result = page.locator('#result');
    await result.waitFor({ state: 'visible', timeout: timeoutMs });
    await page.waitForFunction(
      () => {
        const element = document.querySelector('#result');
        return element?.classList.contains('pass') || element?.classList.contains('fail');
      },
      undefined,
      { timeout: timeoutMs },
    );

    const status = await result.getAttribute('class');
    const rawResult = (await result.textContent())?.trim() ?? '';
    if (status?.split(/\s+/).includes('fail')) {
      throw new Error(`Browser harness failed:\n${rawResult}`);
    }

    let report: BrowserSmokeReport;
    try {
      report = JSON.parse(rawResult) as BrowserSmokeReport;
    } catch {
      throw new Error(`Browser harness returned invalid JSON: ${rawResult}`);
    }
    if (report.schemaVersion !== 'gw.webrtc-browser-core-smoke.v2') {
      throw new Error(`Browser harness returned an unsupported core schema: ${report.schemaVersion ?? 'missing'}`);
    }
    const twoClient = await runTwoClientBrowserSmoke(
      browser,
      webUrl,
      apiBaseUrl,
      timeoutMs,
      forceRelay,
      soakOptions,
      releaseIdentity.buildVersion,
    );
    report = {
      ...report,
      schemaVersion: 'gw.webrtc-browser-smoke.v8',
      expectedReleaseSha: releaseIdentity.expectedReleaseSha,
      twoClient,
    };
    validateReport(report, forceRelay, soakOptions, releaseIdentity.buildVersion);

    const unexpectedConsoleErrors = consoleMessages.filter((entry) => (
      entry.startsWith('[error]') && !isExpectedStaleAttemptConflict(entry)
    ));
    if (pageErrors.length > 0 || unexpectedConsoleErrors.length > 0) {
      throw new Error([
        ...pageErrors.map((entry) => `pageerror: ${entry}`),
        ...unexpectedConsoleErrors,
      ].join('\n'));
    }

    const output = {
      ...report,
      generatedAt: new Date().toISOString(),
      forceRelayExpected: forceRelay,
      webUrl,
      apiBaseUrl,
      browserExecutable: executablePath,
      consoleMessages,
      pageErrors,
    };
    writeJsonReport(soakOptions.outputPath, output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    await captureFailure(page, screenshotPath);
    const failure = {
      schemaVersion: 'gw.webrtc-browser-smoke.v8',
      generatedAt: new Date().toISOString(),
      ok: false,
      forceRelayExpected: forceRelay,
      expectedReleaseSha: releaseIdentity.expectedReleaseSha,
      soakRequested: soakOptions.enabled,
      webUrl,
      apiBaseUrl,
      browserExecutable: executablePath,
      failureScreenshot: screenshotPath,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      consoleMessages,
      pageErrors,
    };
    writeJsonReport(soakOptions.outputPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

void run();
