import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import type { CharacterBalanceOverrides } from '../sim/characterBalance';
import type { BalanceReplayComparison } from '../sim/balanceReplayComparison';
import type { PauseMenu } from './pauseMenu';
import type { HudController } from './hud';

declare global {
  interface Window {
    uiBalanceImport(path: string): Promise<any>;
    uiBalanceTest: {
      pause?: PauseMenu;
      hud?: HudController;
      returns: number;
      overrides: CharacterBalanceOverrides;
      gamepad?: Gamepad;
      advanceSample?(): void;
      reviewed?: BalanceReplayComparison;
    };
  }
}

const executablePath = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  chromium.executablePath(),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((path) => path && existsSync(path));

// Real layout is needed for details visibility and controller focus traversal.
describe.skipIf(!executablePath)('UI balance browser regressions', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let origin: string;
  let errors: string[];

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL('../..', import.meta.url)),
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    });
    await server.listen();
    origin = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ executablePath, headless: true });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/__ui_balance_test', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body></body></html>',
    }));
    await page.goto(`${origin}__ui_balance_test`);
    await page.evaluate(() => {
      window.uiBalanceTest = { returns: 0, overrides: {} };
      // Keep browser imports out of Vitest's server-side import transform.
      window.uiBalanceImport = new Function('path', 'return import(path)') as Window['uiBalanceImport'];
    });
  });

  afterEach(async () => {
    await page?.close();
    expect(errors).toEqual([]);
  });

  async function openPause(withReturn = true, heldConfirm = false): Promise<void> {
    await page.evaluate(async ({ withReturn, heldConfirm }) => {
      const pausePath = '/src/view/pauseMenu.ts';
      const tuningPath = '/src/sim/tuning.ts';
      const audioPath = '/src/view/audio/settings.ts';
      const { PauseMenu } = await window.uiBalanceImport(pausePath);
      const { createDefaultTuning } = await window.uiBalanceImport(tuningPath);
      const { DEFAULT_AUDIO_SETTINGS } = await window.uiBalanceImport(audioPath);
      const harness = window.uiBalanceTest;
      harness.gamepad = {
        id: 'Xbox Controller', connected: true, index: 0, axes: [0, 0],
        mapping: 'standard', timestamp: 0, vibrationActuator: null,
        buttons: Array.from({ length: 17 }, (_, index) => ({
          pressed: heldConfirm && index === 0, value: heldConfirm && index === 0 ? 1 : 0, touched: false,
        })),
      } as Gamepad;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [harness.gamepad] });
      harness.pause = new PauseMenu({
        getTuning: createDefaultTuning,
        setTuning: () => {},
        getAudioSettings: () => ({ ...DEFAULT_AUDIO_SETTINGS }),
        setAudioSettings: () => {},
        ...(withReturn ? { onReturnToMenu: () => { harness.returns += 1; } } : {}),
      });
      harness.pause!.setPaused(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, { withReturn, heldConfirm });
  }

  async function pulse(button: number): Promise<void> {
    await page.evaluate(async (button) => {
      const pad = window.uiBalanceTest.gamepad!;
      const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      (pad.buttons as GamepadButton[])[button] = { pressed: true, value: 1, touched: true };
      await tick();
      (pad.buttons as GamepadButton[])[button] = { pressed: false, value: 0, touched: false };
      await tick();
    }, button);
  }

  test('requires confirmation, supports cancel/back, and calls the optional return hook once', async () => {
    await openPause();
    const confirmation = page.locator('.pause-return-menu');
    await page.getByText('Return to Menu', { exact: true }).click();
    expect(await page.evaluate(() => window.uiBalanceTest.returns)).toBe(0);
    await page.getByRole('button', { name: 'Keep Playing', exact: true }).click();
    expect(await confirmation.getAttribute('open')).toBeNull();
    expect(await page.evaluate(() => window.uiBalanceTest.pause!.isPaused())).toBe(true);
    await pulse(0);
    expect(await confirmation.getAttribute('open')).not.toBeNull();
    await pulse(1);
    expect(await confirmation.getAttribute('open')).toBeNull();
    await pulse(0);
    await pulse(13);
    expect(await page.locator(':focus').textContent()).toBe('Keep Playing');
    await pulse(13);
    expect(await page.locator(':focus').textContent()).toBe('Leave Match');
    await pulse(0);
    expect(await page.evaluate(() => window.uiBalanceTest.returns)).toBe(1);
    expect(await page.evaluate(() => window.uiBalanceTest.pause!.isPaused())).toBe(false);
    await page.evaluate(() => window.uiBalanceTest.pause!.setPaused(true));
    expect(await confirmation.getAttribute('open')).toBeNull();
  });

  test('ignores a held gameplay confirm and omits return when no callback is supplied', async () => {
    await openPause(false, true);
    expect(await page.evaluate(() => window.uiBalanceTest.pause!.isPaused())).toBe(true);
    expect(await page.locator('.pause-return-menu').isVisible()).toBe(false);
    await page.evaluate(async () => {
      (window.uiBalanceTest.gamepad!.buttons as GamepadButton[])[0] = { pressed: false, value: 0, touched: false };
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await pulse(0);
    expect(await page.evaluate(() => window.uiBalanceTest.pause!.isPaused())).toBe(false);
  });

  test('keeps advanced rules closed and hides unavailable fighter/AI editors', async () => {
    await openPause();
    await page.locator('.pause-tabs').getByRole('button', { name: 'Balance Lab' }).click();
    const global = page.locator('.balance-advanced-section').filter({ hasText: 'Advanced global rules' });
    expect(await global.getAttribute('open')).toBeNull();
    expect(await global.locator('input').first().isVisible()).toBe(false);
    expect(await page.getByText('Advanced AI behavior', { exact: true }).isVisible()).toBe(false);
    expect(await page.getByText('Advanced fighter tuning', { exact: true }).isVisible()).toBe(false);
    await global.locator(':scope > summary').click();
    await global.locator('.balance-global-group > summary').first().click();
    expect(await global.locator('input').first().isVisible()).toBe(true);
  });

  test('refreshes HUD timing/fingerprint only from active overrides, including import and reset', async () => {
    const results = await page.evaluate(async () => {
      const hudPath = '/src/view/hud.ts';
      const balancePath = '/src/sim/characterBalance.ts';
      const simPath = '/src/sim/sim.ts';
      const { createHud } = await window.uiBalanceImport(hudPath);
      const { createCharacterBalanceConfig, sanitiseCharacterBalanceOverrides } = await window.uiBalanceImport(balancePath);
      const { createInitialState, getRenderSnapshot } = await window.uiBalanceImport(simPath);
      document.body.innerHTML = '<div id="hud">' + [
        'p1Fuel', 'p2Fuel', 'p1Breaks', 'p2Breaks', 'status', 'controls', 'frameData', 'rollbackDiagnostics',
      ].map((id) => `<div id="${id}"></div>`).join('') + '</div>';
      const harness = window.uiBalanceTest;
      const hud = createHud({ getActiveCharacterBalanceOverrides: () => harness.overrides });
      const snapshot = getRenderSnapshot(createInitialState({ loadout: { P1: 'vanguard', P2: 'duelist' } }));
      hud.setTrainingFrameDataVisible(true);
      const render = () => { hud.update(snapshot); return document.querySelector('#frameData')!.textContent; };
      const original = render();
      const vanguard = createCharacterBalanceConfig('vanguard');
      vanguard.moves.launch.startupFrames = 60;
      const staged = render();
      harness.overrides = { vanguard };
      const applied = render();
      harness.overrides = sanitiseCharacterBalanceOverrides(JSON.parse(JSON.stringify(harness.overrides)));
      const imported = render();
      harness.overrides.vanguard!.moves.launch.startupFrames = 30;
      const mutated = render();
      hud.setTrainingFrameDataVisible(false);
      harness.overrides = {};
      hud.update(snapshot);
      hud.setTrainingFrameDataVisible(true);
      const reset = render();
      return { original, staged, applied, imported, mutated, reset };
    });
    expect(results.staged).toBe(results.original);
    expect(results.applied).toContain('60f startup');
    expect(results.applied).toContain('Active tuning:');
    expect(results.imported).toBe(results.applied);
    expect(results.mutated).toContain('30f startup');
    expect(results.reset).toBe(results.original);
  });

  test('captures an earlier-finishing candidate through the Balance Lab UI', async () => {
    await page.evaluate(async () => {
      const { PauseMenu } = await window.uiBalanceImport('/src/view/pauseMenu.ts');
      const { DEFAULT_AUDIO_SETTINGS } = await window.uiBalanceImport('/src/view/audio/settings.ts');
      const { createInitialState, step } = await window.uiBalanceImport('/src/sim/sim.ts');
      const { createCharacterBalanceConfig } = await window.uiBalanceImport('/src/sim/characterBalance.ts');
      const { applyBalanceScenario } = await window.uiBalanceImport('/src/sim/balanceScenarios.ts');
      const { createAiController } = await window.uiBalanceImport('/src/sim/ai.ts');
      const { tickAiControllerWithRole } = await window.uiBalanceImport('/src/sim/aiControllerRoles.ts');
      const { createMatchTelemetryTracker } = await window.uiBalanceImport('/src/sim/matchTelemetry.ts');
      const { LocalRoundReplayRecorder } = await window.uiBalanceImport('/src/sim/localRoundReplayRecorder.ts');
      const record = (startupFrames: number) => {
        const vanguard = createCharacterBalanceConfig('vanguard');
        vanguard.moves.dunk.startupFrames = startupFrames;
        const state = createInitialState({
          seed: 42, loadout: { P1: 'vanguard', P2: 'duelist' }, characterBalanceOverrides: { vanguard },
        });
        applyBalanceScenario(state, 'zero_fuel_chase');
        const recorder = new LocalRoundReplayRecorder({
          rulesetVersion: 'test-rules', simBuildHash: 'test-build', roundNumber: 1,
          seed: 42, loadout: state.loadout, fixedDt: 1 / 60,
          rules: state.rules, tuning: state.tuning, characterBalanceOverrides: state.characterBalanceOverrides,
          startingSituationId: 'zero_fuel_chase', sourceLabel: 'Finish reliability',
        });
        const telemetry = createMatchTelemetryTracker(state);
        let controller = createAiController({ seed: 42, profileId: 'veteran' });
        for (let frame = 0; frame < 1800 && !state.winner; frame += 1) {
          const tick = tickAiControllerWithRole(state, 'P1', controller, 'adaptive');
          controller = tick.next;
          const input = { p1: tick.input, p2: tickAiControllerWithRole(state, 'P2', controller, 'passive').input };
          step(state, input, 1 / 60);
          recorder.recordFrame(input, state);
          telemetry.recordFrame(input, state, 1 / 60);
        }
        return { state, replay: recorder.buildPayload(), telemetry: telemetry.toSummary() };
      };
      const samples = [record(1), record(60)];
      let sampleIndex = 0;
      const harness = window.uiBalanceTest;
      harness.advanceSample = () => { sampleIndex += 1; };
      harness.pause = new PauseMenu({
        getTuning: () => samples[sampleIndex].state.tuning,
        setTuning: () => {},
        getAudioSettings: () => ({ ...DEFAULT_AUDIO_SETTINGS }),
        setAudioSettings: () => {},
        getCharacterBalanceOverrides: () => samples[sampleIndex].state.characterBalanceOverrides,
        getActiveCharacterBalanceOverrides: () => samples[sampleIndex].state.characterBalanceOverrides,
        getBalanceLoadout: () => samples[sampleIndex].state.loadout,
        setCharacterBalanceOverrides: () => {},
        getBalanceSampleSequence: () => sampleIndex,
        getBalanceTelemetry: () => samples[sampleIndex].telemetry,
        getAiRoundReplay: () => samples[sampleIndex].replay,
        onReviewAiReplayComparison: (comparison: BalanceReplayComparison) => { harness.reviewed = comparison; },
      });
      harness.pause!.openBalanceLab();
    });
    await page.getByRole('button', { name: 'Capture Run As Baseline', exact: true }).click();
    await page.evaluate(() => {
      window.uiBalanceTest.advanceSample!();
      window.uiBalanceTest.pause!.openBalanceLab();
    });
    await page.getByRole('button', { name: 'Compare Incident A/B', exact: true }).click();
    const comparison = await page.evaluate(() => window.uiBalanceTest.reviewed);
    expect(comparison?.candidate).not.toBeNull();
    expect(comparison!.candidate!.payload.inputTimeline.length).toBeLessThan(comparison!.baseline.payload.inputTimeline.length);
    expect(await page.getByText(/Common interval: F0/).textContent()).toContain('Finish delta (candidate - baseline): -');
  }, 20000);

  test.each(['endless', 'best_of_3', 'training', 'balance_sparring', 'cpu_vs_cpu', 'arcade']) (
    'shows only relevant arcade controls in %s and keeps Start/Back on screen', async (mode) => {
      await page.evaluate(async (mode) => {
        const path = '/src/view/startMenu.ts';
        const { StartMenu } = await window.uiBalanceImport(path);
        const menu = new StartMenu({
          initialMode: mode, enabledModes: [mode], onStartMode: () => {}, onReturnHome: () => {}, onPlayAgain: () => {},
        });
        menu.showHome();
      }, mode);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
      await page.getByRole('button', { name: 'Local', exact: true }).click();
      const arcadeControls = page.locator('[data-arcade-only]');
      expect(await arcadeControls.count()).toBe(5);
      for (const element of await arcadeControls.all()) {
        expect(await element.isVisible()).toBe(mode === 'arcade');
      }
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const selected = await page.locator('.start-local-panel .start-menu-row.active').textContent();
      expect(selected).toContain(mode === 'arcade' ? 'Continues' : 'P1');
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 700 }]) {
        await page.setViewportSize(viewport);
        for (const action of await page.locator('.start-local-actions button').all()) {
          const box = await action.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        }
      }
    }, 20000,
  );
});
