import { classifyDatabaseTarget } from '../databaseTarget';

export type AlphaProviderCheckStatus = 'pass' | 'warning' | 'fail';

export interface AlphaProviderConfigCheck {
  id: string;
  status: AlphaProviderCheckStatus;
  message: string;
}

export interface AlphaProviderConfigReport {
  schemaVersion: 'gw.alpha-provider-config-audit.v1';
  ready: boolean;
  blockers: number;
  warnings: number;
  checks: AlphaProviderConfigCheck[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_REGEX = /^[0-9a-f]{40}$/i;

function parseList(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true' || value?.trim() === '1';
}

function isFalse(value: string | undefined): boolean {
  return value === undefined || value.trim().toLowerCase() === 'false' || value.trim() === '0';
}

function isPlaceholder(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized
    || normalized.includes('<')
    || normalized.includes('replace_')
    || normalized.includes('replace-with')
    || normalized.includes('changeme')
    || normalized.includes('example.com');
}

function isHttpsUrl(value: string | undefined): boolean {
  try {
    return new URL(String(value ?? '')).protocol === 'https:';
  } catch {
    return false;
  }
}

function isOfficialSteamApiBase(value: string | undefined): boolean {
  try {
    const url = new URL(String(value ?? ''));
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

function addCheck(
  checks: AlphaProviderConfigCheck[],
  id: string,
  passed: boolean,
  passMessage: string,
  failMessage: string,
  severity: Exclude<AlphaProviderCheckStatus, 'pass'> = 'fail',
): void {
  checks.push({
    id,
    status: passed ? 'pass' : severity,
    message: passed ? passMessage : failMessage,
  });
}

export function auditAlphaProviderConfig(
  env: Record<string, string | undefined>,
): AlphaProviderConfigReport {
  const checks: AlphaProviderConfigCheck[] = [];
  const releaseSha = String(env.RELEASE_SHA ?? env.RENDER_GIT_COMMIT ?? '').trim();
  const buildAllowlist = parseList(env.MATCHMAKING_ALPHA_BUILD_VERSIONS);
  const accountAllowlist = parseList(env.MATCHMAKING_ALPHA_ACCOUNT_IDS);
  const supportedRulesets = parseList(env.RANKED_SUPPORTED_RULESET_VERSIONS);
  const turnUrls = parseList(env.MATCHMAKING_TURN_URLS);
  const corsOrigins = parseList(env.API_CORS_ORIGINS);
  const webBuild = String(env.VITE_APP_BUILD ?? '').trim();
  const webRuleset = String(env.VITE_RULESET_VERSION ?? '').trim();
  const profileApiBase = String(env.VITE_PROFILE_API_BASE ?? '').trim().replace(/\/+$/, '');
  const matchmakingApiBase = String(env.VITE_MATCHMAKING_API_BASE ?? '').trim().replace(/\/+$/, '');

  addCheck(
    checks,
    'production_mode',
    env.NODE_ENV === 'production',
    'API production mode is explicit.',
    'NODE_ENV must be production for the hosted alpha API.',
  );
  addCheck(
    checks,
    'deployment_identity',
    ['canary', 'production'].includes(String(env.DEPLOYMENT_ENVIRONMENT ?? '').trim())
      && !isPlaceholder(env.DEPLOYMENT_DATABASE_ID),
    'Deployment environment and stable database identity are configured.',
    'Set DEPLOYMENT_ENVIRONMENT to canary/production and provide DEPLOYMENT_DATABASE_ID.',
  );
  addCheck(
    checks,
    'provider_health_probe',
    String(env.RENDER_HEALTH_CHECK_PATH ?? '').trim() === '/health',
    'Render liveness uses the database-free health endpoint.',
    'Set the Render health check path and RENDER_HEALTH_CHECK_PATH audit metadata to /health; reserve /readyz for deliberate rollout checks.',
  );
  const runtimeNamespace = String(env.MATCHMAKING_RUNTIME_NAMESPACE ?? '').trim();
  const runtimeLockTimeoutMs = Number(env.MATCHMAKING_RUNTIME_LOCK_TIMEOUT_MS ?? 5_000);
  addCheck(
    checks,
    'matchmaking_runtime_coordination',
    runtimeNamespace === String(env.DEPLOYMENT_ENVIRONMENT ?? '').trim()
      && Number.isInteger(runtimeLockTimeoutMs)
      && runtimeLockTimeoutMs >= 1_000
      && runtimeLockTimeoutMs <= 30_000,
    'Matchmaking runtime namespace and bounded PostgreSQL coordinator timeout are explicit.',
    'Set MATCHMAKING_RUNTIME_NAMESPACE to DEPLOYMENT_ENVIRONMENT and use a 1000-30000ms MATCHMAKING_RUNTIME_LOCK_TIMEOUT_MS.',
  );
  addCheck(
    checks,
    'migration_rollback_window',
    isTrue(env.MIGRATION_ALLOW_FORWARD_COMPATIBLE_SUFFIX),
    'The API can start against a verified additive migration suffix during rollback.',
    'Set MIGRATION_ALLOW_FORWARD_COMPATIBLE_SUFFIX=true before using this release as a rollback baseline.',
  );
  addCheck(
    checks,
    'release_sha',
    SHA_REGEX.test(releaseSha),
    'API release identity is an exact commit SHA.',
    'RELEASE_SHA or RENDER_GIT_COMMIT must be an exact 40-character SHA.',
  );
  addCheck(
    checks,
    'remote_database',
    classifyDatabaseTarget(String(env.DATABASE_URL ?? '')) === 'remote'
      && /(?:\?|&)sslmode=require(?:&|$)/i.test(String(env.DATABASE_URL ?? '')),
    'Database target is remote and requires TLS.',
    'DATABASE_URL must target remote PostgreSQL with sslmode=require.',
  );
  addCheck(
    checks,
    'signed_sessions',
    String(env.AUTH_SESSION_SECRET ?? '').trim().length >= 32 && !isTrue(env.ALLOW_INSECURE_ACCOUNT_HEADER),
    'Signed sessions are configured and insecure account headers are disabled.',
    'Use a 32+ character AUTH_SESSION_SECRET and set ALLOW_INSECURE_ACCOUNT_HEADER=false.',
  );
  const authSessionSecret = String(env.AUTH_SESSION_SECRET ?? '').trim();
  const authSessionPreviousSecret = String(env.AUTH_SESSION_PREVIOUS_SECRET ?? '').trim();
  const authRateLimitSecret = String(env.AUTH_RATE_LIMIT_SECRET ?? '').trim();
  const authIdentityAdminKey = String(env.AUTH_IDENTITY_ADMIN_KEY ?? '').trim();
  addCheck(
    checks,
    'auth_session_rotation_secret',
    !authSessionPreviousSecret || (
      authSessionPreviousSecret.length >= 32
      && authSessionPreviousSecret !== authSessionSecret
      && authSessionPreviousSecret !== authRateLimitSecret
      && authSessionPreviousSecret !== authIdentityAdminKey
    ),
    authSessionPreviousSecret
      ? 'The temporary previous session-signing secret is strong and purpose-distinct.'
      : 'No session-signing rotation overlap is active.',
    'AUTH_SESSION_PREVIOUS_SECRET must be absent or a distinct 32+ character value used only during a bounded rotation overlap.',
  );
  addCheck(
    checks,
    'auth_rate_limit_secret',
    authRateLimitSecret.length >= 32 && authRateLimitSecret !== authSessionSecret,
    'Authentication throttles use a distinct strong pseudonymization secret.',
    'Set AUTH_RATE_LIMIT_SECRET to a distinct 32+ character value.',
  );
  const trustProxyHops = Number(env.API_TRUST_PROXY_HOPS);
  addCheck(
    checks,
    'auth_source_identity',
    Number.isInteger(trustProxyHops) && trustProxyHops >= 1 && trustProxyHops <= 8,
    'The hosted reverse-proxy hop count is explicit for source throttling.',
    'Set API_TRUST_PROXY_HOPS to the verified integer hop count (1-8) for the hosted API.',
  );
  addCheck(
    checks,
    'identity_admin_boundary',
    !authIdentityAdminKey || (
      authIdentityAdminKey.length >= 32
      && authIdentityAdminKey !== authSessionSecret
      && authIdentityAdminKey !== authRateLimitSecret
    ),
    authIdentityAdminKey
      ? 'Emergency identity administration uses a separate strong key.'
      : 'Emergency identity administration remains disabled.',
    'AUTH_IDENTITY_ADMIN_KEY must be absent or a distinct 32+ character value.',
  );
  addCheck(
    checks,
    'cors_origin',
    corsOrigins.length > 0
      && corsOrigins.every((origin) => isHttpsUrl(origin))
      && !corsOrigins.includes('*'),
    'API CORS is restricted to explicit HTTPS origins.',
    'API_CORS_ORIGINS must contain only explicit HTTPS alpha web origins.',
  );
  addCheck(
    checks,
    'alpha_access',
    env.MATCHMAKING_ACCESS_MODE === 'allowlist'
      && accountAllowlist.length > 0
      && accountAllowlist.every((value) => UUID_REGEX.test(value))
      && buildAllowlist.length > 0,
    'Account and exact-build alpha allowlists are non-empty.',
    'Use allowlist mode with valid account UUIDs and at least one exact build id.',
  );
  const maxResidentTickets = Number(env.MATCHMAKING_MAX_RESIDENT_TICKETS);
  addCheck(
    checks,
    'matchmaking_resident_capacity',
    Number.isSafeInteger(maxResidentTickets)
      && maxResidentTickets >= Math.max(4, accountAllowlist.length * 2)
      && maxResidentTickets <= 128,
    'Matchmaking resident state has an explicit controlled-alpha ceiling.',
    'Set MATCHMAKING_MAX_RESIDENT_TICKETS to an integer from max(4, twice the account allowlist) through 128.',
  );
  const reconnectGraceSeconds = Number(env.MATCHMAKING_RECONNECT_GRACE_SECONDS ?? 20);
  addCheck(
    checks,
    'matchmaking_recovery_window',
    Number.isInteger(reconnectGraceSeconds)
      && reconnectGraceSeconds >= 9
      && reconnectGraceSeconds <= 120,
    'Matchmaking reconnect grace can accommodate bounded WebRTC recovery.',
    'Set MATCHMAKING_RECONNECT_GRACE_SECONDS to an integer from 9 through 120.',
  );
  addCheck(
    checks,
    'build_identity',
    SHA_REGEX.test(webBuild)
      && webBuild.toLowerCase() === releaseSha.toLowerCase()
      && buildAllowlist.some((value) => value.toLowerCase() === webBuild.toLowerCase()),
    'Web build, API release, and matchmaking allowlist use the same exact SHA.',
    'VITE_APP_BUILD must equal the API release SHA and appear in MATCHMAKING_ALPHA_BUILD_VERSIONS.',
  );
  addCheck(
    checks,
    'ruleset_identity',
    webRuleset.length > 0 && supportedRulesets.includes(webRuleset),
    'Web ruleset is accepted by the ranked verifier.',
    'VITE_RULESET_VERSION must appear in RANKED_SUPPORTED_RULESET_VERSIONS.',
  );
  const proofSessionMaxAttempts = Number(
    env.RANKED_PROOF_RATE_LIMIT_ACCOUNT_SESSION_MAX_ATTEMPTS ?? 4,
  );
  const proofSessionWindowSeconds = Number(
    env.RANKED_PROOF_RATE_LIMIT_ACCOUNT_SESSION_WINDOW_SECONDS ?? 600,
  );
  const proofAccountMaxAttempts = Number(
    env.RANKED_PROOF_RATE_LIMIT_ACCOUNT_HOUR_MAX_ATTEMPTS ?? 20,
  );
  const proofAccountWindowSeconds = Number(
    env.RANKED_PROOF_RATE_LIMIT_ACCOUNT_HOUR_WINDOW_SECONDS ?? 3_600,
  );
  addCheck(
    checks,
    'ranked_proof_rate_limit',
    Number.isInteger(proofSessionMaxAttempts)
      && proofSessionMaxAttempts >= 2
      && proofSessionMaxAttempts <= 8
      && Number.isInteger(proofSessionWindowSeconds)
      && proofSessionWindowSeconds >= 60
      && proofSessionWindowSeconds <= 3_600
      && Number.isInteger(proofAccountMaxAttempts)
      && proofAccountMaxAttempts >= proofSessionMaxAttempts
      && proofAccountMaxAttempts <= 60
      && Number.isInteger(proofAccountWindowSeconds)
      && proofAccountWindowSeconds >= 600
      && proofAccountWindowSeconds <= 86_400,
    'Ranked proof replay has bounded participant-session and account-wide attempt budgets.',
    'Keep ranked proof session attempts at 2-8 over 60-3600s and account attempts at the session limit through 60 over 600-86400s.',
  );
  addCheck(
    checks,
    'turn_relay',
    turnUrls.some((url) => url.startsWith('turn:'))
      && turnUrls.some((url) => url.startsWith('turns:'))
      && String(env.MATCHMAKING_TURN_SHARED_SECRET ?? '').trim().length >= 32,
    'TURN has UDP/TCP-TLS endpoints and a production shared secret.',
    'Configure at least one turn: URL, one turns: URL, and a 32+ character TURN shared secret.',
  );
  addCheck(
    checks,
    'turn_credentials',
    !env.MATCHMAKING_TURN_USERNAME?.trim() && !env.MATCHMAKING_TURN_CREDENTIAL?.trim(),
    'Permanent player-facing TURN credentials are absent.',
    'Remove MATCHMAKING_TURN_USERNAME/CREDENTIAL; alpha requires account-scoped short-lived credentials.',
  );
  const turnTtl = Number(env.MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS ?? 600);
  addCheck(
    checks,
    'turn_ttl',
    Number.isInteger(turnTtl) && turnTtl >= 60 && turnTtl <= 86_400,
    'TURN credential lifetime is inside the supported range.',
    'MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS must be between 60 and 86400.',
  );
  const steamTimeoutMs = Number(env.STEAM_WEB_API_TIMEOUT_MS ?? 5_000);
  const steamApiBase = String(env.STEAM_WEB_API_BASE ?? 'https://partner.steam-api.com');
  addCheck(
    checks,
    'steam_verification',
    Number.isInteger(steamTimeoutMs)
      && steamTimeoutMs >= 1_000
      && steamTimeoutMs <= 30_000
      && isOfficialSteamApiBase(steamApiBase)
      && /^\d+$/.test(String(env.STEAM_APP_ID ?? ''))
      && Number(env.STEAM_APP_ID) > 0
      && !isPlaceholder(env.STEAM_WEB_API_KEY)
      && !isPlaceholder(env.STEAM_WEB_API_IDENTITY)
      && isFalse(env.STEAM_ALLOW_DEV_TICKETS),
    'Steam web-ticket verification uses the official publisher endpoint, a bounded deadline, and no dev tickets.',
    'Set Steam app/key/identity values, use https://partner.steam-api.com, use a 1000-30000ms timeout, and keep STEAM_ALLOW_DEV_TICKETS=false.',
  );
  const steamServerIdentity = String(env.STEAM_WEB_API_IDENTITY ?? '').trim();
  const steamClientIdentity = String(env.VITE_STEAM_WEB_API_IDENTITY ?? '').trim();
  addCheck(
    checks,
    'steam_client_identity',
    !isPlaceholder(steamClientIdentity)
      && steamClientIdentity === steamServerIdentity,
    'Steam client and server use the same Web API ticket identity.',
    'VITE_STEAM_WEB_API_IDENTITY must exactly match STEAM_WEB_API_IDENTITY.',
  );
  addCheck(
    checks,
    'steam_dev_ticket_disabled',
    !String(env.VITE_STEAM_DEV_TICKET ?? '').trim(),
    'The alpha client does not bundle a Steam development ticket.',
    'Remove VITE_STEAM_DEV_TICKET from alpha client configuration.',
  );
  addCheck(
    checks,
    'durable_replays',
    env.REPLAY_BLOB_PROVIDER === 'postgres',
    'Replay payloads use durable PostgreSQL storage.',
    'Set REPLAY_BLOB_PROVIDER=postgres; local filesystem blobs do not survive Render deploys.',
  );
  addCheck(
    checks,
    'operations_keys',
    (() => {
      const operationKeys = [
        'SLO_ADMIN_KEY',
        'RANKED_ANOMALY_ADMIN_KEY',
        'ENFORCEMENT_ADMIN_KEY',
        'RANKED_SEASON_RESET_ADMIN_KEY',
      ].map((key) => String(env[key] ?? '').trim());
      const purposeSecrets = [
        authSessionSecret,
        authRateLimitSecret,
        ...(authSessionPreviousSecret ? [authSessionPreviousSecret] : []),
        ...(authIdentityAdminKey ? [authIdentityAdminKey] : []),
      ];
      return operationKeys.every((key) => key.length >= 24)
        && new Set(operationKeys).size === operationKeys.length
        && operationKeys.every((key) => !purposeSecrets.includes(key));
    })(),
    'Operations and enforcement endpoints have separate strong credentials.',
    'Configure 24+ character SLO, anomaly, enforcement, and season-reset admin keys.',
  );
  addCheck(
    checks,
    'web_api_targets',
    isHttpsUrl(profileApiBase)
      && profileApiBase === matchmakingApiBase,
    'Web profile and matchmaking clients target the same HTTPS API.',
    'VITE_PROFILE_API_BASE and VITE_MATCHMAKING_API_BASE must use the same HTTPS API origin.',
  );
  addCheck(
    checks,
    'web_online_runtime',
    env.VITE_APP_ENV === 'production'
      && env.VITE_PLATFORM === 'web'
      && isTrue(env.VITE_FEATURE_ONLINE)
      && isTrue(env.VITE_FEATURE_RANKED)
      && isTrue(env.VITE_FEATURE_ONLINE_MATCH_RUNTIME),
    'Production web build enables the real ranked WebRTC/rollback runtime.',
    'Enable production web, online, ranked, and VITE_FEATURE_ONLINE_MATCH_RUNTIME for alpha builds.',
  );
  addCheck(
    checks,
    'web_debug_surface',
    isFalse(env.VITE_FEATURE_DEBUG_TOOLS)
      && isFalse(env.VITE_FEATURE_ONLINE_DIAGNOSTICS)
      && isFalse(env.VITE_FEATURE_ONLINE_DEV_MENU),
    'Debug, diagnostics, and online developer surfaces are disabled.',
    'Disable debug tools, online diagnostics, and the online developer menu in alpha builds.',
  );
  addCheck(
    checks,
    'balance_profile',
    !isPlaceholder(env.VITE_BALANCE_PROFILE_ID),
    'Web balance profile identity is explicit.',
    'Set VITE_BALANCE_PROFILE_ID to the release candidate profile.',
  );
  addCheck(
    checks,
    'invite_origin',
    isHttpsUrl(env.ROOM_WEB_INVITE_BASE_URL)
      && corsOrigins.includes(String(env.ROOM_WEB_INVITE_BASE_URL ?? '').trim()),
    'Room invite origin is an allowed HTTPS web origin.',
    'ROOM_WEB_INVITE_BASE_URL must be one of API_CORS_ORIGINS.',
    'warning',
  );

  const blockers = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warning').length;
  return {
    schemaVersion: 'gw.alpha-provider-config-audit.v1',
    ready: blockers === 0,
    blockers,
    warnings,
    checks,
  };
}
