const STEAM_ID_REGEX = /^\d{5,20}$/;

export interface SteamTicketValidationOk {
  ok: true;
  steamUserId: string;
}

export interface SteamTicketValidationError {
  ok: false;
  error: string;
}

export type SteamTicketValidationResult = SteamTicketValidationOk | SteamTicketValidationError;

export function validateSteamExchangeTicket(rawTicket: unknown): SteamTicketValidationResult {
  if (typeof rawTicket !== 'string') {
    return { ok: false, error: 'steamTicket is required.' };
  }

  const ticket = rawTicket.trim();
  if (!ticket) {
    return { ok: false, error: 'steamTicket is required.' };
  }

  let steamUserId = ticket;
  if (ticket.startsWith('dev-steam:')) {
    steamUserId = ticket.slice('dev-steam:'.length);
  } else if (ticket.startsWith('steam:')) {
    steamUserId = ticket.slice('steam:'.length);
  }

  steamUserId = steamUserId.trim();
  if (!STEAM_ID_REGEX.test(steamUserId)) {
    return {
      ok: false,
      error: 'steamTicket is invalid. Expected dev-steam:<steamUserId> or numeric steam id.',
    };
  }

  return {
    ok: true,
    steamUserId,
  };
}
