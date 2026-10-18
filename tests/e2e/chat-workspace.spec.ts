import { test, expect } from '@playwright/test';

const settings = (page) => page.getByRole('button', { name: 'Settings', exact: true });
const panel = (page) => page.locator('.wwl-ai-settings-panel');
const composer = (page) => page.getByRole('textbox', { name: 'Message', exact: true });
async function resize(page, viewport) {
  await page.setViewportSize(viewport);
  await expect
    .poll(() =>
      panel(page).evaluate(
        (el) =>
          el.classList.contains('wwl-ai-settings-drawer') ===
          document.querySelector('.wwl-ai-workspace-host').getBoundingClientRect().width < 960,
      ),
    )
    .toBe(true);
}
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let previous = '',
          stable = 0,
          frames = 0;
        function check() {
          const rect = document.querySelector('.wwl-ai-chat-wrap').getBoundingClientRect();
          const current = `${rect.top.toFixed(1)},${rect.height.toFixed(1)},${window.scrollY}`;
          stable = current === previous ? stable + 1 : 0;
          previous = current;
          if (stable >= 4 || ++frames >= 90) resolve();
          else requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      }),
  );
}
async function openSettings(page) {
  if ((await settings(page).getAttribute('aria-expanded')) !== 'true') await settings(page).click();
}
async function closeSettings(page) {
  if ((await settings(page).getAttribute('aria-expanded')) === 'true')
    await page.getByRole('button', { name: 'Close settings' }).click();
}

for (const theme of ['light', 'dark']) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 700 },
    { width: 390, height: 844 },
    { width: 390, height: 390 },
  ]) {
    test(`${theme} workspace at ${viewport.width}×${viewport.height} preserves message height and composer`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.goto('/tests/fixtures/chat-vue-harness.html');
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await expect(settings(page)).toHaveAttribute('aria-expanded', String(viewport.width >= 960));
      await closeSettings(page);
      for (let i = 0; i < 3; i++) {
        await composer(page).fill(
          `Message ${i}\n\n\`\`\`js\n${'const longLine = "a"; '.repeat(35)}\n\`\`\`\n${'More readable prose. '.repeat(20)}`,
        );
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.locator('[data-role="assistant"]')).toHaveCount(i + 1);
      }
      await composer(page).fill('Keep my draft');
      const before = await page.locator('.wwl-ai-messages').boundingBox();
      await openSettings(page);
      await expect(page.getByText('Model details', { exact: true }).locator('..')).toHaveAttribute(
        'open',
        '',
      );
      await expect(page.getByText('Voice settings', { exact: true }).locator('..')).toHaveAttribute(
        'open',
        '',
      );
      await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
      await page.getByLabel('Read-aloud voice').selectOption('neural');
      const after = await page.locator('.wwl-ai-messages').boundingBox();
      expect(Math.abs(before.height - after.height)).toBeLessThan(2);
      if (viewport.width >= 960) expect(before.width - after.width).toBeGreaterThan(315);
      else await expect(panel(page)).toHaveAttribute('aria-modal', 'true');
      await closeSettings(page);
      await composer(page).scrollIntoViewIfNeeded();
      await expect(composer(page)).toBeInViewport();
      await expect(composer(page)).toHaveValue('Keep my draft');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (viewport.height >= 700) expect(before.height).toBeGreaterThan(300);
      if (viewport.width === 1440 || (viewport.width === 390 && viewport.height === 844)) {
        if (viewport.width === 1440) await openSettings(page);
        await page.screenshot({
          path: `qa/chat-workspace/${info.project.name}-${theme}-${viewport.width}.png`,
        });
      }
    });
  }
}

test('live playback status stays below the composer while a long transcript scrolls', async ({
  page,
}, info) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
  await closeSettings(page);
  const status = page.locator('.wwl-ai-live-status');
  const idle = await status.boundingBox();
  for (let i = 0; i < 3; i++) {
    await composer(page).fill(`Turn ${i}: ${'Long conversation text. '.repeat(55)}`);
    await composer(page).press('Enter');
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(i + 1);
  }
  await openSettings(page);
  await page.getByRole('button', { name: 'Load Neural voice', exact: true }).click();
  await closeSettings(page);
  await page.evaluate(() => {
    window.speechQA.holdNeural = true;
  });
  await page.getByRole('button', { name: 'Read aloud', exact: true }).last().click();
  await expect(status).toContainText('Preparing neural audio on this device…');
  await composer(page).scrollIntoViewIfNeeded();
  await expect(status).toBeInViewport();
  const before = await status.boundingBox();
  const form = await page.locator('.wwl-ai-form').boundingBox();
  expect(before.y).toBeGreaterThanOrEqual(form.y + form.height - 1);
  expect(Math.abs(before.height - idle.height)).toBeLessThan(2);
  await page.locator('.wwl-ai-messages').evaluate((el) => {
    el.scrollTop = 0;
  });
  const after = await status.boundingBox();
  expect(Math.abs(before.y - after.y)).toBeLessThan(1);
  await expect(status).toBeInViewport();
  await page.screenshot({ path: `qa/chat-workspace/status-footer-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Cancel speech', exact: true }).click();
  await expect(status).toBeEmpty();
});

test('narrow drawer traps focus, restores it, handles backdrop and nested storage modal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/fixtures/chat-vue-harness.html');
  await settings(page).click();
  const close = page.getByRole('button', { name: 'Close settings' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Clear storage', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.getByRole('button', { name: 'Clear storage', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Clear model storage?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(settings(page)).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await settings(page).click();
  await page.getByTestId('chat-settings-backdrop').click({ position: { x: 5, y: 200 } });
  await expect(settings(page)).toBeFocused();
});

test('panel toggles and breakpoint changes preserve downloads, recording, playback and preferences', async ({
  page,
}) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
  await composer(page).fill('saved draft');
  await page.evaluate(() => {
    window.speechQA.holdLoad = true;
  });
  await page.getByRole('button', { name: /Enable dictation/ }).click();
  const initial = await page.evaluate(() => window.speechQA.cancels);
  await closeSettings(page);
  await expect(page.getByText('Loading speech model…', { exact: true })).toBeVisible();
  await resize(page, { width: 820, height: 700 });
  await openSettings(page);
  await closeSettings(page);
  expect(await page.evaluate(() => window.speechQA.cancels)).toBe(initial);
  await page.evaluate(() => {
    window.speechQA.holdLoad = false;
    window.speechQA.finish();
  });
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await openSettings(page);
  await resize(page, { width: 1440, height: 900 });
  await closeSettings(page);
  await expect(page.getByRole('button', { name: /Stop recording/ })).toBeVisible();
  expect(await page.evaluate(() => window.speechQA.cancels)).toBe(initial);
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(composer(page)).toHaveValue('saved draft dictated text');
  await openSettings(page);
  await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
  await page.getByLabel('Read-aloud voice').selectOption('neural');
  await page.getByRole('button', { name: 'Load Neural voice', exact: true }).click();
  await page.evaluate(() => {
    window.speechQA.holdNeural = true;
  });
  await page.getByRole('button', { name: 'Test Neural voice', exact: true }).click();
  const playbackCancels = await page.evaluate(() => window.speechQA.cancels);
  await closeSettings(page);
  await resize(page, { width: 390, height: 844 });
  await expect(
    page.getByText('Preparing neural audio on this device…', { exact: true }),
  ).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel('Read-aloud voice')).toHaveValue('neural');
  expect(await page.evaluate(() => window.speechQA.cancels)).toBe(playbackCancels);
  await page.evaluate(() => window.speechQA.finish());
  await expect(page.getByRole('button', { name: 'Test Neural voice', exact: true })).toBeEnabled();
});

test('conversation status and paused review remain in chat when Settings is closed', async ({
  page,
}) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
  await composer(page).fill('saved draft');
  await page.getByRole('button', { name: 'Voice Conversation Mode', exact: true }).click();
  await expect(
    page.getByText('Listening… Pause for about 1.2 seconds to send.', { exact: true }),
  ).toBeVisible();
  const captures = await page.evaluate(() => window.conversationQA.captures);
  await closeSettings(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);
  await closeSettings(page);
  expect(await page.evaluate(() => window.conversationQA.captures)).toBe(captures);
  await page.evaluate(() => {
    window.speechQA.transcript = 'Review this voice text';
    window.conversationQA.utterance(true);
  });
  await expect(page.getByLabel('Review voice message')).toHaveValue('Review this voice text');
  await expect(composer(page)).toHaveValue('saved draft');
  await expect(
    page.getByRole('button', { name: 'Resume conversation', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(composer(page)).toBeEditable();
});

test('both real demo hosts keep a lazy workspace with documentation below', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const url of ['/#demos/aichat', '/demo/ai-chat-demo.html']) {
    await page.goto(url);
    if (await page.getByTestId('disclaimer-gate').isVisible())
      await page.getByTestId('disclaimer-accept').click();
    await expect(page.locator('.wwl-ai-chat-wrap')).toBeVisible();
    const flowchartToggle = page.getByRole('button', { name: 'Flowchart', exact: true });
    if ((await flowchartToggle.count()) > 0 && (await flowchartToggle.getAttribute('aria-pressed')) === 'true') {
      await flowchartToggle.click();
    }
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Settings', exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        'Load a model in the Settings panel, or choose Voice Conversation Mode above.',
      ),
    ).toBeVisible();
    await settle(page);
    const before = await page.locator('.wwl-ai-messages').boundingBox();
    await page.getByRole('button', { name: 'Close settings' }).click();
    const after = await page.locator('.wwl-ai-messages').boundingBox();
    expect(Math.abs(before.height - after.height)).toBeLessThan(2);
    expect(after.width - before.width).toBeGreaterThan(315);
    await expect(page.getByRole('button', { name: 'Open Settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Settings', exact: true })).toHaveCount(0);
    if (test.info().project.name === 'Chromium Desktop')
      await page.screenshot({ path: 'qa/theme-refresh/chat-settings-open.png' });
    await expect(composer(page)).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Voice Conversation Mode', exact: true }),
    ).toBeVisible();
  }
});
