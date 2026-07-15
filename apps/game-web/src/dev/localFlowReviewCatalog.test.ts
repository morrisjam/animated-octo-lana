import { describe, expect, it } from 'vitest';
import {
  LOCAL_FLOW_REVIEW_CATALOG_SCHEMA,
  parseLocalFlowReviewCatalog,
} from './localFlowReviewCatalog';

function validCatalog(): unknown {
  return {
    schemaVersion: LOCAL_FLOW_REVIEW_CATALOG_SCHEMA,
    generatedAt: '2026-07-14T10:47:12.724Z',
    reportSchemaVersion: 'gw.ai-matchup-batch.v9',
    cases: [
      {
        id: 'local-flow-review-replays/cadet-duelist-vs-vanguard-loop-chase-g4-r2-replay.json',
        kind: 'loop-chase',
        status: 'blocked',
        summary: 'BLOCKED: control returns repeatedly become immediate launches.',
        label: 'loop chase | cadet duelist vs vanguard | game 4, round 2',
        p1: 'duelist',
        p2: 'vanguard',
        difficulty: 'cadet',
        gameNumber: 4,
        roundNumber: 2,
        setSeed: 29932335,
        roundSeed: 29932336,
        focusFrame: 2083,
        endFrame: 2803,
        frames: 2804,
      },
    ],
  };
}

describe('parseLocalFlowReviewCatalog', () => {
  it('accepts a generated local review catalog', () => {
    const result = parseLocalFlowReviewCatalog(validCatalog());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.catalog.cases[0].kind).toBe('loop-chase');
      expect(result.catalog.cases[0].status).toBe('blocked');
      expect(result.catalog.cases[0].summary).toContain('control returns');
      expect(result.catalog.cases[0].roundSeed).toBe(29932336);
    }
  });

  it('rejects traversal outside the generated replay directory', () => {
    const raw = validCatalog() as { cases: Array<{ id: string }> };
    raw.cases[0].id = 'local-flow-review-replays/../private-replay.json';

    expect(parseLocalFlowReviewCatalog(raw)).toEqual({
      ok: false,
      error: 'cases[0].id is not a safe local flow-review replay path.',
    });
  });

  it('rejects a focus frame outside the replay', () => {
    const raw = validCatalog() as { cases: Array<{ focusFrame: number; frames: number }> };
    raw.cases[0].focusFrame = raw.cases[0].frames;

    expect(parseLocalFlowReviewCatalog(raw)).toEqual({
      ok: false,
      error: 'cases[0].focusFrame must be inside the replay.',
    });
  });

  it('rejects an unknown review status', () => {
    const raw = validCatalog() as { cases: Array<{ status: string }> };
    raw.cases[0].status = 'failed';

    expect(parseLocalFlowReviewCatalog(raw)).toEqual({
      ok: false,
      error: 'cases[0].status must be blocked, watch, or representative.',
    });
  });

  it('rejects an empty diagnostic summary', () => {
    const raw = validCatalog() as { cases: Array<{ summary: string }> };
    raw.cases[0].summary = '   ';

    expect(parseLocalFlowReviewCatalog(raw)).toEqual({
      ok: false,
      error: 'cases[0].summary must be a non-empty string.',
    });
  });
});
