export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: unknown[] }>;
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

export async function mergeAccountIntoTarget(
  client: SqlClient,
  sourceAccountId: string,
  targetAccountId: string,
  actorAccountId: string | null,
): Promise<{ merged: boolean; transferredWebIdentity: boolean; transferredWebCredential: boolean; mergedProfile: boolean }> {
  if (sourceAccountId === targetAccountId) {
    return {
      merged: false,
      transferredWebIdentity: false,
      transferredWebCredential: false,
      mergedProfile: false,
    };
  }

  const sourceAccountResult = await client.query(
    'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE',
    [sourceAccountId],
  );
  if (!sourceAccountResult.rowCount) {
    throw new Error('Merge source account not found.');
  }
  const sourceAccount = sourceAccountResult.rows[0] as { id: string; status: string };
  if (sourceAccount.status !== 'active') {
    throw new Error('Merge source account is disabled.');
  }

  const targetAccountResult = await client.query(
    'SELECT id, status FROM accounts WHERE id = $1 LIMIT 1 FOR UPDATE',
    [targetAccountId],
  );
  if (!targetAccountResult.rowCount) {
    throw new Error('Merge target account not found.');
  }
  const targetAccount = targetAccountResult.rows[0] as { id: string; status: string };
  if (targetAccount.status !== 'active') {
    throw new Error('Merge target account is disabled.');
  }

  let transferredWebIdentity = false;
  let transferredWebCredential = false;
  let mergedProfile = false;
  const actor = actorAccountId ?? 'system';

  const targetWebIdentityResult = await client.query(
    `SELECT 1 FROM identities WHERE account_id = $1 AND provider = 'web' LIMIT 1`,
    [targetAccountId],
  );
  const sourceWebIdentityResult = await client.query(
    `
      SELECT id, provider_user_id
      FROM identities
      WHERE account_id = $1 AND provider = 'web'
      LIMIT 1
      FOR UPDATE
    `,
    [sourceAccountId],
  );
  if (sourceWebIdentityResult.rowCount) {
    const sourceIdentity = sourceWebIdentityResult.rows[0] as { id: number; provider_user_id: string };
    if (targetWebIdentityResult.rowCount) {
      await client.query('DELETE FROM identities WHERE id = $1', [sourceIdentity.id]);
      await logIdentityLinkEvent(client, {
        accountId: sourceAccountId,
        provider: 'web',
        providerUserId: sourceIdentity.provider_user_id,
        eventType: 'unlinked',
        actor,
        metadata: {
          reason: 'merge_discard_duplicate_web_identity',
          targetAccountId,
        },
      });
    } else {
      await client.query('UPDATE identities SET account_id = $1 WHERE id = $2', [targetAccountId, sourceIdentity.id]);
      transferredWebIdentity = true;
      await logIdentityLinkEvent(client, {
        accountId: targetAccountId,
        provider: 'web',
        providerUserId: sourceIdentity.provider_user_id,
        eventType: 'linked',
        actor,
        metadata: {
          reason: 'merge_transfer_web_identity',
          sourceAccountId,
        },
      });
    }
  }

  const sourceOtherIdentities = await client.query(
    `
      SELECT id, provider, provider_user_id
      FROM identities
      WHERE account_id = $1 AND provider <> 'web'
      FOR UPDATE
    `,
    [sourceAccountId],
  );
  for (const row of sourceOtherIdentities.rows as Array<{ id: number; provider: 'web' | 'steam'; provider_user_id: string }>) {
    await client.query('DELETE FROM identities WHERE id = $1', [row.id]);
    await logIdentityLinkEvent(client, {
      accountId: sourceAccountId,
      provider: row.provider,
      providerUserId: row.provider_user_id,
      eventType: 'unlinked',
      actor,
      metadata: {
        reason: 'merge_discard_non_web_identity',
        targetAccountId,
      },
    });
  }

  const targetCredentialsResult = await client.query(
    'SELECT 1 FROM web_auth_credentials WHERE account_id = $1 LIMIT 1',
    [targetAccountId],
  );
  const sourceCredentialsResult = await client.query(
    'SELECT account_id FROM web_auth_credentials WHERE account_id = $1 LIMIT 1 FOR UPDATE',
    [sourceAccountId],
  );
  if (sourceCredentialsResult.rowCount) {
    if (targetCredentialsResult.rowCount) {
      await client.query('DELETE FROM web_auth_credentials WHERE account_id = $1', [sourceAccountId]);
    } else {
      await client.query('UPDATE web_auth_credentials SET account_id = $1 WHERE account_id = $2', [targetAccountId, sourceAccountId]);
      transferredWebCredential = true;
    }
  }

  const sourceProfileResult = await client.query(
    'SELECT display_name, settings_json FROM profiles WHERE account_id = $1 LIMIT 1 FOR UPDATE',
    [sourceAccountId],
  );
  if (sourceProfileResult.rowCount) {
    const sourceProfile = sourceProfileResult.rows[0] as {
      display_name: string | null;
      settings_json: Record<string, unknown>;
    };
    const targetProfileResult = await client.query(
      'SELECT account_id, display_name, settings_json FROM profiles WHERE account_id = $1 LIMIT 1 FOR UPDATE',
      [targetAccountId],
    );
    if (targetProfileResult.rowCount) {
      await client.query(
        `
          UPDATE profiles
          SET
            display_name = COALESCE(NULLIF(display_name, ''), $2),
            settings_json = COALESCE($3::jsonb, '{}'::jsonb) || COALESCE(settings_json, '{}'::jsonb),
            updated_at = NOW()
          WHERE account_id = $1
        `,
        [targetAccountId, sourceProfile.display_name, JSON.stringify(sourceProfile.settings_json ?? {})],
      );
      await client.query('DELETE FROM profiles WHERE account_id = $1', [sourceAccountId]);
    } else {
      await client.query('UPDATE profiles SET account_id = $1 WHERE account_id = $2', [targetAccountId, sourceAccountId]);
    }
    mergedProfile = true;
  }

  await client.query(
    `
      UPDATE accounts
      SET status = 'disabled', updated_at = NOW()
      WHERE id = $1
    `,
    [sourceAccountId],
  );
  await client.query(
    `
      INSERT INTO account_merge_events(source_account_id, target_account_id, actor_account_id, reason, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      sourceAccountId,
      targetAccountId,
      actorAccountId,
      'steam_link_merge',
      JSON.stringify({
        transferredWebIdentity,
        transferredWebCredential,
        mergedProfile,
      }),
    ],
  );

  return {
    merged: true,
    transferredWebIdentity,
    transferredWebCredential,
    mergedProfile,
  };
}
