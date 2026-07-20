interface QueryResultLike {
  rowCount: number | null;
  rows: unknown[];
}

export interface SteamTicketExchangeDatabase {
  query(sql: string, values?: unknown[]): Promise<QueryResultLike>;
}

export interface SteamTicketExchangeClaim {
  ticketDigest: string;
  steamUserId: string;
  accountId: string;
}

const DIGEST_REGEX = /^[0-9a-f]{64}$/;
const STEAM_ID_REGEX = /^\d{5,20}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SteamTicketAlreadyExchangedError extends Error {
  public constructor() {
    super('Steam authentication ticket was already exchanged.');
    this.name = 'SteamTicketAlreadyExchangedError';
  }
}

export async function claimSteamTicketExchange(
  database: SteamTicketExchangeDatabase,
  claim: SteamTicketExchangeClaim,
): Promise<void> {
  if (!DIGEST_REGEX.test(claim.ticketDigest)) {
    throw new TypeError('Steam ticket digest is invalid.');
  }
  if (!STEAM_ID_REGEX.test(claim.steamUserId)) {
    throw new TypeError('Steam ticket user id is invalid.');
  }
  if (!UUID_REGEX.test(claim.accountId)) {
    throw new TypeError('Steam ticket account id is invalid.');
  }

  const result = await database.query(
    `
      INSERT INTO steam_ticket_exchanges(ticket_digest, steam_user_id, account_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (ticket_digest) DO NOTHING
      RETURNING ticket_digest
    `,
    [claim.ticketDigest, claim.steamUserId, claim.accountId],
  );
  if (result.rows.length === 1) {
    return;
  }
  if (result.rows.length === 0) {
    throw new SteamTicketAlreadyExchangedError();
  }
  throw new Error('Steam ticket exchange claim returned an invalid row count.');
}
