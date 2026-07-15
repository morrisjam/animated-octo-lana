'use strict';

const STEAM_AUTH_RESPONSE_SCHEMA_VERSION = 'gw.steam-auth-http-response.v1';
const STEAM_AUTH_EXCHANGE_PATH = '/auth/steam/exchange';
const STEAM_WEB_TICKET_REGEX = /^(?:[0-9a-fA-F]{2}){8,4096}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function isLoopbackHostname(hostname) {
  const normalised = hostname.toLowerCase();
  return normalised === 'localhost'
    || normalised === '127.0.0.1'
    || normalised === '[::1]';
}

function resolveSteamAuthEndpoint(apiBase, { allowLoopbackHttp = false } = {}) {
  const raw = typeof apiBase === 'string' ? apiBase.trim() : '';
  let base;
  try {
    base = new URL(raw);
  } catch {
    throw new Error('Packaged Steam authentication API base is invalid.');
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('Packaged Steam authentication API base must not contain credentials, a query, or a fragment.');
  }
  if (base.protocol !== 'https:' && !(allowLoopbackHttp && base.protocol === 'http:' && isLoopbackHostname(base.hostname))) {
    throw new Error('Packaged Steam authentication API base must use HTTPS.');
  }
  if (base.pathname !== '/' && base.pathname !== '') {
    throw new Error('Packaged Steam authentication API base must not contain a path.');
  }
  base.pathname = STEAM_AUTH_EXCHANGE_PATH;
  return base.toString();
}

function validateRequestedEndpoint(value, expectedEndpoint) {
  const raw = typeof value === 'string' ? value.trim() : '';
  let requested;
  try {
    requested = new URL(raw).toString();
  } catch {
    throw new Error('Steam authentication exchange endpoint is invalid.');
  }
  if (requested !== expectedEndpoint) {
    throw new Error('Steam authentication exchange endpoint is not allowed by the packaged client.');
  }
  return requested;
}

function validateSteamTicket(value) {
  const ticket = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!STEAM_WEB_TICKET_REGEX.test(ticket)) {
    throw new Error('Steam authentication exchange ticket is invalid.');
  }
  return ticket;
}

function copyResponseHeaders(headers) {
  const copied = {};
  for (const name of ['content-type', 'retry-after']) {
    const value = headers?.get?.(name);
    if (typeof value === 'string' && value.length <= 1024) {
      copied[name] = value;
    }
  }
  return copied;
}

async function readBoundedResponseBody(response, maximumBytes = MAX_RESPONSE_BYTES) {
  const contentLength = response.headers?.get?.('content-length');
  if (/^\d+$/.test(contentLength ?? '') && Number(contentLength) > maximumBytes) {
    throw new Error('Steam authentication API response exceeded the packaged client limit.');
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maximumBytes) {
      throw new Error('Steam authentication API response exceeded the packaged client limit.');
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      const bytes = Buffer.from(chunk.value);
      byteLength += bytes.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Steam authentication API response exceeded the packaged client limit.');
      }
      chunks.push(bytes);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteLength).toString('utf8');
}

class SteamAuthHttpTransport {
  constructor({
    apiBase,
    fetchImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowLoopbackHttp = false,
  }) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Steam authentication main-process fetch is unavailable.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
      throw new Error('Steam authentication timeout must be between 1000 and 30000 milliseconds.');
    }
    this.endpoint = resolveSteamAuthEndpoint(apiBase, { allowLoopbackHttp });
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async exchange(requestedEndpoint, steamTicket) {
    const endpoint = validateRequestedEndpoint(requestedEndpoint, this.endpoint);
    const ticket = validateSteamTicket(steamTicket);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ steamTicket: ticket }),
        signal: controller.signal,
      });
      if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
        throw new Error('Steam authentication API returned an invalid HTTP response.');
      }
      const body = await readBoundedResponseBody(response);
      return {
        schemaVersion: STEAM_AUTH_RESPONSE_SCHEMA_VERSION,
        status: response.status,
        headers: copyResponseHeaders(response.headers),
        body,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  STEAM_AUTH_EXCHANGE_PATH,
  STEAM_AUTH_RESPONSE_SCHEMA_VERSION,
  SteamAuthHttpTransport,
  readBoundedResponseBody,
  resolveSteamAuthEndpoint,
  validateRequestedEndpoint,
  validateSteamTicket,
};
