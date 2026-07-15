import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { assertLocalDatabaseTarget } from '../src/databaseTarget';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, '../../..');
const apiWorkspaceRoot = path.resolve(repositoryRoot, 'apps/api');
const artifactDir = path.resolve(repositoryRoot, 'apps/api/build-artifacts/local-alpha-integration');
const latestReportPath = path.join(artifactDir, 'report.json');
const MAX_CAPTURED_LOG_BYTES = 1_000_000;
const LOCAL_COTURN_IMAGE = 'coturn/coturn:4.6.3';

interface StepResult {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

interface ManagedProcess {
  label: string;
  child: ChildProcessByStdio<null, Readable, Readable>;
  stdout: string;
  stderr: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface LocalAlphaOptions {
  withCoturn: boolean;
}

interface LocalCoturnConfig {
  containerName: string;
  sharedSecret: string;
  hostPort: number;
  relayPortStart: number;
  relayPortEnd: number;
}

function parseOptions(args: string[]): LocalAlphaOptions {
  const unsupported = args.filter((value) => value !== '--with-coturn');
  if (unsupported.length > 0) {
    throw new Error(`Unsupported local alpha integration option(s): ${unsupported.join(', ')}.`);
  }
  return { withCoturn: args.includes('--with-coturn') };
}

function parsePort(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1024 and 65535.`);
  }
  return parsed;
}

function appendCapturedLog(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length <= MAX_CAPTURED_LOG_BYTES
    ? next
    : next.slice(next.length - MAX_CAPTURED_LOG_BYTES);
}

function tail(value: string, length = 8_000): string {
  return value.length <= length ? value : value.slice(value.length - length);
}

function runCommand(
  label: string,
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    echo?: boolean;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs ?? 60_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendCapturedLog(stdout, chunk);
      if (options.echo !== false) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCapturedLog(stderr, chunk);
      if (options.echo !== false) {
        process.stderr.write(chunk);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${label} could not start: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = timedOut
        ? `timed out after ${options.timeoutMs ?? 60_000}ms`
        : `exited with code ${String(code)}${signal ? ` (${signal})` : ''}`;
      reject(new Error([
        `${label} ${reason}.`,
        tail(stderr || stdout),
      ].filter(Boolean).join('\n')));
    });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen(port, '0.0.0.0', () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

async function assertPortsAvailable(ports: Record<string, number>): Promise<void> {
  const values = Object.values(ports);
  if (new Set(values).size !== values.length) {
    throw new Error(`Local alpha integration ports must be distinct: ${JSON.stringify(ports)}.`);
  }
  for (const [label, port] of Object.entries(ports)) {
    if (!await isPortAvailable(port)) {
      throw new Error(`${label} port ${port} is already in use. Override its LOCAL_ALPHA_*_PORT value.`);
    }
  }
}

function assertTurnPortRange(
  ports: Record<string, number>,
  turnPort: number,
  relayPortStart: number,
  relayPortEnd: number,
): void {
  if (relayPortEnd < relayPortStart) {
    throw new Error('LOCAL_ALPHA_TURN_RELAY_PORT_END must be greater than or equal to the start port.');
  }
  if (relayPortEnd - relayPortStart + 1 < 4) {
    throw new Error('The local TURN relay range must contain at least four ports for concurrent peers.');
  }
  for (const [label, port] of Object.entries(ports)) {
    if (port === turnPort || (port >= relayPortStart && port <= relayPortEnd)) {
      throw new Error(`${label} port ${port} overlaps the local TURN listener or relay range.`);
    }
  }
  if (turnPort >= relayPortStart && turnPort <= relayPortEnd) {
    throw new Error(`Local TURN listener port ${turnPort} overlaps its relay range.`);
  }
}

async function waitForTcpPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(500, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
    if (connected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local TURN relay did not become ready on 127.0.0.1:${port} within ${timeoutMs}ms.`);
}

async function startLocalCoturn(config: LocalCoturnConfig): Promise<void> {
  await runCommand(
    'Local TURN relay startup',
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      config.containerName,
      '--publish',
      `${config.hostPort}:3478/tcp`,
      '--publish',
      `${config.hostPort}:3478/udp`,
      '--publish',
      `${config.relayPortStart}-${config.relayPortEnd}:${config.relayPortStart}-${config.relayPortEnd}/udp`,
      LOCAL_COTURN_IMAGE,
      '-n',
      '--log-file=stdout',
      '--fingerprint',
      '--use-auth-secret',
      `--static-auth-secret=${config.sharedSecret}`,
      '--realm=gravity-well.local',
      `--min-port=${config.relayPortStart}`,
      `--max-port=${config.relayPortEnd}`,
      '--external-ip=127.0.0.1',
      '--allow-loopback-peers',
      '--no-tls',
      '--no-dtls',
      '--no-cli',
    ],
    { timeoutMs: 120_000 },
  );
  await waitForTcpPort(config.hostPort);
}

async function stopLocalCoturn(containerName: string): Promise<void> {
  try {
    await runCommand(
      'Local TURN relay cleanup',
      'docker',
      ['container', 'rm', '--force', containerName],
      { echo: false, timeoutMs: 30_000 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('No such container')) {
      throw error;
    }
  }
}

async function captureLocalCoturnLogs(containerName: string): Promise<void> {
  try {
    const logs = await runCommand(
      'Local TURN relay log capture',
      'docker',
      ['container', 'logs', containerName],
      { echo: false, timeoutMs: 15_000 },
    );
    writeFileSync(path.join(artifactDir, 'coturn.log'), logs.stdout + logs.stderr);
  } catch {
    // A crashed --rm container may already be gone; the browser failure remains authoritative.
  }
}

async function canConnectDatabase(databaseUrl: string): Promise<boolean> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 1_000,
  });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function waitForDatabase(databaseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectDatabase(databaseUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local PostgreSQL did not become ready within ${timeoutMs}ms.`);
}

async function ensureLocalDatabase(databaseUrl: string): Promise<boolean> {
  if (await canConnectDatabase(databaseUrl)) {
    return false;
  }
  if (process.env.LOCAL_ALPHA_MANAGE_POSTGRES === '0') {
    throw new Error(
      'Local PostgreSQL is unavailable and LOCAL_ALPHA_MANAGE_POSTGRES=0 prevents Docker startup.',
    );
  }

  let postgresWasRunning = false;
  try {
    const state = await runCommand(
      'Docker Compose state check',
      'docker',
      ['compose', 'ps', '--status', 'running', '--services'],
      { echo: false, timeoutMs: 15_000 },
    );
    postgresWasRunning = state.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .includes('postgres');
  } catch {
    postgresWasRunning = false;
  }

  await runCommand(
    'Local PostgreSQL startup',
    'docker',
    ['compose', 'up', '-d', 'postgres'],
    { timeoutMs: 60_000 },
  );
  await waitForDatabase(databaseUrl);
  return !postgresWasRunning;
}

function spawnManagedProcess(
  label: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ManagedProcess {
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const managed: ManagedProcess = { label, child, stdout: '', stderr: '' };
  child.stdout.on('data', (chunk: Buffer) => {
    managed.stdout = appendCapturedLog(managed.stdout, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    managed.stderr = appendCapturedLog(managed.stderr, chunk);
  });
  return managed;
}

async function stopManagedProcess(managed: ManagedProcess | null): Promise<void> {
  if (!managed || managed.child.exitCode !== null) {
    return;
  }
  managed.child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => managed.child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (managed.child.exitCode === null) {
    managed.child.kill('SIGKILL');
  }
}

async function waitForHttp(
  label: string,
  url: string,
  managed: ManagedProcess,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (managed.child.exitCode !== null) {
      throw new Error([
        `${label} exited before becoming ready.`,
        tail(managed.stderr || managed.stdout),
      ].join('\n'));
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The process may still be binding its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs}ms.`);
}

async function recordStep<T>(
  steps: StepResult[],
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  console.log(`[local-alpha] ${name}`);
  try {
    const result = await action();
    steps.push({ name, status: 'passed', durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ name, status: 'failed', durationMs: Date.now() - startedAt, error: message });
    throw error;
  }
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = String(
    process.env.LOCAL_DATABASE_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:5432/gravity_well',
  ).trim();
  assertLocalDatabaseTarget(databaseUrl, 'Local alpha integration');

  const ports = {
    api: parsePort('LOCAL_ALPHA_API_PORT', 28_787),
    web: parsePort('LOCAL_ALPHA_WEB_PORT', 25_191),
    restart: parsePort('LOCAL_ALPHA_RESTART_PORT', 28_791),
    multiA: parsePort('LOCAL_ALPHA_MULTI_PORT_A', 28_792),
    multiB: parsePort('LOCAL_ALPHA_MULTI_PORT_B', 28_793),
  };
  const turnConfig: LocalCoturnConfig = {
    containerName: `gravity-well-coturn-${process.pid}-${Date.now()}`,
    sharedSecret: randomBytes(32).toString('hex'),
    hostPort: parsePort('LOCAL_ALPHA_TURN_PORT', 23_478),
    relayPortStart: parsePort('LOCAL_ALPHA_TURN_RELAY_PORT_START', 49_160),
    relayPortEnd: parsePort('LOCAL_ALPHA_TURN_RELAY_PORT_END', 49_179),
  };
  assertTurnPortRange(
    ports,
    turnConfig.hostPort,
    turnConfig.relayPortStart,
    turnConfig.relayPortEnd,
  );
  const apiBaseUrl = `http://127.0.0.1:${ports.api}`;
  const webBaseUrl = `http://127.0.0.1:${ports.web}`;
  const runtimeNamespace = `smoke:local-alpha-${process.pid}-${Date.now()}`;
  const databaseApplicationName = `gravity-well-local-alpha-${process.pid}`;
  const authSessionSecret = 'local-alpha-auth-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
  const authRateLimitSecret = `local-alpha-auth-rate-limit-${process.pid}-${Date.now()}-0123456789abcdef`;
  const smokeTargetEnv: NodeJS.ProcessEnv = {
    SMOKE_EXPECT_API_HOSTNAME: '127.0.0.1',
    SMOKE_EXPECT_DATABASE_ID: 'local',
    SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT: 'test',
  };
  const sharedEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: databaseUrl,
    AUTH_SESSION_SECRET: authSessionSecret,
    AUTH_RATE_LIMIT_SECRET: authRateLimitSecret,
    ...smokeTargetEnv,
  };
  const steps: StepResult[] = [];
  let apiProcess: ManagedProcess | null = null;
  let webProcess: ManagedProcess | null = null;
  let startedPostgres = false;
  let coturnStartedByRunner = false;
  let coturnActive = false;
  let failure: string | null = null;

  mkdirSync(artifactDir, { recursive: true });

  try {
    await recordStep(steps, 'check isolated ports', () => assertPortsAvailable({
      ...ports,
      turn: turnConfig.hostPort,
    }));

    if (process.env.LOCAL_ALPHA_SKIP_BUILD !== '1') {
      const npmCliPath = process.env.npm_execpath?.trim();
      if (!npmCliPath) {
        throw new Error(
          'npm_execpath is unavailable. Start this runner with `npm run alpha:local-integration`.',
        );
      }
      await recordStep(steps, 'build production web client', () => runCommand(
        'Production web build',
        process.execPath,
        [npmCliPath, 'run', 'build', '--workspace', '@gravity-well/game-web'],
        {
          env: {
            VITE_APP_ENV: 'production',
            VITE_FEATURE_ONLINE: 'true',
            VITE_FEATURE_RANKED: 'true',
            VITE_FEATURE_ONLINE_MATCH_RUNTIME: 'true',
            VITE_FEATURE_DEBUG_TOOLS: 'false',
            VITE_FEATURE_ONLINE_DIAGNOSTICS: 'false',
            VITE_FEATURE_ONLINE_DEV_MENU: 'false',
            VITE_PROFILE_API_BASE: apiBaseUrl,
            VITE_MATCHMAKING_API_BASE: apiBaseUrl,
            VITE_APP_BUILD: 'local-ranked-root-smoke',
            VITE_LOCAL_RANKED_ROOT_SMOKE: 'true',
          },
          timeoutMs: 180_000,
        },
      ));
    }

    startedPostgres = await recordStep(
      steps,
      'prepare local PostgreSQL',
      () => ensureLocalDatabase(databaseUrl),
    );
    await recordStep(steps, 'apply local migrations', () => runCommand(
      'Local migrations',
      process.execPath,
      ['--import', 'tsx', 'scripts/migrate.ts'],
      { cwd: apiWorkspaceRoot, env: sharedEnv, timeoutMs: 60_000 },
    ));
    await recordStep(steps, 'durable authentication rate-limit smoke', () => runCommand(
      'Authentication rate-limit smoke',
      process.execPath,
      ['--import', 'tsx', 'scripts/authRateLimitSmoke.ts'],
      { cwd: apiWorkspaceRoot, env: sharedEnv, timeoutMs: 30_000 },
    ));
    await recordStep(steps, 'ranked season transition smoke', () => runCommand(
      'Ranked season transition smoke',
      process.execPath,
      ['--import', 'tsx', 'scripts/rankedSeasonTransitionSmoke.ts'],
      {
        cwd: apiWorkspaceRoot,
        env: {
          ...sharedEnv,
          RANKED_SEASON_TRANSITION_SMOKE_REPORT_PATH: path.join(
            artifactDir,
            'ranked-season-transition.json',
          ),
        },
        timeoutMs: 30_000,
      },
    ));

    await recordStep(steps, 'start ephemeral local TURN fallback', async () => {
      await startLocalCoturn(turnConfig);
      coturnStartedByRunner = true;
      coturnActive = true;
    });

    apiProcess = spawnManagedProcess(
      'local API',
      ['--import', 'tsx', 'apps/api/src/server.ts'],
      {
        ...sharedEnv,
        PORT: String(ports.api),
        NODE_ENV: 'test',
        MATCHMAKING_ACCESS_MODE: 'open',
        MATCHMAKING_RECONNECT_GRACE_SECONDS: '20',
        MATCHMAKING_SNAPSHOT_INTERVAL_MS: '60000',
        MATCHMAKING_RUNTIME_NAMESPACE: runtimeNamespace,
        PGAPPNAME: databaseApplicationName,
        MATCHMAKING_STUN_URLS: '',
        MATCHMAKING_TURN_URLS: `turn:127.0.0.1:${turnConfig.hostPort}?transport=udp`,
        MATCHMAKING_TURN_SHARED_SECRET: turnConfig.sharedSecret,
        MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS: '300',
      },
    );
    webProcess = spawnManagedProcess(
      'production web preview',
      [
        path.resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'),
        'preview',
        'apps/game-web',
        '--host',
        '127.0.0.1',
        '--port',
        String(ports.web),
        '--strictPort',
      ],
      {},
    );
    await recordStep(steps, 'start isolated API and production preview', async () => {
      await Promise.all([
        waitForHttp('Local API', `${apiBaseUrl}/health`, apiProcess as ManagedProcess),
        waitForHttp(
          'Production web preview',
          `${webBaseUrl}/`,
          webProcess as ManagedProcess,
        ),
      ]);
    });

    await recordStep(steps, 'authentication ownership and abuse smoke', () => runCommand(
      'Authentication security smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/api/scripts/authSecuritySmoke.ts'],
      {
        env: { ...sharedEnv, API_BASE_URL: apiBaseUrl },
        timeoutMs: 30_000,
      },
    ));
    await recordStep(steps, 'ranked proof-consensus smoke', () => runCommand(
      'Ranked online smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/api/scripts/rankedOnlineSmoke.ts'],
      {
        env: {
          ...smokeTargetEnv,
          API_BASE_URL: apiBaseUrl,
          ONLINE_SMOKE_WAIT_SECONDS: '0',
        },
        timeoutMs: 60_000,
      },
    ));
    await recordStep(steps, 'archived Master leaderboard region smoke', () => runCommand(
      'Archived Master leaderboard smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/api/scripts/archivedMasterLeaderboardSmoke.ts'],
      {
        env: {
          ...sharedEnv,
          API_BASE_URL: apiBaseUrl,
          ARCHIVED_MASTER_LEADERBOARD_SMOKE_REPORT_PATH: path.join(
            artifactDir,
            'archived-master-leaderboard.json',
          ),
        },
        timeoutMs: 30_000,
      },
    ));
    await recordStep(steps, 'server-authoritative forfeit smoke', () => runCommand(
      'Authoritative forfeit smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/api/scripts/rankedAuthoritativeForfeitSmoke.ts'],
      {
        env: {
          ...sharedEnv,
          API_BASE_URL: apiBaseUrl,
          AUTHORITATIVE_FORFEIT_SMOKE_TIMEOUT_MS: '30000',
        },
        timeoutMs: 30_000,
      },
    ));
    await recordStep(steps, options.withCoturn
      ? 'forced-relay browser rollback, reconnect, and isolated two-client short soak'
      : 'real-browser rollback, reconnect, and isolated two-client short soak', () => runCommand(
      'WebRTC browser smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/game-web/scripts/webrtc-browser-smoke.ts'],
      {
        env: {
          API_BASE_URL: apiBaseUrl,
          WEBRTC_SMOKE_URL: `${webBaseUrl}/webrtc-smoke.html`,
          WEBRTC_BROWSER_SMOKE_TIMEOUT_MS: options.withCoturn ? '60000' : '30000',
          WEBRTC_BROWSER_SOAK_DURATION_SECONDS: '1',
          WEBRTC_BROWSER_SMOKE_REPORT_PATH: path.join(
            artifactDir,
            options.withCoturn ? 'webrtc-browser-relay.json' : 'webrtc-browser-direct.json',
          ),
          ...(options.withCoturn ? { WEBRTC_BROWSER_SMOKE_FORCE_RELAY: '1' } : {}),
        },
        timeoutMs: options.withCoturn ? 120_000 : 60_000,
      },
    ));

    await recordStep(steps, options.withCoturn
      ? 'forced-relay two-browser ranked smoke through production root'
      : 'direct two-browser ranked smoke through production root', () => runCommand(
      'Ranked root browser smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/game-web/scripts/ranked-root-browser-smoke.ts'],
      {
        env: {
          ...smokeTargetEnv,
          API_BASE_URL: apiBaseUrl,
          RANKED_ROOT_SMOKE_URL: `${webBaseUrl}/`,
          RANKED_ROOT_BROWSER_SMOKE_TIMEOUT_MS: '180000',
          RANKED_ROOT_BROWSER_SMOKE_REPORT_PATH: path.join(
            artifactDir,
            options.withCoturn ? 'ranked-root-relay.json' : 'ranked-root-direct.json',
          ),
          ...(options.withCoturn ? { RANKED_ROOT_BROWSER_SMOKE_FORCE_RELAY: '1' } : {}),
        },
        timeoutMs: 240_000,
      },
    ));

    await recordStep(steps, 'database connection interruption and pool recovery smoke', async () => {
      const liveApiProcess = apiProcess;
      if (!liveApiProcess || liveApiProcess.child.exitCode !== null) {
        throw new Error('Local API was not running before the database interruption smoke.');
      }
      await runCommand(
        'Database interruption smoke',
        process.execPath,
        ['--import', 'tsx', 'apps/api/scripts/databaseInterruptionSmoke.ts'],
        {
          env: {
            ...sharedEnv,
            API_BASE_URL: apiBaseUrl,
            DATABASE_INTERRUPTION_TARGET_APP_NAME: databaseApplicationName,
            DATABASE_INTERRUPTION_SMOKE_REPORT_PATH: path.join(
              artifactDir,
              'database-interruption.json',
            ),
          },
          timeoutMs: 30_000,
        },
      );
      if (liveApiProcess.child.exitCode !== null) {
        throw new Error('Local API exited during the database interruption smoke.');
      }
    });

    await recordStep(steps, 'stop ephemeral local TURN relay', async () => {
      await captureLocalCoturnLogs(turnConfig.containerName);
      await stopLocalCoturn(turnConfig.containerName);
      coturnActive = false;
    });

    await stopManagedProcess(webProcess);
    await stopManagedProcess(apiProcess);

    await recordStep(steps, 'matchmaking process-replacement smoke', () => runCommand(
      'Matchmaking restart smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/api/scripts/matchmakingRestartSmoke.ts'],
      {
        env: {
          ...sharedEnv,
          MATCHMAKING_RESTART_SMOKE_PORT: String(ports.restart),
        },
        timeoutMs: 90_000,
      },
    ));
    await recordStep(steps, 'concurrent API-instance smoke', () => runCommand(
      'Matchmaking multi-instance smoke',
      process.execPath,
      ['--import', 'tsx', 'apps/api/scripts/matchmakingMultiInstanceSmoke.ts'],
      {
        env: {
          ...sharedEnv,
          MATCHMAKING_MULTI_INSTANCE_SMOKE_PORT_A: String(ports.multiA),
          MATCHMAKING_MULTI_INSTANCE_SMOKE_PORT_B: String(ports.multiB),
        },
        timeoutMs: 90_000,
      },
    ));
  } catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await stopManagedProcess(webProcess);
    await stopManagedProcess(apiProcess);
    if (apiProcess) {
      writeFileSync(path.join(artifactDir, 'api.log'), apiProcess.stdout + apiProcess.stderr);
    }
    if (webProcess) {
      writeFileSync(path.join(artifactDir, 'web-preview.log'), webProcess.stdout + webProcess.stderr);
    }
    if (coturnActive) {
      await captureLocalCoturnLogs(turnConfig.containerName);
      try {
        await stopLocalCoturn(turnConfig.containerName);
        coturnActive = false;
      } catch (error) {
        const cleanupError = error instanceof Error ? error.message : String(error);
        failure = failure ? `${failure}\nCleanup failure: ${cleanupError}` : cleanupError;
      }
    }
    if (startedPostgres) {
      try {
        await runCommand(
          'Local PostgreSQL cleanup',
          'docker',
          ['compose', 'stop', 'postgres'],
          { echo: false, timeoutMs: 60_000 },
        );
      } catch (error) {
        const cleanupError = error instanceof Error ? error.message : String(error);
        failure = failure ? `${failure}\nCleanup failure: ${cleanupError}` : cleanupError;
      }
    }
  }

  const report = {
    schemaVersion: 'gw.local-alpha-integration.v3',
    generatedAt: new Date().toISOString(),
    ok: failure === null,
    localOnly: true,
    hostedServicesContacted: false,
    databaseTarget: 'local',
    databaseStartedByRunner: startedPostgres,
    turnRelay: {
      enabled: true,
      provider: 'local_coturn',
      image: LOCAL_COTURN_IMAGE,
      forced: options.withCoturn,
      credentialMode: 'time_limited',
      containerStartedByRunner: coturnStartedByRunner,
      hostPort: turnConfig.hostPort,
      relayPortRange: [turnConfig.relayPortStart, turnConfig.relayPortEnd],
    },
    runtimeNamespace,
    databaseApplicationName,
    ports,
    steps,
    failure,
  };
  const profileReportPath = path.join(
    artifactDir,
    options.withCoturn ? 'report-relay.json' : 'report-direct.json',
  );
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(profileReportPath, serializedReport);
  writeFileSync(latestReportPath, serializedReport);
  console.log(JSON.stringify({
    ...report,
    reportPath: profileReportPath,
    latestReportPath,
  }, null, 2));
  if (failure) {
    if (apiProcess) {
      console.error(`Local API log tail:\n${tail(apiProcess.stderr || apiProcess.stdout)}`);
    }
    if (webProcess) {
      console.error(`Web preview log tail:\n${tail(webProcess.stderr || webProcess.stdout)}`);
    }
    process.exitCode = 1;
  }
}

void run();
