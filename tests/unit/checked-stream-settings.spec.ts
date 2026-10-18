import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
});

test('checked previews are plain text, unavailable to speech, and become Markdown only after acceptance', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('preview');
  await input.press('Enter');
  const preview = page.locator('.wwl-checked-preview');
  await expect(preview).toContainText('**Checked** <img');
  await expect(preview.locator('img,a,strong')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Read aloud', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(await page.evaluate(() => window.chatQA.calls[0].delivery)).toBe('checked-stream');
  await page.evaluate(() => window.chatQA.finish());
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-role="assistant"] strong')).toHaveText('Checked');
  await expect(page.locator('[data-role="assistant"] a')).toHaveAttribute(
    'href',
    'https://example.com',
  );
});

test('delivery and 28 named voices persist without starting downloads or capture', async ({
  page,
}) => {
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  if ((await settings.getAttribute('aria-expanded')) === 'false') await settings.click();
  await page
    .getByRole('combobox', { name: 'Reply delivery', exact: true })
    .selectOption('complete');
  await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
  const voices = page.getByLabel('English Kokoro voice');
  await expect(voices.locator('option')).toHaveCount(28);
  await voices.selectOption('bf_emma');
  const copies = page.getByLabel('Parallel voice models');
  await expect(copies).toHaveValue('2');
  await expect(
    page.getByText(
      'Each extra copy loads another voice model (about 94 MB). Choose 1 to keep a single model.',
    ),
  ).toBeVisible();
  await copies.selectOption('6');
  expect(await page.evaluate(() => window.speechQA.loads)).toEqual([]);
  expect(await page.evaluate(() => window.conversationQA.captures)).toBe(0);
  await page.reload();
  if (
    (await page
      .getByRole('button', { name: 'Settings', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
  await expect(voices).toHaveValue('bf_emma');
  await expect(page.getByLabel('Parallel voice models')).toHaveValue('6');
  await expect(page.getByRole('combobox', { name: 'Reply delivery', exact: true })).toHaveValue(
    'complete',
  );
  expect(await page.evaluate(() => window.speechQA.loads)).toEqual([]);
});

test('paused model and voice edits preserve draft/history and reasoning uses the selected allowance', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({
          features: new Set(['shader-f16']),
          limits: { maxStorageBufferBindingSize: 2147483648 },
          info: {},
        }),
      },
    }),
  );
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('typed draft');
  await page.getByRole('button', { name: 'Voice Conversation Mode', exact: true }).click();
  await expect(page.getByText(/Listening… Pause/)).toBeVisible();
  await page.evaluate(() => window.conversationQA.utterance());
  await expect(page.locator('[data-role="assistant"]').last()).toContainText(
    'Answer: dictated text',
  );
  await expect(page.getByText(/Listening… Pause/)).toBeVisible();
  await page.getByRole('button', { name: 'Pause conversation', exact: true }).click();
  if (
    (await page
      .getByRole('button', { name: 'Settings', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const model = page.locator('#wwl-ai-model-select');
  await expect(model).toBeEnabled();
  await model.selectOption('LFM2.5-2.6B-q4f16-ONNX');
  await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
  await page.getByLabel('English Kokoro voice').selectOption('bf_emma');
  const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (await settingsDialog.isVisible())
    await settingsDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Resume conversation', exact: true }).click();
  await expect(page.getByText(/Listening… Pause/)).toBeVisible();
  await page.evaluate(() => window.conversationQA.utterance());
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(2);
  await expect(input).toHaveValue('typed draft');
  expect(
    await page.evaluate(() => window.chatQA.calls.map((c) => [c.maxOutputTokens, c.delivery])),
  ).toEqual([
    [192, 'complete'],
    [1024, 'complete'],
  ]);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('pinned catalog rejects corrupt styles and runtime changes only the selected style', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { KOKORO_VOICES, getKokoroVoice, verifyVoiceBytes } =
      await import('/src/lib/speech/voices.js');
    const { createSpeechRuntime } = await import('/src/lib/speech/runtime.js');
    const calls = [];
    let workers = 0;
    const runtime = createSpeechRuntime({
      createWorker: () => {
        workers++;
        const worker = {
          terminate() {},
          postMessage(data) {
            calls.push([data.method, data.args.voiceId]);
            queueMicrotask(() =>
              worker.onmessage({ data: { id: data.id, type: 'result', value: {} } }),
            );
          },
        };
        return worker;
      },
    });
    await runtime.load('kokoro', { voiceId: 'af_heart' });
    await runtime.load('kokoro', { voiceId: 'bf_emma' });
    await runtime.load('kokoro', { voiceId: 'bf_emma' });
    await runtime.synthesize('Hello', { voiceId: 'bf_emma' });
    const current = runtime.isVoiceLoaded('bf_emma');
    runtime.dispose();
    const errors = [];
    try {
      getKokoroVoice('af');
    } catch (e) {
      errors.push(e.message);
    }
    for (const bytes of [new ArrayBuffer(1), new ArrayBuffer(522240)]) {
      try {
        await verifyVoiceBytes(bytes, getKokoroVoice());
      } catch (e) {
        errors.push(e.message);
      }
    }
    return {
      count: KOKORO_VOICES.length,
      accents: [...new Set(KOKORO_VOICES.map((v) => v.accent))],
      valid: KOKORO_VOICES.every((v) => v.bytes === 522240 && /^[a-f0-9]{64}$/.test(v.sha256)),
      workers,
      calls,
      current,
      errors,
    };
  });
  expect(result.count).toBe(28);
  expect(result.valid).toBe(true);
  expect(result.workers).toBe(2);
  expect(result.current).toBe(true);
  expect(result.calls).toEqual([
    ['load', 'af_heart'],
    ['load', 'af_heart'],
    ['loadVoice', 'bf_emma'],
    ['loadVoice', 'bf_emma'],
    ['synthesize', 'bf_emma'],
  ]);
  expect(result.errors.join(' ')).toContain('checksum failed');
  expect(result.errors.join(' ')).toContain('incomplete');
});

test('system conversations omit Kokoro and settings remain snapshotted until a settled resume', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { ConversationSession } = await import('/src/lib/speech/conversation.js');
    const loads = [],
      turns = [],
      spoken = [];
    let utterance, finish;
    let settings = {
      provider: 'system',
      voiceURI: 'local',
      voiceId: 'af_heart',
      maxOutputTokens: 192,
      modelId: 'tiny',
    };
    const loop = new ConversationSession({
      getSettings: () => settings,
      speech: {
        cancel() {},
        update() {},
        playerFactory: () => ({ context: {}, cancel() {} }),
        runtime: {
          load: async (k) => loads.push(k),
          resetVad: async () => {},
          transcribe: async () => 'Hello',
        },
        speak: async (t, o) => spoken.push([o.provider, o.voiceURI, o.voiceId]),
      },
      ensureChat: async () => {},
      submitTurn: async (t, o) => {
        turns.push([o.delivery, o.maxOutputTokens]);
        return new Promise((r) => (finish = r));
      },
      requestMicrophone: async () => ({ getTracks: () => [{ stop() {} }] }),
      captureFactory: async (o) => {
        utterance = o.onUtterance;
        return { cancel() {} };
      },
      delay: async () => {},
    });
    await loop.start();
    settings = { provider: 'neural', voiceId: 'bf_emma', maxOutputTokens: 1024 };
    utterance({ audio: new Float32Array(512) });
    while (!finish) await new Promise((r) => setTimeout(r, 0));
    loop.pause();
    const settling = loop.state.settling;
    finish('stale');
    await loop.pauseTask;
    await loop.start();
    utterance({ audio: new Float32Array(512) });
    while (turns.length < 2) await new Promise((r) => setTimeout(r, 0));
    finish('fresh');
    await loop.task;
    const after = loop.state.settling;
    await loop.end();
    return { loads, turns, spoken, settling, after };
  });
  expect(result.loads).toEqual(['whisper', 'vad', 'whisper', 'kokoro', 'vad']);
  expect(result.turns).toEqual([
    ['complete', 192],
    ['complete', 1024],
  ]);
  expect(result.spoken).toEqual([['neural', undefined, 'bf_emma']]);
  expect(result.settling).toBe(true);
  expect(result.after).toBe(false);
});

test('Compare keeps preview timing and text outside committed answers and exports', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { CompareSession } = await import('/src/lib/compare-session.js');
    let inside;
    class Chat {
      loaded = false;
      isLoaded() {
        return this.loaded;
      }
      onProgress() {
        return () => {};
      }
      async load() {
        this.loaded = true;
      }
      getHistory() {
        return [];
      }
      async setHistory() {}
      cancel() {}
      async dispose() {}
      async generate(t, o) {
        o.onPreview('EPHEMERAL_PREVIEW_ONLY');
        inside = session.export();
        await new Promise((r) => setTimeout(r, 5));
        o.onUpdate('final');
        return 'final';
      }
    }
    const session = new CompareSession({
      modelA: 'gemma-4-E2B-it-web',
      createChat: () => new Chat(),
    });
    session.system = { webgpuSupported: true, shaderF16: true };
    session.state.models[1] = 'LFM2.5-2.6B-q4f16-ONNX';
    await session.loadPair();
    await session.send('Hello');
    const panes = session.state.panes.map((p) => ({ preview: p.preview, turn: p.turns[0] }));
    await session.dispose();
    return { inside, panes };
  });
  expect(JSON.stringify(result.inside)).not.toContain('EPHEMERAL_PREVIEW_ONLY');
  for (const pane of result.panes) {
    expect(pane.preview).toBe('');
    expect(pane.turn.response).toBe('final');
    expect(pane.turn.firstPreviewMs).toBeLessThan(pane.turn.firstAnswerMs);
  }
});

for (const action of ['Stop', 'New conversation']) {
  test(`${action} discards ephemeral Chat previews`, async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill('preview');
    await input.press('Enter');
    await expect(page.locator('.wwl-checked-preview')).toBeVisible();
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.locator('.wwl-checked-preview')).toHaveCount(0);
    await expect(page.locator('[data-role="assistant"] strong')).toHaveCount(0);
  });
}

test('manual system playback never substitutes an unselected voice', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'wwl-chat-settings-v1',
      JSON.stringify({ provider: 'system', voiceURI: '' }),
    );
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          { name: 'Local English', lang: 'en-US', localService: true, voiceURI: 'available' },
        ],
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('hello');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect(
    page.getByText('Choose an installed local English voice before reading aloud.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.speechQA.spoken)).toEqual([]);
});
