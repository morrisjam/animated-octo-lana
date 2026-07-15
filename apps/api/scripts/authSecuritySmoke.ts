import process from 'node:process';
import { Pool } from 'pg';
import {
  assertSafeDatabaseSmokeTarget,
  assertSafeSmokeTarget,
} from './smokeTargetGuard';

interface AccountRecord {
  id?: string;
  accessToken?: string;
}

interface ErrorResponse {
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
}

interface JsonResponse<T> {
  status: number;
  body: T;
  retryAfter: string | null;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<JsonResponse<T>> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve the response text for failure diagnostics.
  }
  return {
    status: response.status,
    body: body as T,
    retryAfter: response.headers.get('retry-after'),
  };
}

function expectStatus(
  label: string,
  response: JsonResponse<unknown>,
  expected: number | number[],
): void {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expectedStatuses.join(' or ')}. `
      + `Body: ${JSON.stringify(response.body)}`,
    );
  }
}

async function createAccount(baseUrl: string): Promise<{ id: string; accessToken: string }> {
  const response = await requestJson<AccountRecord>(`${baseUrl}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  expectStatus('Guest account creation', response, 201);
  if (!response.body.id || !response.body.accessToken) {
    throw new Error('Guest account creation did not return an account id and signed access token.');
  }
  return { id: response.body.id, accessToken: response.body.accessToken };
}

async function run(): Promise<void> {
  const baseUrl = String(process.env.API_BASE_URL ?? 'http://127.0.0.1:8787')
    .trim()
    .replace(/\/+$/, '');
  await assertSafeSmokeTarget(baseUrl, 'Authentication security smoke');

  const accountA = await createAccount(baseUrl);
  const accountB = await createAccount(baseUrl);

  const unsignedAccountRead = await requestJson(`${baseUrl}/accounts/${accountA.id}`);
  expectStatus('Unsigned account read', unsignedAccountRead, 403);

  const ownerAccountRead = await requestJson<AccountRecord>(`${baseUrl}/accounts/${accountA.id}`, {
    headers: { authorization: `Bearer ${accountA.accessToken}` },
  });
  expectStatus('Owner account read', ownerAccountRead, 200);
  if (ownerAccountRead.body.id !== accountA.id) {
    throw new Error('Owner account read returned a different account.');
  }

  const crossAccountRead = await requestJson(`${baseUrl}/accounts/${accountA.id}`, {
    headers: { authorization: `Bearer ${accountB.accessToken}` },
  });
  expectStatus('Cross-account read', crossAccountRead, 403);

  let disabledBearerStatus: number | null = null;
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (databaseUrl) {
    assertSafeDatabaseSmokeTarget(databaseUrl, 'Authentication disabled-bearer smoke');
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await pool.query(
        "UPDATE accounts SET status = 'disabled', updated_at = NOW() WHERE id = $1",
        [accountB.id],
      );
      const disabledBearer = await requestJson<ErrorResponse>(`${baseUrl}/accounts/${accountB.id}`, {
        headers: { authorization: `Bearer ${accountB.accessToken}` },
      });
      expectStatus('Disabled account bearer', disabledBearer, 403);
      if ((disabledBearer.body as ErrorResponse & { code?: string }).code !== 'account_disabled') {
        throw new Error('Disabled account bearer did not return the account_disabled boundary code.');
      }
      disabledBearerStatus = disabledBearer.status;
    } finally {
      await pool.end();
    }
  }

  const identityMutation = await requestJson(`${baseUrl}/accounts/${accountA.id}/identities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'steam',
      providerUserId: '76561198000000000',
      actor: 'untrusted-client',
    }),
  });
  expectStatus('Unsigned identity mutation', identityMutation, [401, 404]);

  const identityLookup = await requestJson(`${baseUrl}/identities/steam/76561198000000000`);
  expectStatus('Unsigned identity lookup', identityLookup, [401, 404]);

  const retiredMerge = await requestJson<ErrorResponse>(`${baseUrl}/auth/steam/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      steamTicket: `retired-merge-${process.pid}-${Date.now()}`,
      mergeAccountId: accountA.id,
    }),
  });
  expectStatus('Retired Steam merge request', retiredMerge, 400);
  if (retiredMerge.body.code !== 'automatic_account_merge_removed') {
    throw new Error('Retired Steam merge request reached ticket verification or returned the wrong boundary code.');
  }

  const unauthenticatedLink = await requestJson<ErrorResponse>(`${baseUrl}/auth/steam/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      steamTicket: `unauthenticated-link-${process.pid}-${Date.now()}`,
      linkToAuthenticatedAccount: true,
    }),
  });
  expectStatus('Unauthenticated Steam link request', unauthenticatedLink, 401);
  if (unauthenticatedLink.body.code !== 'steam_link_authentication_required') {
    throw new Error('Unauthenticated Steam link request reached ticket verification or returned the wrong boundary code.');
  }

  const unconfirmedLink = await requestJson<ErrorResponse>(`${baseUrl}/auth/steam/exchange`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accountA.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      steamTicket: `unconfirmed-link-${process.pid}-${Date.now()}`,
    }),
  });
  expectStatus('Unconfirmed authenticated Steam link request', unconfirmedLink, 409);
  if (unconfirmedLink.body.code !== 'steam_link_confirmation_required') {
    throw new Error('Unconfirmed Steam link request reached ticket verification or returned the wrong boundary code.');
  }

  const malformedTicket = `not-a-steam-ticket-${process.pid}-${Date.now()}`;
  const steamStatuses: number[] = [];
  let throttledResponse: JsonResponse<ErrorResponse> | null = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const ticketVariant = attempt % 2 === 0
      ? malformedTicket.toUpperCase()
      : malformedTicket.toLowerCase();
    const response = await requestJson<ErrorResponse>(`${baseUrl}/auth/steam/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steamTicket: ticketVariant }),
    });
    steamStatuses.push(response.status);
    if (attempt <= 3) {
      expectStatus(`Malformed Steam ticket attempt ${attempt}`, response, 400);
    } else {
      expectStatus('Repeated Steam ticket attempt', response, 429);
      throttledResponse = response;
    }
  }

  if (
    !throttledResponse
    || throttledResponse.body.retryAfterSeconds === undefined
    || Number(throttledResponse.retryAfter) !== throttledResponse.body.retryAfterSeconds
  ) {
    throw new Error('Rate-limited Steam response did not provide a consistent Retry-After value.');
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    accountPrivacy: {
      unsignedStatus: unsignedAccountRead.status,
      ownerStatus: ownerAccountRead.status,
      crossAccountStatus: crossAccountRead.status,
      disabledBearerStatus,
    },
    identityAdministration: {
      mutationStatus: identityMutation.status,
      lookupStatus: identityLookup.status,
    },
    steamTicketBoundary: {
      statuses: steamStatuses,
      retryAfterSeconds: throttledResponse.body.retryAfterSeconds,
    },
    steamLinkBoundary: {
      retiredMergeStatus: retiredMerge.status,
      unauthenticatedLinkStatus: unauthenticatedLink.status,
      unconfirmedLinkStatus: unconfirmedLink.status,
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
