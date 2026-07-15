const STEAM_RUNTIME_BRIDGE_SCHEMA_VERSION = 'gw.steam-runtime-bridge.v1';
const STEAM_WEB_API_TICKET_SCHEMA_VERSION = 'gw.steam-web-api-ticket.v1';
const STEAM_AUTH_HTTP_RESPONSE_SCHEMA_VERSION = 'gw.steam-auth-http-response.v1';
const STEAM_WEB_TICKET_REGEX = /^(?:[0-9a-fA-F]{2}){8,4096}$/;
const STEAM_TICKET_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEAM_IDENTITY_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

export interface SteamWebApiTicketLease {
  schemaVersion: typeof STEAM_WEB_API_TICKET_SCHEMA_VERSION;
  ticketId: string;
  ticket: string;
  identity: string;
}

export interface SteamAuthHttpResponse {
  schemaVersion: typeof STEAM_AUTH_HTTP_RESPONSE_SCHEMA_VERSION;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SteamRuntimeBridge {
  schemaVersion: typeof STEAM_RUNTIME_BRIDGE_SCHEMA_VERSION;
  requestWebApiTicket(identity: string): Promise<SteamWebApiTicketLease>;
  cancelWebApiTicket(ticketId: string): Promise<boolean>;
  // Optional for injected web test doubles; resolved packaged bridges must provide it.
  exchangeSteamSession?(endpoint: string, steamTicket: string): Promise<SteamAuthHttpResponse>;
}

declare global {
  interface Window {
    gravityWellSteam?: unknown;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateSteamWebApiIdentity(identity: unknown): string {
  const normalised = typeof identity === 'string' ? identity.trim() : '';
  if (!STEAM_IDENTITY_REGEX.test(normalised)) {
    throw new Error('Steam Web API identity must be 1-128 ASCII letters, digits, dots, underscores, colons, or hyphens.');
  }
  return normalised;
}

export function resolveSteamRuntimeBridge(candidate: unknown): SteamRuntimeBridge | null {
  if (!isRecord(candidate)) {
    return null;
  }
  if (
    candidate.schemaVersion !== STEAM_RUNTIME_BRIDGE_SCHEMA_VERSION
    || typeof candidate.requestWebApiTicket !== 'function'
    || typeof candidate.cancelWebApiTicket !== 'function'
    || typeof candidate.exchangeSteamSession !== 'function'
  ) {
    return null;
  }
  return candidate as unknown as SteamRuntimeBridge;
}

export function readSteamRuntimeBridge(): SteamRuntimeBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return resolveSteamRuntimeBridge(window.gravityWellSteam);
}

export function parseSteamWebApiTicketLease(
  value: unknown,
  expectedIdentity: string,
): SteamWebApiTicketLease {
  if (!isRecord(value) || value.schemaVersion !== STEAM_WEB_API_TICKET_SCHEMA_VERSION) {
    throw new Error('Steam runtime returned an unsupported ticket response.');
  }
  const ticketId = typeof value.ticketId === 'string' ? value.ticketId.trim() : '';
  const ticket = typeof value.ticket === 'string' ? value.ticket.trim() : '';
  const identity = typeof value.identity === 'string' ? value.identity.trim() : '';
  if (!STEAM_TICKET_ID_REGEX.test(ticketId)) {
    throw new Error('Steam runtime returned an invalid ticket handle.');
  }
  if (!STEAM_WEB_TICKET_REGEX.test(ticket)) {
    throw new Error('Steam runtime returned an invalid Web API ticket.');
  }
  if (identity !== expectedIdentity) {
    throw new Error('Steam runtime ticket identity does not match the configured API identity.');
  }
  return {
    schemaVersion: STEAM_WEB_API_TICKET_SCHEMA_VERSION,
    ticketId,
    ticket: ticket.toLowerCase(),
    identity,
  };
}

export const STEAM_RUNTIME_BRIDGE_SCHEMA = STEAM_RUNTIME_BRIDGE_SCHEMA_VERSION;
export const STEAM_WEB_API_TICKET_SCHEMA = STEAM_WEB_API_TICKET_SCHEMA_VERSION;
export const STEAM_AUTH_HTTP_RESPONSE_SCHEMA = STEAM_AUTH_HTTP_RESPONSE_SCHEMA_VERSION;
