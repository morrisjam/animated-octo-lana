export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: unknown[] }>;
}

export type SteamAccountLinkErrorCode =
  | 'steam_link_authentication_required'
  | 'steam_linked_account_disabled'
  | 'steam_identity_already_linked'
  | 'steam_link_target_not_found'
  | 'steam_link_target_disabled'
  | 'steam_link_target_already_has_identity';

export class SteamAccountLinkError extends Error {
  public constructor(
    public readonly code: SteamAccountLinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SteamAccountLinkError';
  }
}

export interface ResolveSteamAccountLinkInput {
  steamUserId: string;
  authenticatedAccountId: string | null;
  linkToAuthenticatedAccount: boolean;
}

export interface SteamAccountLinkResult {
  accountId: string;
  createdAccount: boolean;
  linkedToExistingAccount: boolean;
  identityAlreadyLinked: boolean;
}

export async function logIdentityLinkEvent(
  client: SqlClient,
  event: {
    accountId: string;
    provider: 'web' | 'steam';
    providerUserId: string;
    eventType: 'linked' | 'link_failed' | 'unlinked';
    actor: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO identity_link_events(account_id, provider, provider_user_id, event_type, actor, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      event.accountId,
      event.provider,
      event.providerUserId,
      event.eventType,
      event.actor,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}

export async function resolveSteamAccountLink(
  client: SqlClient,
  input: ResolveSteamAccountLinkInput,
): Promise<SteamAccountLinkResult> {
  if (input.linkToAuthenticatedAccount && !input.authenticatedAccountId) {
    throw new SteamAccountLinkError(
      'steam_link_authentication_required',
      'Steam identity linking requires an authenticated target account.',
    );
  }

  // Serialise first-use exchanges for one Steam identity before checking the unique row.
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`steam:${input.steamUserId}`],
  );

  const existingSteamIdentity = await client.query(
    `
      SELECT i.account_id, a.status
      FROM identities i
      JOIN accounts a ON a.id = i.account_id
      WHERE i.provider = 'steam' AND i.provider_user_id = $1
      LIMIT 1
      FOR UPDATE OF i, a
    `,
    [input.steamUserId],
  );

  if (existingSteamIdentity.rowCount) {
    const existing = existingSteamIdentity.rows[0] as { account_id: string; status: string };
    if (existing.status !== 'active') {
      throw new SteamAccountLinkError(
        'steam_linked_account_disabled',
        'Steam-linked account is disabled.',
      );
    }
    if (
      input.linkToAuthenticatedAccount
      && input.authenticatedAccountId !== existing.account_id
    ) {
      throw new SteamAccountLinkError(
        'steam_identity_already_linked',
        'Steam identity is already linked to another account.',
      );
    }
    return {
      accountId: existing.account_id,
      createdAccount: false,
      linkedToExistingAccount: false,
      identityAlreadyLinked: true,
    };
  }

  let accountId: string;
  let createdAccount = false;
  if (input.linkToAuthenticatedAccount) {
    accountId = input.authenticatedAccountId as string;
    const targetAccount = await client.query(
      'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE',
      [accountId],
    );
    if (!targetAccount.rowCount) {
      throw new SteamAccountLinkError(
        'steam_link_target_not_found',
        'Steam link target account was not found.',
      );
    }
    const target = targetAccount.rows[0] as { id: string; status: string };
    if (target.status !== 'active') {
      throw new SteamAccountLinkError(
        'steam_link_target_disabled',
        'Steam link target account is disabled.',
      );
    }
    const targetSteamIdentity = await client.query(
      `
        SELECT provider_user_id
        FROM identities
        WHERE account_id = $1 AND provider = 'steam'
        LIMIT 1
        FOR UPDATE
      `,
      [accountId],
    );
    if (targetSteamIdentity.rowCount) {
      throw new SteamAccountLinkError(
        'steam_link_target_already_has_identity',
        'Authenticated account already has a different Steam identity.',
      );
    }
  } else {
    const createdAccountResult = await client.query(
      'INSERT INTO accounts(status) VALUES ($1) RETURNING id',
      ['active'],
    );
    accountId = (createdAccountResult.rows[0] as { id: string }).id;
    createdAccount = true;
  }

  await client.query(
    `
      INSERT INTO identities(account_id, provider, provider_user_id)
      VALUES ($1, 'steam', $2)
    `,
    [accountId, input.steamUserId],
  );
  await logIdentityLinkEvent(client, {
    accountId,
    provider: 'steam',
    providerUserId: input.steamUserId,
    eventType: 'linked',
    actor: input.authenticatedAccountId ?? 'steam_exchange',
    metadata: {
      reason: input.linkToAuthenticatedAccount
        ? 'explicit_authenticated_steam_link'
        : 'steam_first_signin_create_account',
    },
  });

  return {
    accountId,
    createdAccount,
    linkedToExistingAccount: input.linkToAuthenticatedAccount,
    identityAlreadyLinked: false,
  };
}
