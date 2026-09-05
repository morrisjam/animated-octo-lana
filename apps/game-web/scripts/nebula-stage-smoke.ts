import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

// Run against the local development server; no accounts or hosted APIs needed.
const origin = process.env.NEBULA_SMOKE_ORIGIN ?? 'http://127.0.0.1:4174';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('The stage study smoke test is local-only.');
}
const output = resolve('build-artifacts/nebula-stage-smoke');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors: string[] = [];
const external: string[] = [];
const failed: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', (request) => failed.push(request.url()));
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(origin).origin && !['data:', 'blob:'].includes(url.protocol)) {
    external.push(url.href);
    await route.abort();
  } else await route.continue();
});
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const captures: string[] = [];
try {
  await page.goto(`${origin}/nebula-workshop.html`);
  await page.getByText('Local GLB / 10,240 triangles / 184 KB', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  const paused = sha(await page.locator('canvas').screenshot());
  await page.waitForTimeout(250);
  if (paused !== sha(await page.locator('canvas').screenshot())) throw new Error('Paused image changed.');
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await page.waitForTimeout(400);
  if (paused === sha(await page.locator('canvas').screenshot())) throw new Error('Nebula flow did not animate.');
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  for (const tilt of [0, 18, 34, 60]) {
    await page.locator('#tilt').fill(String(tilt));
    await page.getByText(`${tilt} degrees`, { exact: true }).waitFor();
    const file = `tilt-${tilt}.png`;
    await page.screenshot({ path: resolve(output, file) });
    captures.push(file);
  }
  for (const id of ['wormhole_luminous_v8_candidate', 'wormhole_nebula_v9_candidate']) {
    await page.locator('#preset').selectOption(id);
    await page.locator(`canvas[data-stage-atmosphere-id="${id}"]`).waitFor();
  }
  const visible = await page.locator('canvas').getAttribute('data-stage-model-visible-id');
  if (visible !== 'wormhole_nebula_v5') throw new Error('Model did not reappear after comparison.');
  await page.locator('#tilt').fill('18');
  await page.setViewportSize({ width: 390, height: 700 });
  const inaccessible = await page.locator('.controls select, .controls input, .controls button, .controls a').evaluateAll((elements) =>
    elements.filter((element) => {
      const box = element.getBoundingClientRect();
      return box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight;
    }).map((element) => element.id || element.textContent));
  if (inaccessible.length) throw new Error(`Controls clipped: ${inaccessible.join(', ')}`);
  await page.screenshot({ path: resolve(output, 'mobile.png') });
  captures.push('mobile.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  const timings = await page.evaluate(async () => {
    const samples: number[] = [];
    let previous = performance.now();
    for (let i = 0; i < 210; i++) {
      const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      if (i >= 30) samples.push(now - previous);
      previous = now;
    }
    samples.sort((a, b) => a - b);
    return { reportOnly: true, samples: samples.length, p95Ms: samples[Math.floor(samples.length * .95)],
      averageMs: samples.reduce((a, b) => a + b, 0) / samples.length };
  });
  const report = { ok: !errors.length && !external.length && !failed.length,
    localOnly: true, generatedAt: new Date().toISOString(), errors, external, failed,
    pauseStable: true, animationChanges: true, comparisonRestoresModel: true, mobileControlsVisible: true, timings, captures };
  writeFileSync(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser.close();
}
