import type { AuthSessionTokenService } from './sessionToken';

export interface AccountStatusDatabase {
  query(
    text: string,
    values: readonly unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<{ status?: unknown }> }>;
}

export type AccountAuthorizationStatus = 'active' | 'disabled' | 'missing';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstHeaderValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

export function resolveAuthenticatedAccountId(
  headers: Record<string, unknown>,
  tokenService: Pick<AuthSessionTokenService, 'verify'>,
  allowInsecureAccountHeader: boolean,
): string | null {
  const authorization = firstHeaderValue(headers.authorization);
  if (authorization) {
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!bearerMatch) {
      return null;
    }
    const validation = tokenService.verify(bearerMatch[1]);
    return validation.ok ? validation.payload.accountId : null;
  }

  if (!allowInsecureAccountHeader) {
    return null;
  }
  const accountId = firstHeaderValue(headers['x-account-id']);
  return accountId && UUID_REGEX.test(accountId) ? accountId : null;
}

export async function resolveAccountAuthorizationStatus(
  database: AccountStatusDatabase,
  accountId: string,
): Promise<AccountAuthorizationStatus> {
  const result = await database.query(
    'SELECT status FROM accounts WHERE id = $1 LIMIT 1',
    [accountId],
  );
  if (!result.rowCount) {
    return 'missing';
  }
  return result.rows[0]?.status === 'active' ? 'active' : 'disabled';
}
