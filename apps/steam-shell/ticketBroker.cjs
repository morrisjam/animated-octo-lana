'use strict';

const { randomUUID } = require('node:crypto');

const TICKET_SCHEMA_VERSION = 'gw.steam-web-api-ticket.v1';
const IDENTITY_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;
const TICKET_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TICKET_BYTES = 8;
const MAX_TICKET_BYTES = 4096;

function validateIdentity(value) {
  const identity = typeof value === 'string' ? value.trim() : '';
  if (!IDENTITY_REGEX.test(identity)) {
    throw new Error('Steam Web API identity is invalid.');
  }
  return identity;
}

function ticketBytesToHex(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : null;
  if (!bytes || bytes.length < MIN_TICKET_BYTES || bytes.length > MAX_TICKET_BYTES) {
    throw new Error('Steamworks returned an invalid Web API ticket payload.');
  }
  return bytes.toString('hex');
}

class SteamWebApiTicketBroker {
  constructor({ client, identity, timeoutSeconds = 10, createTicketId = randomUUID }) {
    if (!client?.auth || typeof client.auth.getAuthTicketForWebApi !== 'function') {
      throw new Error('Steamworks client does not expose Web API ticket authentication.');
    }
    this.client = client;
    this.identity = validateIdentity(identity);
    this.timeoutSeconds = timeoutSeconds;
    this.createTicketId = createTicketId;
    this.ticketById = new Map();
    this.pending = false;
  }

  async acquire(requestedIdentity) {
    if (validateIdentity(requestedIdentity) !== this.identity) {
      throw new Error('Requested Steam ticket identity does not match the packaged service identity.');
    }
    if (this.pending) {
      throw new Error('A Steam Web API ticket request is already in progress.');
    }

    this.pending = true;
    let nativeTicket = null;
    try {
      this.cancelAll();
      nativeTicket = await this.client.auth.getAuthTicketForWebApi(
        this.identity,
        this.timeoutSeconds,
      );
      if (
        !nativeTicket
        || typeof nativeTicket.getBytes !== 'function'
        || typeof nativeTicket.cancel !== 'function'
      ) {
        throw new Error('Steamworks returned an invalid ticket handle.');
      }
      const ticket = ticketBytesToHex(nativeTicket.getBytes());
      const ticketId = this.createTicketId();
      if (typeof ticketId !== 'string' || !TICKET_ID_REGEX.test(ticketId)) {
        throw new Error('Steam ticket handle id is invalid.');
      }
      this.ticketById.set(ticketId, {
        nativeTicket,
        ticket,
        exchangeClaimed: false,
      });
      nativeTicket = null;
      return {
        schemaVersion: TICKET_SCHEMA_VERSION,
        ticketId,
        ticket,
        identity: this.identity,
      };
    } finally {
      if (nativeTicket) {
        try {
          nativeTicket.cancel();
        } catch {
          // The original acquisition error remains authoritative.
        }
      }
      this.pending = false;
    }
  }

  cancel(ticketId) {
    if (typeof ticketId !== 'string' || !TICKET_ID_REGEX.test(ticketId)) {
      return false;
    }
    const record = this.ticketById.get(ticketId);
    if (!record) {
      return false;
    }
    this.ticketById.delete(ticketId);
    record.nativeTicket.cancel();
    return true;
  }

  readTicket(ticketId) {
    if (typeof ticketId !== 'string' || !TICKET_ID_REGEX.test(ticketId)) {
      return null;
    }
    return this.ticketById.get(ticketId)?.ticket ?? null;
  }

  claimTicketForExchange(ticketId) {
    if (typeof ticketId !== 'string' || !TICKET_ID_REGEX.test(ticketId)) {
      return null;
    }
    const record = this.ticketById.get(ticketId);
    if (!record || record.exchangeClaimed) {
      return null;
    }
    record.exchangeClaimed = true;
    return record.ticket;
  }

  cancelAll() {
    for (const [ticketId, record] of this.ticketById) {
      this.ticketById.delete(ticketId);
      try {
        record.nativeTicket.cancel();
      } catch {
        // Continue cancelling other one-use handles during shutdown/retry.
      }
    }
  }
}

module.exports = {
  SteamWebApiTicketBroker,
  TICKET_SCHEMA_VERSION,
  ticketBytesToHex,
  validateIdentity,
};
