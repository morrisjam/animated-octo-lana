export const RUNTIME_SECURITY_POSTURE_SCHEMA = 'gw.runtime-security-posture.v1' as const;

const OFFICIAL_STEAM_API_BASE = 'https://partner.steam-api.com';
const MIN_STEAM_TIMEOUT_MS = 1_000;
const MAX_STEAM_TIMEOUT_MS = 30_000;

export interface RuntimeSecurityPosture {
  schemaVersion: typeof RUNTIME_SECURITY_POSTURE_SCHEMA;
  configurationReady: boolean;
  productionMode: boolean;
  hostedDeployment: boolean;
  signedSessionAuthReady: boolean;
  sessionRotationReady: boolean;
  authThrottleIsolationReady: boolean;
  insecureAccountHeaderDisabled: boolean;
  proxySourceBoundaryReady: boolean;
  corsBoundaryReady: boolean;
  identityAdminBoundaryReady: boolean;
  operationsCredentialsReady: boolean;
  steamTicketVerifierConfigured: boolean;
  steamDevelopmentTicketsDisabled: boolean;
}

function normalize(value: string | undefined): string {
  return String(value ?? '').trim();
}

function isTrue(value: string | undefined): boolean {
  const normalized = normalize(value).toLowerCase();
  return normalized === 'true' || normalized === '1';
}

function isExplicitlyFalse(value: string | undefined): boolean {
  const normalized = normalize(value).toLowerCase();
  return normalized === 'false' || normalized === '0';
}

function isPlaceholder(value: string | undefined): boolean {
  const normalized = normalize(value).toLowerCase();
  return !normalized
    || normalized.includes('<')
    || normalized.includes('replace_')
    || normalized.includes('replace-with')
    || normalized.includes('changeme')
    || normalized.includes('example.com');
}

function isOfficialSteamApiBase(value: string | undefined): boolean {
  try {
    const url = new URL(normalize(value) || OFFICIAL_STEAM_API_BASE);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'partner.steam-api.com'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.pathname === '/'
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

function hasRestrictedCorsOrigins(value: string | undefined): boolean {
  const origins = normalize(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 && origins.every((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:'
        && url.username === ''
        && url.password === ''
        && url.hash === '';
    } catch {
      return false;
    }
  });
}

function hasDistinctStrongValues(values: string[], minimumLength: number): boolean {
  return values.every((value) => value.length >= minimumLength)
    && new Set(values).size === values.length;
}

export function evaluateRuntimeSecurityPosture(
  env: Record<string, string | undefined>,
): RuntimeSecurityPosture {
  const nodeEnvironment = normalize(env.NODE_ENV).toLowerCase();
  const deploymentEnvironment = normalize(env.DEPLOYMENT_ENVIRONMENT).toLowerCase();
  const productionMode = nodeEnvironment === 'production';
  const hostedDeployment = productionMode
    && ['canary', 'staging', 'production', 'prod'].includes(deploymentEnvironment);

  const sessionSecret = normalize(env.AUTH_SESSION_SECRET);
  const previousSessionSecret = normalize(env.AUTH_SESSION_PREVIOUS_SECRET);
  const rateLimitSecret = normalize(env.AUTH_RATE_LIMIT_SECRET);
  const identityAdminKey = normalize(env.AUTH_IDENTITY_ADMIN_KEY);
  const signedSessionAuthReady = sessionSecret.length >= 32;
  const insecureAccountHeaderDisabled = !isTrue(env.ALLOW_INSECURE_ACCOUNT_HEADER);
  const sessionRotationReady = !previousSessionSecret || (
    previousSessionSecret.length >= 32
    && hasDistinctStrongValues([
      sessionSecret,
      previousSessionSecret,
      rateLimitSecret,
      ...(identityAdminKey ? [identityAdminKey] : []),
    ], 32)
  );
  const authThrottleIsolationReady = rateLimitSecret.length >= 32
    && rateLimitSecret !== sessionSecret
    && rateLimitSecret !== previousSessionSecret;
  const identityAdminBoundaryReady = !identityAdminKey || (
    identityAdminKey.length >= 32
    && identityAdminKey !== sessionSecret
    && identityAdminKey !== previousSessionSecret
    && identityAdminKey !== rateLimitSecret
  );

  const trustProxyHops = Number(env.API_TRUST_PROXY_HOPS);
  const proxySourceBoundaryReady = Number.isInteger(trustProxyHops)
    && trustProxyHops >= 1
    && trustProxyHops <= 8;
  const corsBoundaryReady = hasRestrictedCorsOrigins(env.API_CORS_ORIGINS);

  const operationKeys = [
    normalize(env.SLO_ADMIN_KEY),
    normalize(env.RANKED_ANOMALY_ADMIN_KEY),
    normalize(env.ENFORCEMENT_ADMIN_KEY),
    normalize(env.RANKED_SEASON_RESET_ADMIN_KEY),
  ];
  const authPurposeSecrets = [
    sessionSecret,
    rateLimitSecret,
    ...(previousSessionSecret ? [previousSessionSecret] : []),
    ...(identityAdminKey ? [identityAdminKey] : []),
  ];
  const operationsCredentialsReady = hasDistinctStrongValues(operationKeys, 24)
    && operationKeys.every((key) => !authPurposeSecrets.includes(key));

  const steamTimeoutMs = Number(env.STEAM_WEB_API_TIMEOUT_MS ?? 5_000);
  const steamDevelopmentTicketsDisabled = isExplicitlyFalse(env.STEAM_ALLOW_DEV_TICKETS);
  const steamTicketVerifierConfigured = isOfficialSteamApiBase(env.STEAM_WEB_API_BASE)
    && Number.isInteger(steamTimeoutMs)
    && steamTimeoutMs >= MIN_STEAM_TIMEOUT_MS
    && steamTimeoutMs <= MAX_STEAM_TIMEOUT_MS
    && /^\d+$/.test(normalize(env.STEAM_APP_ID))
    && Number(env.STEAM_APP_ID) > 0
    && !isPlaceholder(env.STEAM_WEB_API_KEY)
    && !isPlaceholder(env.STEAM_WEB_API_IDENTITY)
    && steamDevelopmentTicketsDisabled;

  const checks = [
    productionMode,
    hostedDeployment,
    signedSessionAuthReady,
    sessionRotationReady,
    authThrottleIsolationReady,
    insecureAccountHeaderDisabled,
    proxySourceBoundaryReady,
    corsBoundaryReady,
    identityAdminBoundaryReady,
    operationsCredentialsReady,
    steamTicketVerifierConfigured,
    steamDevelopmentTicketsDisabled,
  ];

  return {
    schemaVersion: RUNTIME_SECURITY_POSTURE_SCHEMA,
    configurationReady: checks.every(Boolean),
    productionMode,
    hostedDeployment,
    signedSessionAuthReady,
    sessionRotationReady,
    authThrottleIsolationReady,
    insecureAccountHeaderDisabled,
    proxySourceBoundaryReady,
    corsBoundaryReady,
    identityAdminBoundaryReady,
    operationsCredentialsReady,
    steamTicketVerifierConfigured,
    steamDevelopmentTicketsDisabled,
  };
}
