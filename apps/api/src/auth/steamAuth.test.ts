import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSteamExchangeTicket } from './steamAuth';

test('validateSteamExchangeTicket accepts dev ticket prefix', () => {
  const result = validateSteamExchangeTicket('dev-steam:76561198000000000');
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error('Expected valid steam ticket');
  }
  assert.equal(result.steamUserId, '76561198000000000');
});

test('validateSteamExchangeTicket accepts numeric steam id', () => {
  const result = validateSteamExchangeTicket('76561198012345678');
  assert.equal(result.ok, true);
});

test('validateSteamExchangeTicket rejects invalid formats', () => {
  assert.equal(validateSteamExchangeTicket('abc').ok, false);
  assert.equal(validateSteamExchangeTicket('dev-steam:abc').ok, false);
  assert.equal(validateSteamExchangeTicket('').ok, false);
});
