import { test, expect } from '@playwright/test';
import path from 'node:path';

const shots = path.resolve('qa/local-refresh/screenshots');

test('Hex Earth controls stay on the full stage without the labs dock', async ({ page }) => {
  await page.goto('/#demos/hex-earth');
  if (await page.getByTestId('disclaimer-gate').isVisible())
    await page.getByTestId('disclaimer-accept').click();
  await expect(page.locator('nav.vd-site-dock')).toHaveCount(0);
  await expect(page.locator('header.wwl-earth-launchers')).toHaveCount(0);
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    await page.evaluate((value) => localStorage.setItem('wwl-site-dock', value), edge);
    await page.reload();
    if (await page.getByTestId('disclaimer-gate').isVisible())
      await page.getByTestId('disclaimer-accept').click();
    const stage = page.locator('.wwl-earth-stage');
    await expect(stage.locator('canvas')).toBeVisible();
    await expect(page.locator('nav.vd-site-dock')).toHaveCount(0);
    const panel = page.getByTestId('controls-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('stats-toggle')).toBeVisible();
    await expect(page.getByTestId('reset-layout')).toBeVisible();
    await expect(page.getByTestId('back-to-demos')).toBeVisible();
    await expect(panel.getByText('wwl-hex-earth', { exact: true })).toBeVisible();
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
  await expect(page.getByTestId('controls-panel')).toBeVisible();
  await page.getByTestId('back-to-demos').click();
  await expect(page).toHaveURL(/#demos$/);
  await expect(page.locator('.wwl-earth-stage')).toHaveCount(0);
  await expect(page.locator('nav.vd-site-dock')).toBeVisible();
});

async function main(page, route = 'home') {
  await page.goto('/#' + route);
  if (await page.getByTestId('disclaimer-gate').isVisible())
    await page.getByTestId('disclaimer-accept').click();
  await expect(page.locator('nav.vd-site-dock')).toBeVisible();
}

test('Hex Earth lazy route hides the dock, keeps panels and gestures, and restores the shell on exit', async ({
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
  await expect(page.getByTestId('controls-panel')).toBeVisible();
  await expect(page.locator('nav.vd-site-dock')).toHaveCount(0);
  await expect(page.locator('header.wwl-earth-launchers')).toHaveCount(0);
  await expect(page.getByTestId('status')).not.toHaveText(/loading|failed/i, { timeout: 30000 });
  await expect(page.getByTestId(phone ? 'tier-low' : 'tier-high')).toHaveClass(/active/);
  await expect(page.getByTestId('region-world')).toHaveClass(/active/);
  await expect(page.getByTestId('run-benchmarks')).toHaveText('Run benchmarks');
  if (!phone) {
    const panel = page.getByTestId('controls-panel');
    const before = await panel.boundingBox();
    await page.getByTestId('controls-head').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await panel.boundingBox()).x).toBeGreaterThan(before.x);
  }
  await page.getByTestId('stats-toggle').click();
  await expect(page.getByTestId('stats-panel')).toBeVisible();
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
  await expect(page.locator('nav.vd-site-dock')).toBeVisible();
});
