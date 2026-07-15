'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const BRIDGE_SCHEMA_VERSION = 'gw.steam-runtime-bridge.v1';
const AUTH_RESPONSE_SCHEMA_VERSION = 'gw.steam-auth-http-response.v1';
const AUTH_EXCHANGE_PATH = '/auth/steam/exchange';
const REQUEST_TICKET_CHANNEL = 'gravity-well:steam:request-web-api-ticket';
const CANCEL_TICKET_CHANNEL = 'gravity-well:steam:cancel-web-api-ticket';
const EXCHANGE_SESSION_CHANNEL = 'gravity-well:steam:exchange-session';
const IDENTITY_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;
const TICKET_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEB_TICKET_REGEX = /^(?:[0-9a-fA-F]{2}){8,4096}$/;

const ticketIdByTicket = new Map();

function removeTicketMapping(ticketId) {
  for (const [ticket, mappedTicketId] of ticketIdByTicket) {
    if (mappedTicketId === ticketId) {
      ticketIdByTicket.delete(ticket);
    }
  }
}

const steamRuntimeApi = {
  schemaVersion: BRIDGE_SCHEMA_VERSION,
  requestWebApiTicket(identity) {
    if (typeof identity !== 'string' || !IDENTITY_REGEX.test(identity)) {
      return Promise.reject(new Error('Steam Web API identity is invalid.'));
    }
    ticketIdByTicket.clear();
    return ipcRenderer.invoke(REQUEST_TICKET_CHANNEL, identity).then((lease) => {
      const ticketId = typeof lease?.ticketId === 'string' ? lease.ticketId.trim() : '';
      const ticket = typeof lease?.ticket === 'string' ? lease.ticket.trim().toLowerCase() : '';
      if (!TICKET_ID_REGEX.test(ticketId) || !WEB_TICKET_REGEX.test(ticket)) {
        throw new Error('Steam runtime returned an invalid ticket lease.');
      }
      ticketIdByTicket.set(ticket, ticketId);
      return {
        ...lease,
        ticketId,
        ticket,
      };
    });
  },
  cancelWebApiTicket(ticketId) {
    if (typeof ticketId !== 'string' || !TICKET_ID_REGEX.test(ticketId)) {
      return Promise.reject(new Error('Steam ticket handle is invalid.'));
    }
    removeTicketMapping(ticketId);
    return ipcRenderer.invoke(CANCEL_TICKET_CHANNEL, ticketId);
  },
  exchangeSteamSession(endpoint, steamTicket) {
    const ticket = typeof steamTicket === 'string' ? steamTicket.trim().toLowerCase() : '';
    const ticketId = ticketIdByTicket.get(ticket);
    if (typeof endpoint !== 'string' || endpoint.length < 1 || endpoint.length > 2048) {
      return Promise.reject(new Error('Steam authentication endpoint is invalid.'));
    }
    if (!WEB_TICKET_REGEX.test(ticket) || !ticketId) {
      return Promise.reject(new Error('Steam authentication requires an active native ticket lease.'));
    }
    return ipcRenderer.invoke(EXCHANGE_SESSION_CHANNEL, { endpoint, ticketId });
  },
};

contextBridge.exposeInMainWorld('gravityWellSteam', steamRuntimeApi);

// The web adapter captures window.fetch during startup. Install this before its bundle
// runs so only the packaged Steam exchange crosses IPC instead of the file:// origin.
contextBridge.executeInMainWorld({
  func: (authExchangePath, responseSchemaVersion, runtimeOverride) => {
    const runtime = runtimeOverride ?? globalThis;
    const nativeFetch = runtime.fetch;
    if (typeof nativeFetch !== 'function' || nativeFetch.__gravityWellSteamAuthTransport === true) {
      return;
    }

    const createResponse = (envelope) => {
      if (
        !envelope
        || typeof envelope !== 'object'
        || envelope.schemaVersion !== responseSchemaVersion
        || !Number.isInteger(envelope.status)
        || envelope.status < 200
        || envelope.status > 599
        || typeof envelope.body !== 'string'
        || !envelope.headers
        || typeof envelope.headers !== 'object'
      ) {
        throw new Error('Steam authentication transport returned an invalid response.');
      }
      const body = envelope.status === 204 || envelope.status === 205 || envelope.status === 304
        ? null
        : envelope.body;
      return new runtime.Response(body, {
        status: envelope.status,
        headers: envelope.headers,
      });
    };

    const dispatchExchange = (url, body) => {
      const bridge = runtime.gravityWellSteam;
      if (!bridge || typeof bridge.exchangeSteamSession !== 'function') {
        return Promise.reject(new Error('Packaged Steam authentication transport is unavailable.'));
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return Promise.reject(new Error('Steam authentication request body is invalid.'));
      }
      if (!payload || typeof payload !== 'object' || typeof payload.steamTicket !== 'string') {
        return Promise.reject(new Error('Steam authentication request is missing its ticket.'));
      }
      return Promise.resolve(bridge.exchangeSteamSession(url.toString(), payload.steamTicket))
        .then(createResponse);
    };

    const steamAuthFetch = (input, init) => {
      const rawUrl = typeof input === 'string' || input instanceof runtime.URL
        ? String(input)
        : input?.url;
      let url;
      try {
        url = new runtime.URL(rawUrl, runtime.location?.href);
      } catch {
        return nativeFetch.call(runtime, input, init);
      }
      const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
      if (url.pathname !== authExchangePath || method !== 'POST') {
        return nativeFetch.call(runtime, input, init);
      }

      if (typeof init?.body === 'string') {
        return dispatchExchange(url, init.body);
      }
      if (input && typeof input.clone === 'function') {
        return Promise.resolve(input.clone().text()).then((body) => dispatchExchange(url, body));
      }
      return Promise.reject(new Error('Steam authentication request body is unavailable.'));
    };
    Object.defineProperty(steamAuthFetch, '__gravityWellSteamAuthTransport', { value: true });
    runtime.fetch = steamAuthFetch;
  },
  args: [AUTH_EXCHANGE_PATH, AUTH_RESPONSE_SCHEMA_VERSION],
});
