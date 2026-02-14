import assert from 'node:assert/strict';
import test from 'node:test';
import { getEnforcementActionState, isBlockingEnforcementAction } from './enforcementPolicy';

test('warning actions are non-blocking', () => {
  const state = getEnforcementActionState({
    actionType: 'warning',
    startsAtIso: '2026-02-14T00:00:00.000Z',
    endsAtIso: null,
    revokedAtIso: null,
    nowIso: '2026-02-14T01:00:00.000Z',
  });
  assert.equal(state, 'non_blocking');
});

test('suspension is active between start and end windows', () => {
  const active = isBlockingEnforcementAction({
    actionType: 'suspension',
    startsAtIso: '2026-02-14T00:00:00.000Z',
    endsAtIso: '2026-02-14T03:00:00.000Z',
    revokedAtIso: null,
    nowIso: '2026-02-14T01:00:00.000Z',
  });
  assert.equal(active, true);
});

test('suspension expires after end window', () => {
  const state = getEnforcementActionState({
    actionType: 'suspension',
    startsAtIso: '2026-02-14T00:00:00.000Z',
    endsAtIso: '2026-02-14T01:00:00.000Z',
    revokedAtIso: null,
    nowIso: '2026-02-14T02:00:00.000Z',
  });
  assert.equal(state, 'expired');
});

test('ban stays active until revoked', () => {
  const active = getEnforcementActionState({
    actionType: 'ban',
    startsAtIso: '2026-02-14T00:00:00.000Z',
    endsAtIso: null,
    revokedAtIso: null,
    nowIso: '2026-02-15T00:00:00.000Z',
  });
  const revoked = getEnforcementActionState({
    actionType: 'ban',
    startsAtIso: '2026-02-14T00:00:00.000Z',
    endsAtIso: null,
    revokedAtIso: '2026-02-14T12:00:00.000Z',
    nowIso: '2026-02-15T00:00:00.000Z',
  });
  assert.equal(active, 'active');
  assert.equal(revoked, 'revoked');
});
