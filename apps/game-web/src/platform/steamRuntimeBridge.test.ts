import { describe, expect, test } from 'vitest';
import {
  STEAM_RUNTIME_BRIDGE_SCHEMA,
  STEAM_WEB_API_TICKET_SCHEMA,
  parseSteamWebApiTicketLease,
  resolveSteamRuntimeBridge,
  validateSteamWebApiIdentity,
} from './steamRuntimeBridge';

const IDENTITY = 'gravity-well-api';

describe('Steam runtime bridge contract', () => {
  test('accepts the narrow native bridge shape', () => {
    const bridge = {
      schemaVersion: STEAM_RUNTIME_BRIDGE_SCHEMA,
      requestWebApiTicket: async () => ({}),
      cancelWebApiTicket: async () => true,
      exchangeSteamSession: async () => ({}),
    };
    expect(resolveSteamRuntimeBridge(bridge)).toBe(bridge);
    expect(resolveSteamRuntimeBridge({ ...bridge, schemaVersion: 'future' })).toBeNull();
    expect(resolveSteamRuntimeBridge({ ...bridge, cancelWebApiTicket: true })).toBeNull();
    expect(resolveSteamRuntimeBridge({ ...bridge, exchangeSteamSession: undefined })).toBeNull();
  });

  test('validates and normalises one-use ticket leases', () => {
    expect(parseSteamWebApiTicketLease({
      schemaVersion: STEAM_WEB_API_TICKET_SCHEMA,
      ticketId: '11111111-1111-4111-8111-111111111111',
      ticket: '0011223344556677AABBCCDDEEFF8899',
      identity: IDENTITY,
    }, IDENTITY)).toEqual({
      schemaVersion: STEAM_WEB_API_TICKET_SCHEMA,
      ticketId: '11111111-1111-4111-8111-111111111111',
      ticket: '0011223344556677aabbccddeeff8899',
      identity: IDENTITY,
    });
  });

  test('rejects mismatched identities, malformed handles, and malformed tickets', () => {
    const valid = {
      schemaVersion: STEAM_WEB_API_TICKET_SCHEMA,
      ticketId: '11111111-1111-4111-8111-111111111111',
      ticket: '00112233445566778899aabbccddeeff',
      identity: IDENTITY,
    };
    expect(() => parseSteamWebApiTicketLease({ ...valid, identity: 'other-api' }, IDENTITY))
      .toThrow('does not match');
    expect(() => parseSteamWebApiTicketLease({ ...valid, ticketId: '../ticket' }, IDENTITY))
      .toThrow('invalid ticket handle');
    expect(() => parseSteamWebApiTicketLease({ ...valid, ticket: 'xyz' }, IDENTITY))
      .toThrow('invalid Web API ticket');
  });

  test('restricts identity strings to a portable, bounded format', () => {
    expect(validateSteamWebApiIdentity(` ${IDENTITY} `)).toBe(IDENTITY);
    expect(() => validateSteamWebApiIdentity('contains spaces')).toThrow('Steam Web API identity');
    expect(() => validateSteamWebApiIdentity('x'.repeat(129))).toThrow('Steam Web API identity');
  });
});
