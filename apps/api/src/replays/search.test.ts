import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReplaySearchQuery,
  DEFAULT_REPLAY_SEARCH_LIMIT,
  encodeReplaySearchCursor,
  parseReplaySearchQuery,
} from './search';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OPPONENT_ID = '22222222-2222-4222-8222-222222222222';
const REPLAY_ID = '33333333-3333-4333-8333-333333333333';

test('parseReplaySearchQuery defaults to authenticated player and default limit', () => {
  const parsed = parseReplaySearchQuery({}, ACCOUNT_ID);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error('Expected valid replay query parse');
  }
  assert.equal(parsed.filters.playerId, ACCOUNT_ID);
  assert.equal(parsed.filters.limit, DEFAULT_REPLAY_SEARCH_LIMIT);
  assert.equal(parsed.cursor, null);
});

test('parseReplaySearchQuery rejects searching another player history', () => {
  const parsed = parseReplaySearchQuery(
    { playerId: OPPONENT_ID },
    ACCOUNT_ID,
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    throw new Error('Expected parse failure');
  }
  assert.equal(parsed.statusCode, 403);
});

test('parseReplaySearchQuery rejects invalid player id format', () => {
  const parsed = parseReplaySearchQuery(
    { playerId: 'invalid-id' },
    ACCOUNT_ID,
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    throw new Error('Expected parse failure');
  }
  assert.equal(parsed.statusCode, 400);
});

test('parseReplaySearchQuery parses matchup filters and cursor validation', () => {
  const baseParse = parseReplaySearchQuery(
    {
      opponentId: OPPONENT_ID,
      character: 'striker_alpha',
      matchup: 'striker_alpha:bruiser_beta',
      queueType: 'ranked',
      patchVersion: '0.2.1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      limit: 10,
    },
    ACCOUNT_ID,
  );
  assert.equal(baseParse.ok, true);
  if (!baseParse.ok) {
    throw new Error('Expected base parse success');
  }

  const cursorToken = encodeReplaySearchCursor(
    baseParse.filters,
    '2026-01-15T10:30:00.000Z',
    REPLAY_ID,
  );
  const parsedWithCursor = parseReplaySearchQuery(
    {
      opponentId: OPPONENT_ID,
      character: 'striker_alpha',
      matchup: 'striker_alpha:bruiser_beta',
      queueType: 'ranked',
      patchVersion: '0.2.1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: cursorToken,
    },
    ACCOUNT_ID,
  );

  assert.equal(parsedWithCursor.ok, true);
  if (!parsedWithCursor.ok) {
    throw new Error('Expected cursor parse success');
  }
  assert.ok(parsedWithCursor.cursor);
  assert.equal(parsedWithCursor.cursor?.replayId, REPLAY_ID);
});

test('buildReplaySearchQuery includes pagination tuple and filter clauses', () => {
  const parsed = parseReplaySearchQuery(
    {
      opponentId: OPPONENT_ID,
      character: 'striker_alpha',
      matchup: 'striker_alpha:bruiser_beta',
      queueType: 'ranked',
      patchVersion: '0.2.1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      limit: 5,
    },
    ACCOUNT_ID,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error('Expected parse success');
  }

  const cursorToken = encodeReplaySearchCursor(
    parsed.filters,
    '2026-01-15T10:30:00.000Z',
    REPLAY_ID,
  );
  const parsedWithCursor = parseReplaySearchQuery(
    {
      opponentId: OPPONENT_ID,
      character: 'striker_alpha',
      matchup: 'striker_alpha:bruiser_beta',
      queueType: 'ranked',
      patchVersion: '0.2.1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      limit: 5,
      cursor: cursorToken,
    },
    ACCOUNT_ID,
  );
  assert.equal(parsedWithCursor.ok, true);
  if (!parsedWithCursor.ok) {
    throw new Error('Expected parse with cursor success');
  }

  const built = buildReplaySearchQuery(parsedWithCursor.filters, parsedWithCursor.cursor);
  assert.match(built.query.text, /ORDER BY r\.started_at DESC, r\.replay_id DESC/);
  assert.match(built.query.text, /\(r\.started_at, r\.replay_id\) < \(/);
  assert.equal(built.query.values.at(-1), 6);
});
