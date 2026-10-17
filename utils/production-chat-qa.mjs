/** Real production UI inference, including worker loading under CSP. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';
const reports = [];
const model = process.env.PRODUCTION_CHAT_MODEL || 'gemma-4-E2B-it-web';
const label = model
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const base = (process.env.PRODUCTION_CHAT_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
for (const [name, type] of Object.entries({ chromium, webkit })) {
  if (process.env.PRODUCTION_CHAT_BROWSER && process.env.PRODUCTION_CHAT_BROWSER !== name) continue;
  const browser = await type.launch({
    headless: true,
    ...(name === 'chromium' ? { channel: 'chrome' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log(name, 'pageerror', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(name, m.text());
  });
  await page.addInitScript(() => {
    window.cspQA = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.cspQA.push({ directive: e.violatedDirective, uri: e.blockedURI }),
    );
  });
  try {
    await page.goto(`${base}/demo/ai-chat-demo.html`);
    const gpu = await page.evaluate(async () => {
      const a = await navigator.gpu?.requestAdapter();
      return {
        supported: !!a,
        features: a ? [...a.features] : [],
        info: a?.info
          ? {
              vendor: a.info.vendor,
              architecture: a.info.architecture,
              device: a.info.device,
              description: a.info.description,
            }
          : null,
      };
    });
    await page.getByLabel('Model · download size shown before loading').selectOption(model);
    await page.getByRole('button', { name: 'Load AI Model' }).click();
    console.log(name, 'loading');
    await page.waitForFunction(
      () =>
        !!document.querySelector('textarea[aria-label="Message"]') ||
        !!document.querySelector('.wwl-ai-error'),
      null,
      { timeout: 120000 },
    );
    if (await page.locator('.wwl-ai-error').count())
      throw Error(await page.locator('.wwl-ai-error').innerText());
    console.log(name, 'loaded');
    const input = page.getByRole('textbox', { name: 'Message' });
    await input.fill('Reply with exactly: ready');
    await input.press('Enter');
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 120000 });
    const reply = await page.locator('[data-role="assistant"]').last().innerText();
    await page.context().setOffline(true);
    await input.fill('Reply briefly with: offline ready');
    await input.press('Enter');
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 120000 });
    const offlineReply = await page.locator('[data-role="assistant"]').last().innerText();
    await page.context().setOffline(false);
    assert.equal(await page.getByLabel('Conversation', { exact: true }).count(), 0);
    await page.screenshot({
      path: `qa/local-refresh/screenshots/${name}-production-chat-${label}.png`,
      fullPage: true,
    });
    reports.push({
      browser: name,
      version: browser.version(),
      gpu,
      reply,
      offlineReply,
      model,
      violations: await page.evaluate(() => window.cspQA),
      errors,
    });
  } catch (error) {
    reports.push({
      browser: name,
      version: browser.version(),
      model,
      error: error.message,
      ui: await page
        .locator('body')
        .innerText({ timeout: 1000 })
        .catch(() => null),
      violations: await page.evaluate(() => window.cspQA).catch(() => null),
      errors,
    });
  }
  await fs.writeFile(
    `qa/local-refresh/production-chat-${label}.json`,
    JSON.stringify(reports, null, 2),
  );
  console.log(name, JSON.stringify(reports.at(-1)));
  await browser.close();
}
await fs.writeFile(
  `qa/local-refresh/production-chat-${label}.json`,
  JSON.stringify(reports, null, 2),
);
console.log(JSON.stringify(reports, null, 2));
