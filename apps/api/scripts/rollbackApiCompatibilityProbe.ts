import process from 'node:process';
import type { RollbackSchemaCompatibilityProbeEvidence } from '../src/ops/rollbackSchemaCompatibility';
import { createRollbackRankedQueueJoinBody } from '../src/ops/rollbackProbeContract';
import { assertSafeSmokeTarget } from './smokeTargetGuard';

interface AccountResponse {
  id?: string;
  accessToken?: string;
}

interface QueueTicketResponse {
  ticketId?: string;
  status?: string;
  matchStart?: {
    sessionId?: string;
  };
}

interface JsonResponse<T> {
  status: number;
  body: T;
}

interface ProbeAccount {
  id: string;
  accessToken: string | null;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve text in the failure message below.
  }
  return { status: response.status, body: body as T };
}

function expectStatus(label: string, response: JsonResponse<unknown>, expected: number): void {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}. Body: ${JSON.stringify(response.body)}`,
    );
  }
}

function authHeaders(account: ProbeAccount): Record<string, string> {
  return {
    'x-account-id': account.id,
    ...(account.accessToken ? { authorization: `Bearer ${account.accessToken}` } : {}),
  };
}

async function createAccount(baseUrl: string): Promise<ProbeAccount> {
  const response = await requestJson<AccountResponse>(`${baseUrl}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  expectStatus('Account creation', response, 201);
  if (!response.body.id) {
    throw new Error('Account creation did not return an id.');
  }
  return {
    id: response.body.id,
    accessToken: response.body.accessToken ?? null,
  };
}

async function exerciseAccountAndProfile(
  baseUrl: string,
  account: ProbeAccount,
  displayName: string,
): Promise<void> {
  const headers = authHeaders(account);
  const accountRead = await requestJson<AccountResponse>(`${baseUrl}/accounts/${account.id}`, {
    headers,
  });
  expectStatus('Account read', accountRead, 200);
  if (accountRead.body.id !== account.id) {
    throw new Error('Account read returned a different account.');
  }

  const profileWrite = await requestJson<Record<string, unknown>>(`${baseUrl}/profile`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName,
      settings: { rollbackCompatibility: true },
    }),
  });
  expectStatus('Profile write', profileWrite, 200);

  const profileRead = await requestJson<Record<string, unknown>>(`${baseUrl}/profile`, { headers });
  expectStatus('Profile read', profileRead, 200);
  const returnedDisplayName = profileRead.body.display_name ?? profileRead.body.displayName;
  if (returnedDisplayName !== displayName) {
    throw new Error('Profile read did not preserve the compatibility probe display name.');
  }
}

async function joinRankedQueue(
  baseUrl: string,
  account: ProbeAccount,
  buildVersion: string,
): Promise<QueueTicketResponse> {
  const response = await requestJson<QueueTicketResponse>(`${baseUrl}/matchmaking/queue/join`, {
    method: 'POST',
    headers: { ...authHeaders(account), 'content-type': 'application/json' },
    body: JSON.stringify(createRollbackRankedQueueJoinBody(buildVersion)),
  });
  expectStatus('Ranked queue join', response, 201);
  if (!response.body.ticketId) {
    throw new Error('Ranked queue join did not return a ticket id.');
  }
  return response.body;
}

async function readTicket(
  baseUrl: string,
  account: ProbeAccount,
  ticketId: string,
): Promise<QueueTicketResponse> {
  const response = await requestJson<QueueTicketResponse>(
    `${baseUrl}/matchmaking/queue/tickets/${ticketId}`,
    { headers: authHeaders(account) },
  );
  expectStatus('Ranked ticket read', response, 200);
  return response.body;
}

export async function runRollbackApiCompatibilityProbe(
  baseUrlInput: string,
  phaseLabel: string,
  options: { internallyManagedLoopback?: boolean } = {},
): Promise<RollbackSchemaCompatibilityProbeEvidence> {
  const baseUrl = baseUrlInput.trim().replace(/\/+$/, '');
  if (options.internallyManagedLoopback) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
      throw new Error('Internally managed rollback probes must target exact HTTP loopback.');
    }
  } else {
    await assertSafeSmokeTarget(baseUrl, 'Rollback schema compatibility probe');
  }

  const health = await requestJson<{ ok?: boolean }>(`${baseUrl}/health`);
  expectStatus('Rollback API health', health, 200);
  if (health.body.ok !== true) {
    throw new Error('Rollback API health response did not report ok=true.');
  }

  const queueConfig = await requestJson<Record<string, unknown>>(`${baseUrl}/matchmaking/queue/config`);
  expectStatus('Matchmaking queue config', queueConfig, 200);

  const suffix = `${phaseLabel}-${Date.now().toString(36)}`.slice(-18);
  const accountA = await createAccount(baseUrl);
  const accountB = await createAccount(baseUrl);
  await exerciseAccountAndProfile(baseUrl, accountA, `Compat-A-${suffix}`.slice(0, 32));
  await exerciseAccountAndProfile(baseUrl, accountB, `Compat-B-${suffix}`.slice(0, 32));

  const buildVersion = `rollback-compat-${phaseLabel}`;
  const ticketA = await joinRankedQueue(baseUrl, accountA, buildVersion);
  const ticketB = await joinRankedQueue(baseUrl, accountB, buildVersion);
  const refreshedTicketA = await readTicket(baseUrl, accountA, ticketA.ticketId as string);
  const refreshedTicketB = await readTicket(baseUrl, accountB, ticketB.ticketId as string);
  const sessionA = refreshedTicketA.matchStart?.sessionId;
  const sessionB = refreshedTicketB.matchStart?.sessionId;
  const matchedSessionObserved = refreshedTicketA.status === 'matched'
    && refreshedTicketB.status === 'matched'
    && Boolean(sessionA)
    && sessionA === sessionB;
  if (!matchedSessionObserved) {
    throw new Error('Rollback API did not create one shared ranked session for the probe accounts.');
  }

  return {
    accountsCreated: 2,
    profilesWritten: 2,
    rankedTicketsCreated: 2,
    matchedSessionObserved,
  };
}

async function run(): Promise<void> {
  const result = await runRollbackApiCompatibilityProbe(
    String(process.env.API_BASE_URL ?? 'http://127.0.0.1:8787'),
    String(process.env.ROLLBACK_COMPAT_PROBE_PHASE ?? 'manual'),
  );
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (process.argv[1]?.endsWith('rollbackApiCompatibilityProbe.ts')) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
