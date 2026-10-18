import { test, expect } from '@playwright/test';
import path from 'node:path';
const shots = path.resolve('qa/local-refresh/screenshots');
test('chat composer remains reachable when the viewport shrinks for a keyboard', async ({
  page,
}) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
  await page.setViewportSize({ width: 390, height: 390 });
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('A short phone message');
  await input.scrollIntoViewIfNeeded();
  await expect(input).toBeInViewport();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('[data-role="assistant"]')).toContainText('A short phone message');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Hex Earth panels fit the stage at every dock edge and after resizing', async ({ page }) => {
  const startedWide = (page.viewportSize()?.width || 0) > 640;
  await main(page, 'demos/hex-earth');
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    await page.evaluate((value) => localStorage.setItem('wwl-site-dock', value), edge);
    await page.reload();
    const stage = page.locator('.wwl-earth-stage');
    await expect(stage.locator('canvas')).toBeVisible();
    if ((page.viewportSize()?.width || 0) <= 640) await page.getByTestId('controls-toggle').click();
    const panel = page.getByTestId('controls-panel');
    await expect(panel).toBeVisible();
    await expect
      .poll(async () => {
        const s = await stage.boundingBox();
        const p = await panel.boundingBox();
        return (
          p.x >= s.x - 1 &&
          p.y >= s.y - 1 &&
          p.x + p.width <= s.x + s.width + 1 &&
          p.y + p.height <= s.y + s.height + 1
        );
      })
      .toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 600 });
  if (startedWide) {
    await expect(page.getByTestId('controls-panel')).toBeHidden();
    await page.getByTestId('controls-toggle').click();
  }
  await expect(page.getByTestId('controls-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close controls', exact: true }).click();
  await expect(page.getByTestId('controls-panel')).toBeHidden();
});

async function main(page, route = 'home') {
  await page.goto('/#' + route);
  if (await page.getByTestId('disclaimer-gate').isVisible())
    await page.getByTestId('disclaimer-accept').click();
  await expect(page.locator('nav.vd-site-dock')).toBeVisible();
}
test('Compare is lazy, keeps two pane statuses on mobile, and does not load models on entry', async ({
  page,
}, info) => {
  const modelDownloads = [];
  page.on('request', (request) => {
    if (/huggingface|\.litertlm(?:\?|$)|params_shard_|onnx\/model_q4/.test(request.url()))
      modelDownloads.push(request.url());
  });
  await main(page, 'demos/aichat');
  const compareButton = page.getByRole('button', { name: 'Compare', exact: true });
  await compareButton.click();
  await expect(compareButton).toHaveAttribute('aria-pressed', 'true');
  const modelA = page.getByLabel('Model A');
  const modelB = page.getByLabel('Model B');
  await expect(modelA).toHaveValue('gemma-4-E2B-it-web');
  await expect(modelB).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Load pair' })).toBeDisabled();
  await modelB.selectOption('LFM2.5-2.6B-q4f16-ONNX');
  await expect(page.getByRole('button', { name: 'Load pair' })).toBeEnabled();
  const tabs = page.locator('.wwl-compare-tabs');
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2);
  if ((page.viewportSize()?.width || 0) <= 700) {
    await expect(tabs).toBeVisible();
    await tabs.locator('[role="tab"]').nth(1).click();
    await expect(tabs.locator('[role="tab"]').nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.locator('[role="tab"]').nth(0)).toHaveAttribute('aria-selected', 'true');
  }
  expect(modelDownloads).toEqual([]);
  await page.screenshot({
    path: path.join(shots, `${info.project.name}-compare-setup.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const openSettingsButton = page.getByRole('button', { name: 'Open Settings' });
  if (await openSettingsButton.isVisible()) {
    await openSettingsButton.click();
  }
  await expect(page.getByRole('button', { name: 'Load AI Model' })).toBeVisible();
  expect(modelDownloads).toEqual([]);
});
test('actual Vue chat stops, resets, preserves General history, escapes HTML and honors IME', async ({
  page,
}, info) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeVisible();
  await input.fill('composing');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(await page.evaluate(() => window.chatQA.calls.length)).toBe(0);
  await input.fill('hold');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.wwl-ai-messages')).toContainText('Generation stopped');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await input.fill('html');
  await input.press('Enter');
  await expect(page.locator('.wwl-ai-messages img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.getByLabel('Conversation', { exact: true })).toHaveCount(0);
  await input.fill('follow up');
  await input.press('Enter');
  await expect(page.locator('.wwl-ai-messages')).toContainText('Answer: follow up');
  await expect(page.locator('.wwl-ai-messages')).toContainText('onerror');
  await page.screenshot({
    path: path.join(shots, `${info.project.name}-chat-general.png`),
    fullPage: true,
  });
  await input.fill('hold');
  await input.press('Enter');
  await page.evaluate(() => window.chatQA.unmount());
  expect(await page.evaluate(() => window.chatQA.canceled)).toBeGreaterThan(0);
});
test('search works offline after index load with denied storage and no model download', async ({
  page,
  context,
}, info) => {
  const modelRequests = [];
  page.on('request', (r) => {
    if (/huggingface|onnx|webllm-wasm/.test(r.url())) modelRequests.push(r.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
  });
  await page.goto('/demo/hybrid-search-demo.html');
  const input = page.getByRole('combobox', { name: 'Search documentation' });
  await expect(input).toBeVisible();
  await input.fill('Dock');
  await expect(page.locator('.wwl-neptune-result').first()).toContainText('Dock');
  await context.setOffline(true);
  await page.getByRole('combobox').first().selectOption('embeddinggemma');
  await input.fill('Login');
  await expect(page.locator('.wwl-neptune-result').first()).toContainText('Login');
  expect(modelRequests).toEqual([]);
  await page.screenshot({
    path: path.join(shots, `${info.project.name}-search.png`),
    fullPage: true,
  });
});
test('missing WebGPU is explained before any download', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.goto('/demo/ai-chat-demo.html');
  const openSettings = page.getByRole('button', { name: 'Open Settings' });
  if (await openSettings.isVisible()) {
    await openSettings.click();
  }
  await expect(
    page.getByRole('button', { name: /Load AI Model|Runtime unsupported/ }),
  ).toBeDisabled();
  await expect(page.locator('.wwl-ai-chat-primary')).toContainText(/WebGPU/);
});
test('Hex Earth lazy route retains dock, panels, gestures and releases canvas on exit', async ({
  page,
}, info) => {
  const geography = [];
  page.on('request', (r) => {
    if (/(?:land|lakes)-.*\.json/.test(r.url())) geography.push(r.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await main(page);
  expect(geography).toEqual([]);
  await page.goto('/#demos/hex-earth');
  const stage = page.locator('.wwl-earth-demo');
  await expect(stage.locator('canvas')).toBeVisible();
  await expect.poll(() => geography.length).toBeGreaterThan(0);
  const phone = (page.viewportSize()?.width || 0) <= 640;
  if (phone) await page.getByTestId('controls-toggle').click();
  await expect(page.getByTestId('status')).not.toHaveText(/loading|failed/i, { timeout: 30000 });
  await expect(page.getByTestId(phone ? 'tier-low' : 'tier-mid')).toHaveClass(/active/);
  await expect(page.getByTestId('run-benchmarks')).toHaveText('Run benchmarks');
  if (!phone) {
    const panel = page.getByTestId('controls-panel');
    const before = await panel.boundingBox();
    await page.getByTestId('controls-head').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await panel.boundingBox()).x).toBeGreaterThan(before.x);
  }
  await page.getByRole('button', { name: 'Close controls', exact: true }).click();
  await page.getByTestId('stats-toggle').click();
  await expect(page.getByTestId('stats-panel')).toBeVisible();
  await expect(page.locator('nav.vd-site-dock')).toBeVisible();
  await page.screenshot({
    path: path.join(shots, `${info.project.name}-hex-earth.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close stats', exact: true }).click();
  const canvas = stage.locator('canvas');
  const bounds = await canvas.boundingBox();
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 1,
    clientX: bounds.x + 100,
    clientY: bounds.y + 100,
    pointerType: phone ? 'touch' : 'mouse',
    button: 0,
  });
  await canvas.dispatchEvent('pointermove', {
    pointerId: 1,
    clientX: bounds.x + 130,
    clientY: bounds.y + 130,
    pointerType: phone ? 'touch' : 'mouse',
  });
  await canvas.dispatchEvent('pointerup', {
    pointerId: 1,
    clientX: bounds.x + 130,
    clientY: bounds.y + 130,
    pointerType: phone ? 'touch' : 'mouse',
  });
  await page.goto('/#home');
  await expect(stage).toHaveCount(0);
});

test('General chat never requests documentation retrieval assets', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => {
    if (/\/data\/search/.test(request.url())) requests.push(request.url());
  });
  await page.goto('/tests/fixtures/chat-vue-harness.html');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('VdDock placement');
  await input.press('Enter');
  await expect(page.locator('.wwl-ai-messages')).toContainText('Answer: VdDock placement');
  expect(requests).toEqual([]);
});
