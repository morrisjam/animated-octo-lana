import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, test, vi } from 'vitest';
import {
  areArcadeRunHistoriesEqual, createEmptyArcadeRunHistory, mergeArcadeRunHistories,
  sanitiseArcadeRunHistory, type ArcadeRunHistory,
} from './sim/arcadeHistory';

const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);

// Execute the real composition-root functions with fake platform boundaries, not a renderer/DOM.
function loadFunctions(names: string[], globals: Record<string, any>) {
  const declarations = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
  expect(declarations).toHaveLength(names.length);
  const code = ts.transpileModule(declarations.map((node) => node.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  runInNewContext(code, globals);
  return globals;
}

function history(id: string): ArcadeRunHistory {
  return sanitiseArcadeRunHistory({ entries: [{
    id, completedAt: '2026-09-05T00:00:00Z', playerCharacterId: 'vanguard', aiDifficulty: 'cadet',
    outcome: 'completed', completionSeconds: 100, stagesCleared: 4, totalStages: 4, continuesUsed: 0, retriesUsed: 0,
  }] });
}

function persistenceFixture() {
  const stored = new Map<string, ArcadeRunHistory>([['A', history('run-A')], ['B', history('run-B')]]);
  const globals: Record<string, any> = {
    scopedPersistenceUserId: 'local:web', scopedPersistenceGeneration: 0,
    sessionAccountId: null, arcadeHistory: history('guest-run'), profileSettingsCache: {},
    scopedSettingsWriteQueue: Promise.resolve(), scopedArcadeHistoryWriteQueue: Promise.resolve(),
    scopedSettingsRevisions: new Map(), scopedArcadeHistoryRevisions: new Map(),
    PLATFORM_PERSISTENCE_KEYS: { settings: 'settings', arcadeHistory: 'history' },
    SETTINGS_STORAGE_KEY: 'legacy-settings', ARCADE_HISTORY_STORAGE_KEY: 'legacy-history',
    MAX_ARCADE_HISTORY_ENTRIES: 100,
    createEmptyArcadeRunHistory, sanitiseArcadeRunHistory, mergeArcadeRunHistories, areArcadeRunHistoriesEqual,
    coerceStoredSettings: (value: unknown) => value, createDefaultSettings: () => ({ mode: 'endless' }),
    applyLoadedProfileSettings: vi.fn(), applyArcadeHistoryView: vi.fn(),
    asRecord: (value: unknown) => value,
    buildHistorySyncProfileSettingsPayload: (settings: object, arcadeHistory: ArcadeRunHistory) => ({ ...settings, arcadeHistory }),
    runtimeConfig: { features: { debugToolsEnabled: false } },
    platform: {
      kind: 'web', lifecycleHooks: { userChanged: vi.fn() },
      persistence: {
        read: vi.fn(async (key: string, { userId }: { userId: string }) => (
          key === 'history' && stored.has(userId)
            ? { ok: true, value: stored.get(userId), metadata: { revision: userId } }
            : { ok: false }
        )),
        write: vi.fn(async (key: string, value: ArcadeRunHistory, { userId }: { userId: string }) => {
          if (key === 'history') stored.set(userId, value);
          return { ok: true, metadata: { revision: `${userId}-saved` } };
        }),
        writeJson: vi.fn(() => ({ ok: true })),
      },
      profile: { saveProfile: vi.fn(async (_id: string, profile: unknown) => profile) },
    },
  };
  loadFunctions([
    'resolveScopedPersistenceUserId', 'hydrateScopedPersistence', 'persistArcadeHistory',
    'queueScopedArcadeHistoryWrite', 'ensureScopedRevision', 'writeScopedValue', 'syncArcadeHistoryWithProfile',
  ], globals);
  const switchTo = async (account: string | null) => {
    globals.sessionAccountId = account;
    await globals.hydrateScopedPersistence(account);
    await globals.scopedArcadeHistoryWriteQueue;
  };
  return { globals, stored, switchTo };
}

describe('account-scoped arcade history integration', () => {
  test('switches A to B to A without guest or cross-account history migration', async () => {
    const { globals: g, stored, switchTo } = persistenceFixture();
    for (const account of ['A', 'B', 'A']) {
      await switchTo(account);
      expect(g.arcadeHistory.entries.map((entry) => entry.id)).toEqual([`run-${account}`]);
    }
    expect(stored.get('B')?.entries.map((entry) => entry.id)).toEqual(['run-B']);
    expect(g.platform.persistence.writeJson).not.toHaveBeenCalled();
    for (const [, options] of g.platform.persistence.read.mock.calls) expect(options.legacySources).toEqual([]);
  });

  test('a missing destination starts empty and settings reset before asynchronous reads', async () => {
    const { globals: g, switchTo } = persistenceFixture();
    await switchTo('A');
    g.profileSettingsCache = { arcadeHistory: history('run-A') };
    const switching = switchTo('new-account');
    expect(g.arcadeHistory.entries).toEqual([]);
    expect(g.profileSettingsCache).toEqual({});
    expect(g.applyLoadedProfileSettings).toHaveBeenLastCalledWith({ mode: 'endless' });
    await switching;
    expect(g.arcadeHistory.entries).toEqual([]);
  });

  test('late account reads cannot overwrite the destination account', async () => {
    const { globals: g, switchTo } = persistenceFixture();
    const read = g.platform.persistence.read.getMockImplementation();
    let finishA!: () => void;
    const wait = new Promise<void>((resolve) => { finishA = resolve; });
    g.platform.persistence.read.mockImplementation(async (key, options) => {
      if (options.userId === 'A') await wait;
      return read(key, options);
    });
    const switchingA = switchTo('A');
    await vi.waitFor(() => expect(g.platform.persistence.read).toHaveBeenCalled());
    await switchTo('B');
    finishA();
    await switchingA;
    expect(g.arcadeHistory.entries.map((entry) => entry.id)).toEqual(['run-B']);
  });

  test('pending writes stay with the originating account and finish before rehydration', async () => {
    const { globals: g, stored, switchTo } = persistenceFixture();
    await switchTo('A');
    g.arcadeHistory = history('new-A');
    g.persistArcadeHistory();
    await switchTo('B');
    expect(stored.get('A')?.entries.map((entry) => entry.id)).toEqual(['new-A']);
    expect(g.arcadeHistory.entries.map((entry) => entry.id)).toEqual(['run-B']);
    await switchTo('A');
    expect(g.arcadeHistory.entries.map((entry) => entry.id)).toEqual(['new-A']);
  });

  test('same-account hydration preserves unsynced progress and guest legacy reads stay guest-only', async () => {
    const { globals: g, switchTo } = persistenceFixture();
    await switchTo('A');
    g.arcadeHistory = history('unsynced-A');
    await switchTo('A');
    expect(new Set(g.arcadeHistory.entries.map((entry) => entry.id))).toEqual(new Set(['unsynced-A', 'run-A']));
    await switchTo(null);
    expect(g.platform.persistence.read).toHaveBeenLastCalledWith('history', {
      userId: 'local:web', legacySources: [{ key: 'legacy-history' }],
    });
    expect(g.arcadeHistory.entries).toEqual([]);
  });

  test('late profile saves cannot restore old account history or settings', async () => {
    const { globals: g, switchTo } = persistenceFixture();
    await switchTo('A');
    let finishSave!: (value: unknown) => void;
    g.platform.profile.saveProfile.mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve; }));
    const saving = g.syncArcadeHistoryWithProfile('A', {});
    await switchTo('B');
    finishSave({ settings: { arcadeHistory: history('server-A') } });
    await saving;
    await g.syncArcadeHistoryWithProfile('A', { arcadeHistory: history('stale-A') });
    expect(g.arcadeHistory.entries.map((entry) => entry.id)).toEqual(['run-B']);
    expect(g.profileSettingsCache).toEqual({});
  });
});

describe('composition-root lifecycle wiring', () => {
  test('queue implementation and online status formatters have no static main import', () => {
    const staticImports = parsed.statements.filter(ts.isImportDeclaration)
      .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(staticImports).not.toContain('./net/rankedQueueClient');
    expect(staticImports).not.toContain('./net/onlineMenuState');
    expect(staticImports).toContain('./net/lazyRankedQueueClient');
  });

  test('explicit deferred chunks take precedence over the broad initial net chunk', () => {
    const config = ts.createSourceFile('vite.config.ts', readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    let chunkMethod: ts.MethodDeclaration | undefined;
    function visit(node: ts.Node): void {
      if (ts.isMethodDeclaration(node) && node.name.getText(config) === 'manualChunks') chunkMethod = node;
      ts.forEachChild(node, visit);
    }
    visit(config);
    expect(chunkMethod).toBeDefined();
    const code = ts.transpileModule(`function ${chunkMethod!.getText(config)}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const g: Record<string, any> = {};
    runInNewContext(code, g);
    expect(g.manualChunks('C:\\project\\src\\net\\rankedQueueClient.ts')).toBe('rankedQueueClient');
    expect(g.manualChunks('/project/src/net/onlineMenuState.ts')).toBe('onlineMenuState');
    expect(g.manualChunks('/project/src/net/lazyRankedQueueClient.ts')).toBe('onlineRuntime');
    expect(g.manualChunks('/project/src/net/onlineInputPump.ts')).toBe('onlineRuntime');
  });

  test.each(['endless', 'training', 'arcade'])('starting %s leaves the home queue before switching modes', (mode) => {
    const calls: string[] = [];
    const g = loadFunctions(['beginUserInitiatedMode', 'leaveActiveOnlineSessionBeforeTeardown'], {
      startupMenuGuardArmed: true, onlineMatchContext: null,
      rankedQueueClient: { cancel: vi.fn(async () => { calls.push('cancel'); }) },
      clearOnlineBootstrapState: vi.fn(), clearOnlineMatchContext: vi.fn(),
      beginMode: vi.fn(() => { calls.push('begin'); }), console,
    });
    g.beginUserInitiatedMode(mode);
    expect(calls).toEqual(['cancel', 'begin']);
    expect(g.rankedQueueClient.cancel).toHaveBeenCalledWith(true);
  });

  test('menu exit preserves completed match settlement but cancels unfinished sessions', () => {
    const cancel = vi.fn(async () => {});
    const g = loadFunctions(['leaveActiveOnlineSessionBeforeTeardown'], {
      onlineMatchContext: { finalOutcome: 'win', sessionCompletionStatus: 'completing' },
      rankedQueueClient: { cancel }, console,
    });
    g.leaveActiveOnlineSessionBeforeTeardown();
    expect(cancel).toHaveBeenLastCalledWith(false);
    g.onlineMatchContext = { finalOutcome: null, sessionCompletionStatus: 'pending' };
    g.leaveActiveOnlineSessionBeforeTeardown();
    expect(cancel).toHaveBeenLastCalledWith(true);
  });

  test('HUD callback resolves current overrides and pause callback returns home', () => {
    const callbacks: Record<string, any> = {};
    const callbackDeclarations: string[] = [];
    for (const node of parsed.statements) {
      if (!ts.isVariableStatement(node)) continue;
      for (const declaration of node.declarationList.declarations) {
        if (!['hud', 'pauseMenu'].includes(declaration.name.getText(parsed))) continue;
        const call = declaration.initializer as ts.CallExpression;
        const options = call.arguments[0] as ts.ObjectLiteralExpression;
        const callbackName = declaration.name.getText(parsed) === 'hud'
          ? 'getActiveCharacterBalanceOverrides' : 'onReturnToMenu';
        const properties = options.properties.filter((property) => (
          property.name?.getText(parsed) === callbackName
        ));
        expect(properties).toHaveLength(1);
        callbackDeclarations.push(`${call.expression.getText(parsed)}({${properties[0].getText(parsed)}});`);
      }
    }
    expect(callbackDeclarations).toHaveLength(2);
    const code = ts.transpileModule(callbackDeclarations.join('\n'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    }).outputText;
    const g = {
      state: { characterBalanceOverrides: { vanguard: { launch: { startupFrames: 60 } } } },
      createHud: (options) => { callbacks.hud = options; },
      createLazyPauseMenu: (options) => { callbacks.pause = options; },
      returnToHome: vi.fn(),
    };
    runInNewContext(code, g);
    expect(callbacks.hud.getActiveCharacterBalanceOverrides()).toBe(g.state.characterBalanceOverrides);
    g.state.characterBalanceOverrides = { vanguard: { launch: { startupFrames: 7 } } };
    expect(callbacks.hud.getActiveCharacterBalanceOverrides()).toBe(g.state.characterBalanceOverrides);
    callbacks.pause.onReturnToMenu();
    expect(g.returnToHome).toHaveBeenCalledTimes(1);
  });
});
