/** Production settings, lazy loading and responsive layout without model downloads. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }),
      requests = [];
    page.on('request', (r) => {
      if (/huggingface|\.litertlm|params_shard_|\/voices\/|\/onnx\//.test(r.url()))
        requests.push(r.url());
    });
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.cspViolations.push(e.violatedDirective),
      );
    });
    await page.goto('http://127.0.0.1:4178/#demos/aichat');
    if (
      await page
        .getByTestId('disclaimer-gate')
        .isVisible()
        .catch(() => false)
    )
      await page.getByTestId('disclaimer-accept').click();
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.waitFor();
    if ((await settings.getAttribute('aria-expanded')) === 'false') await settings.click();
    await page
      .getByRole('combobox', { name: 'Reply delivery', exact: true })
      .selectOption('complete');
    await page.getByText('Voice settings', { exact: true }).click();
    const voice = page.getByLabel('English Kokoro voice');
    assert.equal(await voice.locator('option').count(), 28);
    await voice.selectOption('bf_emma');
    await page.locator('#wwl-ai-model-select').selectOption('LFM2.5-2.6B-q4f16-ONNX');
    await voice.scrollIntoViewIfNeeded();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    assert.match(
      (await dialog.locator('.vd-modal-panel').getAttribute('class')) || '',
      /vd-modal-panel-xl/,
    );
    if (width === 390) {
      const stacked = await dialog.evaluate((root) => {
        const model = root.querySelector('[aria-label="Model settings"]').getBoundingClientRect();
        const voice = root.querySelector('[aria-label="Voice settings"]').getBoundingClientRect();
        return voice.top > model.top + 20;
      });
      assert.equal(stacked, true);
    }
    await page.screenshot({ path: `qa/checked-stream/settings-${width}.png` });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    const delivery = page.getByRole('combobox', { name: 'Reply delivery', exact: true });
    await delivery.waitFor();
    assert.equal(await delivery.inputValue(), 'complete');
    await delivery.selectOption('checked-stream');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    if ((await settings.getAttribute('aria-expanded')) === 'false') await settings.click();
    assert.equal(
      await page.getByRole('combobox', { name: 'Reply delivery', exact: true }).inputValue(),
      'checked-stream',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    assert.equal(overflow, false);
    assert.deepEqual(requests, []);
    const violations = await page.evaluate(() => window.cspViolations);
    assert.deepEqual(violations, []);
    report.push({
      width,
      voiceOptions: 28,
      sharedDelivery: true,
      overflow,
      assetRequests: requests,
      cspViolations: violations,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile('qa/checked-stream/production-ui.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
