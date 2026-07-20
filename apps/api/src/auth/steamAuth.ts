import { createHash } from 'node:crypto';

const STEAM_ID_REGEX = /^\d{5,20}$/;
const STEAM_WEB_TICKET_REGEX = /^(?:[0-9a-fA-F]{2}){8,4096}$/;

export interface SteamTicketValidationOk {
  ok: true;
  steamUserId: string;
  ticketDigest: string | null;
}

export interface SteamTicketValidationError {
  ok: false;
  code: 'invalid_request' | 'invalid_ticket' | 'misconfigured' | 'unavailable';
  error: string;
}

export type SteamTicketValidationResult = SteamTicketValidationOk | SteamTicketValidationError;

export interface SteamTicketVerifierOptions {
  apiKey?: string | null;
  appId?: string | number | null;
  identity?: string | null;
  allowDevTickets?: boolean;
  apiBase?: string;
  timeoutMs?: number | null;
  fetchImpl?: typeof fetch;
}

interface SteamAuthenticateTicketResponse {
  response?: {
    params?: {
      result?: string;
      steamid?: string;
    };
    error?: {
      errorcode?: number;
      errordesc?: string;
    };
  };
}

const DEFAULT_STEAM_API_BASE = 'https://partner.steam-api.com';
const DEFAULT_STEAM_API_TIMEOUT_MS = 5_000;
const MAX_STEAM_API_TIMEOUT_MS = 30_000;
const OFFICIAL_STEAM_API_HOST = 'partner.steam-api.com';

function normalizeString(value: string | number | null | undefined): string {
  return String(value ?? '').trim();
}

export function digestSteamWebApiTicket(rawTicket: unknown): string | null {
  if (typeof rawTicket !== 'string') {
    return null;
  }
  const ticket = rawTicket.trim().toLowerCase();
  if (!STEAM_WEB_TICKET_REGEX.test(ticket)) {
    return null;
  }
  return createHash('sha256').update(ticket, 'utf8').digest('hex');
}

function validateDevTicket(ticket: string, allowDevTickets: boolean): SteamTicketValidationResult | null {
  if (!ticket.startsWith('dev-steam:')) {
    return null;
  }
  if (!allowDevTickets) {
    return { ok: false, code: 'invalid_ticket', error: 'Development Steam tickets are disabled.' };
  }
  const steamUserId = ticket.slice('dev-steam:'.length).trim();
  if (!STEAM_ID_REGEX.test(steamUserId)) {
    return {
      ok: false,
      code: 'invalid_ticket',
      error: 'Development Steam ticket contains an invalid Steam ID.',
    };
  }
  return { ok: true, steamUserId, ticketDigest: null };
}

export class SteamTicketVerifier {
  private readonly apiKey: string;

  private readonly appId: string;

  private readonly identity: string;

  private readonly allowDevTickets: boolean;

  private readonly apiBase: string;

  private readonly timeoutMs: number;

  private readonly fetchImpl: typeof fetch;

  public constructor(options: SteamTicketVerifierOptions = {}) {
    this.apiKey = normalizeString(options.apiKey);
    this.appId = normalizeString(options.appId);
    this.identity = normalizeString(options.identity);
    this.allowDevTickets = options.allowDevTickets === true;
    this.apiBase = normalizeString(options.apiBase) || DEFAULT_STEAM_API_BASE;
    const configuredTimeoutMs = Number(options.timeoutMs ?? DEFAULT_STEAM_API_TIMEOUT_MS);
    this.timeoutMs = Number.isFinite(configuredTimeoutMs)
      ? Math.min(MAX_STEAM_API_TIMEOUT_MS, Math.max(10, Math.floor(configuredTimeoutMs)))
      : DEFAULT_STEAM_API_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async verify(rawTicket: unknown): Promise<SteamTicketValidationResult> {
    if (typeof rawTicket !== 'string' || rawTicket.trim().length === 0) {
      return { ok: false, code: 'invalid_request', error: 'steamTicket is required.' };
    }
    const ticket = rawTicket.trim();
    const devTicket = validateDevTicket(ticket, this.allowDevTickets);
    if (devTicket) {
      return devTicket;
    }
    if (!STEAM_WEB_TICKET_REGEX.test(ticket)) {
      return {
        ok: false,
        code: 'invalid_request',
        error: 'steamTicket must be a hexadecimal GetAuthTicketForWebApi ticket.',
      };
    }
    const ticketDigest = digestSteamWebApiTicket(ticket);
    if (!ticketDigest) {
      return {
        ok: false,
        code: 'invalid_request',
        error: 'steamTicket must be a hexadecimal GetAuthTicketForWebApi ticket.',
      };
    }
    if (!this.apiKey || !/^\d+$/.test(this.appId) || !this.identity) {
      return {
        ok: false,
        code: 'misconfigured',
        error: 'Steam ticket verification is not configured on the server.',
      };
    }

    let baseUrl: URL;
    try {
      baseUrl = new URL(this.apiBase);
    } catch {
      return {
        ok: false,
        code: 'misconfigured',
        error: 'Steam ticket verification endpoint is invalid.',
      };
    }
    const loopbackHost = baseUrl.hostname === '127.0.0.1'
      || baseUrl.hostname === 'localhost'
      || baseUrl.hostname === '[::1]';
    const localEndpoint = loopbackHost
      && (baseUrl.protocol === 'http:' || baseUrl.protocol === 'https:');
    const officialEndpoint = baseUrl.protocol === 'https:'
      && baseUrl.hostname.toLowerCase() === OFFICIAL_STEAM_API_HOST
      && baseUrl.port === '';
    const cleanBase = baseUrl.username === ''
      && baseUrl.password === ''
      && baseUrl.pathname === '/'
      && baseUrl.search === ''
      && baseUrl.hash === '';
    if ((!officialEndpoint && !localEndpoint) || !cleanBase) {
      return {
        ok: false,
        code: 'misconfigured',
        error: 'Steam ticket verification endpoint must use the official Steam publisher API or loopback.',
      };
    }
    const url = new URL('/ISteamUserAuth/AuthenticateUserTicket/v1/', baseUrl);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('appid', this.appId);
    url.searchParams.set('ticket', ticket);
    url.searchParams.set('identity', this.identity);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const payload = await response.json() as SteamAuthenticateTicketResponse;
      if (!response.ok) {
        return {
          ok: false,
          code: 'unavailable',
          error: 'Steam ticket verification is temporarily unavailable.',
        };
      }
      const params = payload.response?.params;
      const steamUserId = normalizeString(params?.steamid);
      if (params?.result === 'OK' && STEAM_ID_REGEX.test(steamUserId)) {
        return { ok: true, steamUserId, ticketDigest };
      }
      const description = normalizeString(payload.response?.error?.errordesc)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .slice(0, 180);
      return {
        ok: false,
        code: 'invalid_ticket',
        error: description
          ? `Steam rejected the authentication ticket: ${description}`
          : 'Steam rejected the authentication ticket.',
      };
    } catch (error) {
      return {
        ok: false,
        code: 'unavailable',
        error: error instanceof Error && error.name === 'AbortError'
          ? 'Steam ticket verification timed out.'
          : 'Steam ticket verification is temporarily unavailable.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createSteamTicketVerifier(options: SteamTicketVerifierOptions = {}): SteamTicketVerifier {
  return new SteamTicketVerifier(options);
}
