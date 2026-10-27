import { test, expect } from '@playwright/test';
import { DISCLAIMER_GATE_ENABLED } from '../../src/lib/labs-flags.js';

const TOC_KEY = 'wwl-toc-accepted';
const DECLINED_KEY = 'wwl-toc-declined';

test.describe('Labs disclaimer gate', () => {
  test.skip(!DISCLAIMER_GATE_ENABLED, 'Set DISCLAIMER_GATE_ENABLED to true in labs-flags.js');
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('wwl-toc-accepted');
        sessionStorage.removeItem('wwl-toc-declined');
        localStorage.removeItem('vanduo-labs-demos-disclaimer-v1');
      } catch {
        /* ignore */
      }
    });
  });

  test('accept unlocks the app shell', async ({ page }) => {
    await page.goto('/#home');
    await expect(page.getByTestId('disclaimer-gate')).toBeVisible();
    await expect(page.locator('.vd-site-dock')).toHaveCount(0);

    await page.getByTestId('disclaimer-accept').click();
    await expect(page.getByTestId('disclaimer-gate')).toHaveCount(0);
    await expect(page.locator('.vd-site-dock')).toBeVisible();
    await expect(page.locator('.hero-title')).toBeVisible();

    const stored = await page.evaluate((key) => localStorage.getItem(key), TOC_KEY);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored);
    expect(parsed.version).toBe('1');
    expect(typeof parsed.acceptedAt).toBe('string');
  });

  test('decline shows farewell; re-read reopens gate', async ({ page }) => {
    await page.goto('/#home');
    await expect(page.getByTestId('disclaimer-gate')).toBeVisible();

    await page.getByTestId('disclaimer-decline').click();
    await expect(page.getByTestId('disclaimer-farewell')).toBeVisible();
    await expect(page).toHaveURL(/#farewell/);

    const declined = await page.evaluate((key) => sessionStorage.getItem(key), DECLINED_KEY);
    expect(declined).toBe('1');

    await page.getByTestId('disclaimer-reread').click();
    await expect(page.getByTestId('disclaimer-gate')).toBeVisible();
    await expect(page.getByTestId('disclaimer-farewell')).toHaveCount(0);
  });

  test('lib helpers persist versioned acceptance', async ({ page }) => {
    await page.goto('/tests/fixtures/blank-harness.html');
    const result = await page.evaluate(async () => {
      const mod = await import('/src/lib/disclaimer.js');
      const { TOC_VERSION } = await import('/src/content/disclaimer.js');
      mod.clearDisclaimerAcceptance();
      mod.clearDeclinedDisclaimer();
      expectFalse(mod.hasAcceptedDisclaimer());
      mod.acceptDisclaimer(TOC_VERSION);
      const accepted = mod.hasAcceptedDisclaimer(TOC_VERSION);
      const payload = mod.readDisclaimerAcceptance();
      mod.clearDisclaimerAcceptance();
      mod.declineDisclaimer();
      const declined = mod.hasDeclinedDisclaimer(TOC_VERSION);
      mod.clearDeclinedDisclaimer();
      return { TOC_VERSION, accepted, payload, declined };

      function expectFalse(v) {
        if (v) throw new Error('expected false');
      }
    });
    expect(result.TOC_VERSION).toBe('1');
    expect(result.accepted).toBe(true);
    expect(result.payload?.version).toBe('1');
    expect(result.declined).toBe(true);
  });
});
