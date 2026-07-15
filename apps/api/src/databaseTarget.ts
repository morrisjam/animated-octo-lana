import process from 'node:process';

export type DatabaseTarget = 'local' | 'remote' | 'unknown';

export interface SmokeDatabaseTargetOptions {
  allowRemote?: boolean;
  deploymentEnvironment?: string | null;
}

const LOCAL_DATABASE_HOSTS = new Set([
  'localhost',
  '::1',
  '[::1]',
  'host.docker.internal',
  'postgres',
  'gravity-well-postgres',
]);

function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 127;
}

export function classifyDatabaseTarget(connectionString: string): DatabaseTarget {
  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    if (
      LOCAL_DATABASE_HOSTS.has(hostname)
      || hostname.endsWith('.localhost')
      || isLoopbackIpv4(hostname)
    ) {
      return 'local';
    }
    return hostname.length > 0 ? 'remote' : 'unknown';
  } catch {
    return 'unknown';
  }
}

const SAFE_REMOTE_SMOKE_ENVIRONMENTS = new Set(['canary', 'staging']);

export function assertSmokeDatabaseTarget(
  target: DatabaseTarget,
  operation: string,
  options: SmokeDatabaseTargetOptions = {},
): void {
  if (target === 'local') {
    return;
  }
  if (target !== 'remote' || !options.allowRemote) {
    throw new Error(
      `${operation} requires a local PostgreSQL target. Set ALLOW_REMOTE_DATABASE_SMOKE=1 only for an intentional isolated staging run.`,
    );
  }

  const deploymentEnvironment = String(options.deploymentEnvironment ?? '').trim().toLowerCase();
  if (deploymentEnvironment === 'production' || deploymentEnvironment === 'prod') {
    throw new Error(
      `${operation} refused a production PostgreSQL target. ALLOW_REMOTE_DATABASE_SMOKE never permits production.`,
    );
  }
  if (!SAFE_REMOTE_SMOKE_ENVIRONMENTS.has(deploymentEnvironment)) {
    throw new Error(
      `${operation} requires a remote target to identify itself as canary or staging before ALLOW_REMOTE_DATABASE_SMOKE can be used.`,
    );
  }
}

export function assertLocalDatabaseTarget(
  connectionString: string,
  operation: string,
  allowRemote = false,
  deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT,
): void {
  assertSmokeDatabaseTarget(classifyDatabaseTarget(connectionString), operation, {
    allowRemote,
    deploymentEnvironment,
  });
}
