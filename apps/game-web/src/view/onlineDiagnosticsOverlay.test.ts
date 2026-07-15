import { describe, expect, it } from 'vitest';
import { resolveDiagnosticsDisplayMode } from './onlineDiagnosticsOverlay';

describe('online diagnostics display mode', () => {
  it('defaults new and invalid sessions to the non-blocking collapsed view', () => {
    expect(resolveDiagnosticsDisplayMode(null)).toBe('collapsed');
    expect(resolveDiagnosticsDisplayMode('invalid')).toBe('collapsed');
  });

  it('preserves every explicit session choice', () => {
    expect(resolveDiagnosticsDisplayMode('expanded')).toBe('expanded');
    expect(resolveDiagnosticsDisplayMode('collapsed')).toBe('collapsed');
    expect(resolveDiagnosticsDisplayMode('hidden')).toBe('hidden');
  });
});
