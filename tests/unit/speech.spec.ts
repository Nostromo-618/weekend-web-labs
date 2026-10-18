import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/chat-vue-harness.html');
});

test('narration omits code, citations, URLs and markup; bounded splitters always preserve content', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { speechText, splitSpeechText, splitSpeechTokens, localEnglishVoices } =
      await import('/src/lib/speech/text.js');
    const text =
      '## Answer\nRead [the guide](https://example.com). [1] [source:a]\n```js\nsecretCode()\n```\nVisit https://example.com/raw and `inlineCode`.\n';
    const problematic = ('Hello @handle\n https://example.com/path\n ' + 'a'.repeat(1000)).repeat(
      30,
    );
    const chunks = splitSpeechText(problematic);
    const tokens = Array.from({ length: 5000 }, (_, i) => BigInt(i));
    const parts = splitSpeechTokens(tokens, 16n);
    return {
      text: speechText(text),
      lengths: chunks.map((c) => c.length),
      normalized: chunks.join('').replace(/\s/g, '') === problematic.replace(/\s/g, ''),
      tokenLengths: parts.map((p) => p.length),
      preserved:
        parts.flat().every((token, i) => token === tokens[i]) &&
        parts.flat().length === tokens.length,
      voices: localEnglishVoices({
        getVoices: () => [
          { name: 'remote', lang: 'en', localService: false },
          { name: 'local', lang: 'en-US', localService: true },
          { name: 'French', lang: 'fr', localService: true },
        ],
      }).map((v) => v.name),
      unclosed: speechText('Hello\n```js\nnot spoken'),
    };
  });
  expect(result.text).toBe('Answer Read the guide. Visit and .');
  expect(result.normalized).toBe(true);
  expect(Math.max(...result.lengths)).toBeLessThanOrEqual(300);
  expect(Math.max(...result.tokenLengths)).toBeLessThanOrEqual(508);
  expect(result.preserved).toBe(true);
  expect(result.voices).toEqual(['local']);
  expect(result.unclosed).toBe('Hello');
});

test('missing local English voices explains optional neural download without loading it', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          { localService: false, lang: 'en-US' },
          { localService: true, lang: 'fr-FR' },
        ],
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  );
  await page.reload();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  if ((await settings.getAttribute('aria-expanded')) === 'false') await settings.click();
  await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
  await page.getByLabel('Read-aloud voice').selectOption('system');
  await expect(page.getByText(/No local English voice is installed/)).toBeVisible();
  const error = await page.evaluate(async () => {
    const { speakSystem } = await import('/src/lib/speech/audio.js');
    return speakSystem('Hello', '', new AbortController().signal).catch(
      (failure) => failure.message,
    );
  });
  expect(error).toContain('Choose and load Neural voice');
  await page.getByLabel('Read-aloud voice').selectOption('neural');
  await expect(page.getByRole('button', { name: 'Load Neural voice', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.speechQA.loads)).toEqual([]);
});

test('neural voice test distinguishes audio preparation from playback', async ({ page }) => {
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  if ((await settings.getAttribute('aria-expanded')) === 'false') await settings.click();
  await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
  await page.getByLabel('Read-aloud voice').selectOption('neural');
  await expect(page.getByLabel('Parallel voice models')).toHaveValue('2');
  await expect(
    page.getByText(
      'Each extra copy loads another voice model (about 94 MB). Choose 1 to keep a single model.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test Neural voice', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load Neural voice', exact: true }).click();
  await page.evaluate(() => {
    window.speechQA.holdNeural = true;
  });
  await page.getByRole('button', { name: 'Test Neural voice', exact: true }).click();
  await expect(
    page.getByText('Preparing neural audio on this device…', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.speechQA.spoken)).toEqual([
    'This is the selected local neural voice.',
  ]);
  await page.evaluate(() => window.speechQA.finish());
  await expect(page.getByRole('button', { name: 'Test Neural voice', exact: true })).toBeEnabled();
  await expect(page.getByText(/If playback finishes silently/)).toBeVisible();
});

test('PCM player resumes after inference, rejects silent audio, and releases blocked/interrupted playback', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createPCMPlayer } = await import('/src/lib/speech/audio.js');
    const original = window.AudioContext;
    const contexts = [];
    class FakeContext extends EventTarget {
      state = 'suspended';
      sampleRate = 48000;
      destination = {};
      resumes = 0;
      closes = 0;
      blocked = false;
      interrupt = false;
      sources = [];
      constructor() {
        super();
        contexts.push(this);
      }
      resume() {
        this.resumes++;
        if (this.blocked) return new Promise(() => {});
        this.state = 'running';
        return Promise.resolve();
      }
      close() {
        this.closes++;
        this.state = 'closed';
        return Promise.resolve();
      }
      createBuffer(_channels, length) {
        return { length, copyToChannel() {} };
      }
      createBufferSource() {
        const context = this;
        const node = {
          connect() {},
          disconnect() {},
          stop() {},
          start() {
            context.sources.push(node.buffer.length);
            if (node.buffer.length === 1) return;
            if (context.interrupt) {
              context.state = 'interrupted';
              context.dispatchEvent(new Event('statechange'));
            } else queueMicrotask(() => node.onended?.());
          },
        };
        return node;
      }
    }
    window.AudioContext = FakeContext;
    const pcm = new Float32Array([0.1, -0.1]);
    try {
      const controller = new AbortController();
      const player = createPCMPlayer(controller.signal);
      contexts[0].state = 'suspended'; // Browser suspension during model inference.
      let started = false;
      await player.play(pcm, 24000, {
        onStart: () => {
          started = true;
        },
      });
      const silent = await player.play(new Float32Array(10), 24000).catch((error) => error.message);
      const invalid = await player
        .play(new Float32Array([NaN]), 24000)
        .catch((error) => error.message);
      contexts[0].interrupt = true;
      const interrupted = await player.play(pcm, 24000).catch((error) => error.message);
      player.cancel();
      const blockedController = new AbortController();
      const blocked = createPCMPlayer(blockedController.signal);
      contexts[1].state = 'suspended';
      contexts[1].blocked = true;
      const pending = blocked.play(pcm, 24000).catch((error) => error.name);
      blockedController.abort();
      const canceled = await pending;
      const timed = createPCMPlayer(new AbortController().signal);
      contexts[2].state = 'suspended';
      contexts[2].blocked = true;
      const timeout = await timed.play(pcm, 24000).catch((error) => error.message);
      timed.cancel();
      return {
        started,
        silent,
        invalid,
        interrupted,
        canceled,
        timeout,
        resumes: contexts[0].resumes,
        sources: contexts[0].sources,
        closes: contexts.map((context) => context.closes),
      };
    } finally {
      window.AudioContext = original;
    }
  });
  expect(result.started).toBe(true);
  expect(result.resumes).toBe(2);
  expect(result.sources).toEqual([1, 2, 2]);
  expect(result.silent).toContain('silent audio');
  expect(result.invalid).toContain('invalid audio');
  expect(result.interrupted).toContain('interrupted');
  expect(result.canceled).toBe('AbortError');
  expect(result.timeout).toContain('site Sound setting');
  expect(result.closes).toEqual([1, 1, 1]);
});

test('denied and full storage are best effort; clearing targets only speech caches', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { openSpeechCache, clearSpeechCaches } = await import('/src/lib/speech/assets.js');
    const denied = await openSpeechCache('test', {
      open() {
        throw new Error('denied');
      },
    });
    const full = await openSpeechCache('test', {
      async open() {
        return {
          match() {
            throw new Error('denied');
          },
          put() {
            throw new Error('full');
          },
        };
      },
    });
    await full.put('file', new Response('x'));
    const deleted = [];
    await clearSpeechCaches({
      async delete(name) {
        deleted.push(name);
        return true;
      },
    });
    return {
      available: denied.available,
      match: (await full.match('file')) === undefined,
      deleted,
    };
  });
  expect(result).toEqual({
    available: false,
    match: true,
    deleted: ['wwl-speech-whisper-v1', 'wwl-speech-kokoro-v1', 'wwl-speech-vad-v1'],
  });
});

test('worker cancellation rejects pending calls, ignores late messages and recreates lazily', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createSpeechRuntime } = await import('/src/lib/speech/runtime.js');
    const workers = [];
    const runtime = createSpeechRuntime({
      createWorker: () => {
        const worker = {
          messages: [],
          terminated: false,
          postMessage(data) {
            this.messages.push(data);
          },
          terminate() {
            this.terminated = true;
          },
        };
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const pending = runtime
      .load('whisper', { signal: controller.signal })
      .catch((error) => error.name);
    controller.abort();
    const canceled = await pending;
    const again = runtime.load('whisper');
    const id = workers[1].messages[0].id;
    workers[0].onmessage({ data: { id: 1, type: 'result', value: true } });
    workers[0].onerror({ message: 'Late error from terminated worker' });
    workers[1].onmessage({ data: { id, type: 'result', value: {} } });
    await again;
    const loaded = runtime.isLoaded('whisper');
    runtime.dispose();
    return {
      canceled,
      loaded,
      terminated: workers.every((worker) => worker.terminated),
      count: workers.length,
    };
  });
  expect(result).toEqual({ canceled: 'AbortError', loaded: true, terminated: true, count: 2 });
});

test('recording interrupts playback and stale recording failure cannot release a new microphone', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { SpeechSession } = await import('/src/lib/speech/session.js');
    let failStop,
      canceled = 0,
      calls = 0,
      playbackStopped = false;
    const session = new SpeechSession({
      runtime: { isLoaded: () => true, cancel() {}, dispose() {} },
      systemSpeaker: (_text, _voice, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => {
            playbackStopped = true;
            reject(new DOMException('', 'AbortError'));
          }),
        ),
      recorderFactory: async () =>
        ++calls === 1
          ? {
              stop: () =>
                new Promise((_resolve, reject) => {
                  failStop = reject;
                }),
              cancel() {},
            }
          : {
              cancel() {
                canceled++;
              },
            },
    });
    const playback = session.speak('Hello');
    await session.record();
    await playback;
    const old = session.finishRecording();
    session.cancel();
    await session.record();
    failStop(new Error('Old recording failed'));
    await old;
    const status = session.state.status;
    session.dispose();
    return { playbackStopped, status, canceled };
  });
  expect(result).toEqual({ playbackStopped: true, status: 'recording', canceled: 1 });
});

test('General read-aloud uses the final answer and reset/navigation release speech', async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'wwl-chat-settings-v1',
      JSON.stringify({ provider: 'system', voiceURI: 'qa-local' }),
    ),
  );
  await page.addInitScript(() =>
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          { name: 'QA English', lang: 'en-US', localService: true, voiceURI: 'qa-local' },
        ],
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  );
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('VdDock placement');
  await input.press('Enter');
  await expect(page.locator('.wwl-ai-messages')).toContainText('Answer: VdDock placement');
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
  expect(await page.evaluate(() => window.speechQA.spoken)).toEqual(['Answer: VdDock placement']);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toHaveCount(0);
  await input.fill('hold');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Read aloud', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.chatQA.unmount());
  expect(await page.evaluate(() => window.speechQA.cancels)).toBeGreaterThan(0);
});

test('speech download cancellation ignores late progress and completion after navigation', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { SpeechSession } = await import('/src/lib/speech/session.js');
    let complete, progress;
    const session = new SpeechSession({
      runtime: {
        isLoaded: () => false,
        load: (_kind, options) =>
          new Promise((resolve) => {
            complete = resolve;
            progress = options.onProgress;
          }),
        cancel() {},
        dispose() {},
      },
    });
    const load = session.load('kokoro');
    session.dispose();
    progress({ text: 'Stale progress', percent: 99 });
    complete({ cacheAvailable: true });
    await load;
    return {
      status: session.state.status,
      progress: session.state.progress,
      ready: session.state.kokoroReady,
    };
  });
  expect(result).toEqual({ status: 'idle', progress: '', ready: false });
});

test('recording worklet mixes stereo into mono and caps PCM at exactly sixty seconds', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    let Processor,
      frames = 0,
      limits = 0,
      mixed = true;
    window.sampleRate = 48000;
    window.AudioWorkletProcessor = class {
      port = {
        postMessage(data) {
          if (data.type === 'pcm') {
            frames += data.pcm.length;
            mixed &&= data.pcm.every((sample) => sample === 0.5);
          }
          if (data.type === 'limit') limits++;
        },
      };
    };
    window.registerProcessor = (_name, constructor) => {
      Processor = constructor;
    };
    await import('/src/workers/speech-recorder-worklet.js');
    const processor = new Processor();
    const inputs = [[new Float32Array(128).fill(0.25), new Float32Array(128).fill(0.75)]];
    for (let i = 0; i < (48000 * 65) / 128; i++) processor.process(inputs);
    return { frames, limits, mixed, stopped: processor.stopped };
  });
  expect(result).toEqual({ frames: 48000 * 60, limits: 1, mixed: true, stopped: true });
});

test('recording limit stops once and stale microphone permission completion is released', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { SpeechSession } = await import('/src/lib/speech/session.js');
    let limit,
      grant,
      stopped = 0,
      released = 0;
    const transcripts = [];
    const runtime = {
      isLoaded: () => true,
      async transcribe() {
        return 'limit transcript';
      },
      cancel() {},
      dispose() {},
    };
    const session = new SpeechSession({
      runtime,
      onTranscript: (text) => transcripts.push(text),
      recorderFactory: async ({ onLimit }) => {
        limit = onLimit;
        return {
          async stop() {
            stopped++;
            return new Float32Array(100);
          },
          cancel() {},
        };
      },
    });
    await session.record();
    limit();
    limit();
    await new Promise((resolve) => setTimeout(resolve, 5));
    session.dispose();
    const late = new SpeechSession({
      runtime,
      recorderFactory: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    });
    const pending = late.record();
    late.dispose();
    grant({
      cancel() {
        released++;
      },
    });
    await pending;
    return { stopped, released, transcripts, status: late.state.status };
  });
  expect(result).toEqual({
    stopped: 1,
    released: 1,
    transcripts: ['limit transcript'],
    status: 'idle',
  });
});

test('dictation appends editable text, preserves overflow, and never sends automatically', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('existing draft');
  await page.getByRole('button', { name: 'Enable dictation (44 MB)' }).click();
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(input).toHaveValue('existing draft dictated text');
  expect(await page.evaluate(() => window.chatQA.calls.length)).toBe(0);
  await page.evaluate(() => (window.speechQA.transcript = 'x'.repeat(2100)));
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(input).toHaveValue('existing draft dictated text ' + 'x'.repeat(2100));
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('Enter');
  expect(await page.evaluate(() => window.chatQA.calls.length)).toBe(0);
  await input.fill('edited');
  await input.press('Enter');
  await expect(page.locator('[data-role="assistant"]')).toContainText('Answer: edited');
});

test('permission denial and silence preserve drafts; reset invalidates late transcription', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('keep this');
  await page.getByRole('button', { name: 'Enable dictation (44 MB)' }).click();
  await page.evaluate(() => (window.speechQA.denied = true));
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('permission denied');
  await expect(input).toHaveValue('keep this');
  await page.evaluate(() => {
    window.speechQA.denied = false;
    window.speechQA.transcript = '';
  });
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(page.getByRole('alert')).toContainText('No speech detected');
  await page.evaluate(() => {
    window.speechQA.hold = true;
    window.speechQA.transcript = 'late';
  });
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.evaluate(() => window.speechQA.finish());
  await expect(input).toHaveValue('keep this');
});

test('completed replies support manual playback, stop, sending interruption and explicit neural loading', async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'wwl-chat-settings-v1',
      JSON.stringify({ provider: 'system', voiceURI: 'qa-local' }),
    ),
  );
  await page.addInitScript(() =>
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          { name: 'QA English', lang: 'en-US', localService: true, voiceURI: 'qa-local' },
        ],
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  );
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('hello');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toBeVisible();
  await input.fill('next');
  await input.press('Enter');
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('Answer: next');
  await expect(page.getByRole('button', { name: 'Stop reading', exact: true })).toHaveCount(0);
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  if ((await settings.getAttribute('aria-expanded')) === 'false') await settings.click();
  await expect(page.getByLabel('Read-aloud voice')).toBeVisible();
  await page.getByLabel('Read-aloud voice').selectOption('neural');
  expect(await page.evaluate(() => window.speechQA.loads)).toEqual([]);
  await page.getByRole('button', { name: 'Load Neural voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neural voice ready' })).toBeDisabled();
  const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (await settingsDialog.isVisible())
    await settingsDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Read aloud', exact: true }).last().click();
  await expect
    .poll(() => page.evaluate(() => window.speechQA.spoken))
    .toEqual(['Answer: hello', 'Answer: next']);
});

test('speech scheduler matches the live session count, plays in order, and drops audio on cancel', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const {
      scheduleSpeechSentences,
      clampSpeechConcurrency,
      DEFAULT_SPEECH_CONCURRENCY,
      MAX_SPEECH_CONCURRENCY,
    } = await import('/src/lib/speech/scheduler.js');
    const flush = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const sentences = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
    let inFlight = 0;
    let maxInFlight = 0;
    const started = [];
    const played = [];
    const boxes = [];
    const controller = new AbortController();
    const run = scheduleSpeechSentences({
      sentences,
      concurrency: 2,
      signal: controller.signal,
      synthesize: (sentence) => {
        started.push(sentence);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve, reject) => {
          boxes.push({
            settled: false,
            finish(error, value) {
              if (this.settled) return;
              this.settled = true;
              inFlight -= 1;
              if (error) reject(error);
              else resolve(value);
            },
          });
        });
      },
      onSentence: async (_index, sentence, outcome) => {
        played.push(outcome.ok ? sentence : `error:${sentence}`);
      },
    });
    await flush();
    const initial = started.slice();
    boxes[1].finish(null, { audio: 's1' });
    await flush();
    const afterEarly = { played: played.slice(), started: started.length, inFlight };
    boxes[0].finish(null, { audio: 's0' });
    await flush();
    const afterFirst = played.slice();
    boxes[3].finish(null, { audio: 's3' });
    boxes[2].finish(null, { audio: 's2' });
    for (let i = 0; i < 20 && played.length < 4; i++) await flush();
    const ordered = played.slice();
    controller.abort();
    for (const box of boxes) box.finish(null, { audio: 'late' });
    await flush();
    await run;
    const playedAfterCancel = played.slice();

    const failPlayed = [];
    const failErrors = [];
    const failBoxes = [];
    const failRun = scheduleSpeechSentences({
      sentences: ['a', 'b', 'c', 'd'],
      concurrency: 2,
      synthesize: (sentence) =>
        new Promise((resolve, reject) => {
          failBoxes.push({ sentence, resolve, reject });
        }),
      onSentence: async (_index, sentence, outcome) => {
        if (!outcome.ok) failErrors.push([sentence, outcome.error.message]);
        else failPlayed.push(sentence);
      },
    });
    await flush();
    const failStarted = failBoxes.map((box) => box.sentence);
    failBoxes[0].resolve({ audio: 'a' });
    failBoxes[1].reject(new Error('b failed'));
    for (let i = 0; i < 20 && failBoxes.length < 4; i++) await flush();
    failBoxes[2].resolve({ audio: 'c' });
    failBoxes[3].resolve({ audio: 'd' });
    for (let i = 0; i < 20 && failPlayed.length + failErrors.length < 4; i++) await flush();
    await failRun;

    const capStarted = [];
    const capController = new AbortController();
    const capRun = scheduleSpeechSentences({
      sentences: Array.from({ length: 10 }, (_, index) => `c${index}`),
      concurrency: 100,
      signal: capController.signal,
      synthesize: (sentence) => {
        capStarted.push(sentence);
        return new Promise(() => {});
      },
      onSentence: async () => {},
    });
    await flush();
    const capped = capStarted.slice();
    capController.abort();
    await capRun;

    return {
      initial,
      maxInFlight,
      afterEarly,
      afterFirst,
      ordered,
      playedAfterCancel,
      failStarted,
      failPlayed,
      failErrors,
      capped,
      defaults: [DEFAULT_SPEECH_CONCURRENCY, MAX_SPEECH_CONCURRENCY],
      clamped: [
        clampSpeechConcurrency(),
        clampSpeechConcurrency(0),
        clampSpeechConcurrency(99),
        clampSpeechConcurrency('6'),
      ],
    };
  });
  expect(result.defaults).toEqual([2, 8]);
  expect(result.clamped).toEqual([2, 1, 8, 6]);
  expect(result.initial).toEqual(['s0', 's1']);
  expect(result.maxInFlight).toBe(2);
  expect(result.afterEarly).toEqual({ played: [], started: 3, inFlight: 2 });
  expect(result.afterFirst).toEqual(['s0', 's1']);
  expect(result.ordered).toEqual(['s0', 's1', 's2', 's3']);
  expect(result.playedAfterCancel).toEqual(['s0', 's1', 's2', 's3']);
  expect(result.failStarted).toEqual(['a', 'b']);
  expect(result.failPlayed).toEqual(['a', 'c', 'd']);
  expect(result.failErrors).toEqual([['b', 'b failed']]);
  expect(result.capped).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
});

test('neural read-aloud queues sentences ahead of playback and continues after one failure', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { SpeechSession } = await import('/src/lib/speech/session.js');
    const flush = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const calls = [];
    const boxes = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let played = 0;
    let releasePlay = () => {};
    const runtime = {
      isLoaded: () => true,
      synthesize(text) {
        calls.push(text);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve, reject) => {
          boxes.push({
            done: false,
            settle(error, value) {
              if (this.done) return;
              this.done = true;
              inFlight -= 1;
              if (error) reject(error);
              else resolve(value);
            },
          });
        });
      },
      cancel() {},
      dispose() {},
    };
    const audio = { chunks: [new Float32Array([0.2])], sampleRate: 24000 };
    const session = new SpeechSession({
      runtime,
      playerFactory: () => ({
        play() {
          played += 1;
          return new Promise((resolve) => {
            releasePlay = resolve;
          });
        },
        cancel() {
          releasePlay();
        },
      }),
    });
    const pending = session.speak('One. Two. Three. Four. Five. Six. Seven. Eight. ', {
      provider: 'neural',
      voiceId: 'af_heart',
      throwOnError: true,
    });
    await flush();
    const beforePlay = { calls: calls.slice(), played, maxInFlight };
    boxes[1].settle(null, audio);
    await flush();
    const afterEarly = { calls: calls.length, played };
    boxes[0].settle(null, audio);
    await flush();
    const duringFirst = { calls: calls.length, played };
    session.cancel();
    await pending;
    for (const box of boxes) box.settle(null, audio);
    await flush();
    const afterCancel = { played, status: session.state.status };

    const retryCalls = [];
    const retryBoxes = [];
    let retryPlayed = 0;
    const retry = new SpeechSession({
      runtime: {
        isLoaded: () => true,
        synthesize(text) {
          retryCalls.push(text);
          return new Promise((resolve, reject) => {
            retryBoxes.push({ resolve, reject });
          });
        },
        cancel() {},
        dispose() {},
      },
      playerFactory: () => ({
        async play() {
          retryPlayed += 1;
        },
        cancel() {},
      }),
    });
    const retrying = retry.speak('One. Two. ', {
      provider: 'neural',
      voiceId: 'af_heart',
      throwOnError: true,
    });
    await flush();
    retryBoxes[0].reject(new Error('Kokoro missed a sentence.'));
    retryBoxes[1].resolve(audio);
    await retrying;

    const wideCalls = [];
    let wideCount = 4;
    const wide = new SpeechSession({
      runtime: {
        get kokoroSessionCount() {
          return wideCount;
        },
        isLoaded: () => true,
        synthesize(text, options) {
          wideCalls.push(text);
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Speech stopped.', 'AbortError')),
              { once: true },
            );
          });
        },
        cancel() {},
        dispose() {},
      },
      playerFactory: () => ({
        play() {
          return new Promise(() => {});
        },
        cancel() {},
      }),
    });
    const wideSpeak = wide.speak('One. Two. Three. Four. Five. ', {
      provider: 'neural',
      voiceId: 'af_heart',
      throwOnError: true,
    });
    await flush();
    const startedWide = wideCalls.slice();
    wideCount = 1;
    await flush();
    const duringShrink = wideCalls.slice();
    wide.cancel();
    await wideSpeak.catch(() => {});

    const nextCalls = [];
    const next = new SpeechSession({
      runtime: {
        kokoroSessionCount: 1,
        isLoaded: () => true,
        synthesize(text, options) {
          nextCalls.push(text);
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Speech stopped.', 'AbortError')),
              { once: true },
            );
          });
        },
        cancel() {},
        dispose() {},
      },
      playerFactory: () => ({
        play() {
          return new Promise(() => {});
        },
        cancel() {},
      }),
    });
    const nextSpeak = next.speak('Alpha. Beta. ', {
      provider: 'neural',
      voiceId: 'af_heart',
      throwOnError: true,
    });
    await flush();
    next.cancel();
    await nextSpeak.catch(() => {});

    return {
      beforePlay,
      afterEarly,
      duringFirst,
      afterCancel,
      played,
      retryCalls,
      retryPlayed,
      retryError: retry.state.error,
      retryStatus: retry.state.status,
      startedWide,
      duringShrink,
      nextCalls,
    };
  });
  expect(result.beforePlay).toEqual({
    calls: ['One.', 'Two.'],
    played: 0,
    maxInFlight: 2,
  });
  expect(result.afterEarly).toEqual({ calls: 3, played: 0 });
  expect(result.duringFirst).toEqual({ calls: 4, played: 1 });
  expect(result.afterCancel).toEqual({ played: 1, status: 'idle' });
  expect(result.played).toBe(1);
  expect(result.retryCalls).toEqual(['One.', 'Two.']);
  expect(result.retryPlayed).toBe(1);
  expect(result.retryError).toBe('Kokoro missed a sentence.');
  expect(result.retryStatus).toBe('idle');
  expect(result.startedWide).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
  expect(result.duringShrink).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
  expect(result.nextCalls).toEqual(['Alpha.']);
});

test('Kokoro loads one ONNX session per parallel copy and keeps going after a sentence error', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createSpeechRuntime } = await import('/src/lib/speech/runtime.js');
    const flush = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const settle = (task) =>
      task.then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, message: error.message, name: error.name }),
      );
    function fakeRuntime(bucket) {
      return createSpeechRuntime({
        createWorker: () => {
          const worker = {
            messages: [],
            terminated: false,
            postMessage(data) {
              this.messages.push(data);
              if (data.method !== 'synthesize')
                queueMicrotask(() =>
                  worker.onmessage({
                    data: { id: data.id, type: 'result', value: { cacheAvailable: true } },
                  }),
                );
            },
            terminate() {
              this.terminated = true;
            },
          };
          bucket.push(worker);
          return worker;
        },
      });
    }
    const synth = (worker) => worker.messages.filter((message) => message.method === 'synthesize');
    const texts = (worker) => synth(worker).map((message) => message.args.text);
    const workers = [];
    const runtime = fakeRuntime(workers);
    const beforeLoad = { sessions: runtime.kokoroSessionCount, workers: workers.length };
    await runtime.setKokoroSessions(4);
    const beforeWorkers = workers.length;
    await runtime.load('kokoro', { voiceId: 'af_heart' });
    const loaded = {
      workers: workers.length,
      methods: workers.map((worker) => worker.messages.map((message) => message.method)),
      ready: runtime.kokoroPoolReady,
      voice: runtime.isVoiceLoaded('af_heart'),
    };
    const pending = [];
    for (let index = 0; index < 4; index++)
      pending.push(settle(runtime.synthesize(`S${index}.`, { voiceId: 'af_heart' })));
    await flush();
    const parallel = workers.map(texts);
    const extra = [];
    for (let index = 4; index < 8; index++)
      extra.push(settle(runtime.synthesize(`S${index}.`, { voiceId: 'af_heart' })));
    await flush();
    const queued = workers.map(texts);
    const overflow = await runtime
      .synthesize('S8.', { voiceId: 'af_heart' })
      .then(() => '')
      .catch((error) => error.message);
    workers[0].onmessage({
      data: {
        id: synth(workers[0])[0].id,
        type: 'result',
        value: { chunks: [], sampleRate: 24000 },
      },
    });
    await flush();
    const afterFirst = texts(workers[0]);
    workers[1].onmessage({
      data: {
        id: synth(workers[1])[0].id,
        type: 'error',
        value: { name: 'Error', message: 'bad sentence' },
      },
    });
    await flush();
    const afterError = {
      terminated: workers.map((worker) => worker.terminated),
      second: await pending[1],
      continued: texts(workers[1]),
    };
    runtime.cancel();
    await flush();
    const cancelled = await pending[2];
    const kept = {
      terminated: workers.map((worker) => worker.terminated),
      ready: runtime.isLoaded('kokoro'),
      first: await pending[0],
    };

    const retireWorkers = [];
    const retire = fakeRuntime(retireWorkers);
    await retire.load('kokoro', { voiceId: 'af_heart' });
    const early = [
      settle(retire.synthesize('A.', { voiceId: 'af_heart' })),
      settle(retire.synthesize('B.', { voiceId: 'af_heart' })),
    ];
    await flush();
    await retire.setKokoroSessions(1);
    const third = settle(retire.synthesize('C.', { voiceId: 'af_heart' }));
    await flush();
    const whileBusy = {
      sessions: retire.kokoroSessionCount,
      terminated: retireWorkers.map((worker) => worker.terminated),
      posted: retireWorkers.map(texts),
    };
    retireWorkers[1].onmessage({
      data: {
        id: synth(retireWorkers[1])[0].id,
        type: 'result',
        value: { chunks: [], sampleRate: 24000 },
      },
    });
    await flush();
    const retired = {
      b: await early[1],
      terminated: retireWorkers.map((worker) => worker.terminated),
      posted: retireWorkers.map(texts),
    };
    retireWorkers[0].onmessage({
      data: {
        id: synth(retireWorkers[0])[0].id,
        type: 'result',
        value: { chunks: [], sampleRate: 24000 },
      },
    });
    await flush();
    const continued = retireWorkers.map(texts);
    retireWorkers[0].onmessage({
      data: {
        id: synth(retireWorkers[0]).at(-1).id,
        type: 'result',
        value: { chunks: [], sampleRate: 24000 },
      },
    });
    await flush();
    const afterRetire = {
      a: await early[0],
      c: await third,
      ready: retire.isLoaded('kokoro'),
      alive: retireWorkers.filter((worker) => !worker.terminated).length,
      continued,
    };
    await retire.setKokoroSessions(3);
    const increased = {
      sessions: retire.kokoroSessionCount,
      live: retireWorkers
        .filter((worker) => !worker.terminated)
        .map((worker) => worker.messages.map((message) => message.method)),
    };

    const cappedWorkers = [];
    const capped = fakeRuntime(cappedWorkers);
    await capped.setKokoroSessions(100);
    const preloaded = cappedWorkers.length;
    await capped.load('kokoro', { voiceId: 'af_heart' });
    for (let index = 0; index < 8; index++)
      capped.synthesize(`P${index}.`, { voiceId: 'af_heart' });
    const capParallel = cappedWorkers.map(
      (worker) => worker.messages.filter((message) => message.method === 'synthesize').length,
    );
    const capNinth = await capped
      .synthesize('P8.', { voiceId: 'af_heart' })
      .then(() => '')
      .catch((error) => error.message);
    return {
      beforeLoad,
      beforeWorkers,
      loaded,
      parallel,
      queued,
      overflow,
      afterFirst,
      afterError,
      cancelled,
      kept,
      whileBusy,
      retired,
      afterRetire,
      increased,
      cap: {
        preloaded,
        sessions: capped.kokoroSessionCount,
        workers: cappedWorkers.length,
        parallel: capParallel,
        ninth: capNinth,
      },
    };
  });
  expect(result.beforeLoad).toEqual({ sessions: 2, workers: 0 });
  expect(result.beforeWorkers).toBe(0);
  expect(result.loaded).toEqual({
    workers: 4,
    methods: [['load'], ['load'], ['load'], ['load']],
    ready: true,
    voice: true,
  });
  expect(result.parallel).toEqual([['S0.'], ['S1.'], ['S2.'], ['S3.']]);
  expect(result.queued).toEqual([['S0.'], ['S1.'], ['S2.'], ['S3.']]);
  expect(result.overflow).toBe('Speech is already preparing the maximum number of sentences.');
  expect(result.afterFirst).toEqual(['S0.', 'S4.']);
  expect(result.afterError.terminated).toEqual([false, false, false, false]);
  expect(result.afterError.second).toEqual({ ok: false, message: 'bad sentence', name: 'Error' });
  expect(result.afterError.continued).toEqual(['S1.', 'S5.']);
  expect(result.cancelled).toEqual({ ok: false, message: 'Speech stopped.', name: 'AbortError' });
  expect(result.kept).toEqual({
    terminated: [false, false, false, false],
    ready: true,
    first: { ok: true, value: { chunks: [], sampleRate: 24000 } },
  });
  expect(result.whileBusy).toEqual({
    sessions: 1,
    terminated: [false, false],
    posted: [['A.'], ['B.']],
  });
  expect(result.retired).toEqual({
    b: { ok: true, value: { chunks: [], sampleRate: 24000 } },
    terminated: [false, true],
    posted: [['A.'], ['B.']],
  });
  expect(result.afterRetire).toEqual({
    a: { ok: true, value: { chunks: [], sampleRate: 24000 } },
    c: { ok: true, value: { chunks: [], sampleRate: 24000 } },
    ready: true,
    alive: 1,
    continued: [['A.', 'C.'], ['B.']],
  });
  expect(result.increased).toEqual({
    sessions: 3,
    live: [['load', 'synthesize', 'synthesize'], ['load'], ['load']],
  });
  expect(result.cap).toEqual({
    preloaded: 0,
    sessions: 8,
    workers: 8,
    parallel: [1, 1, 1, 1, 1, 1, 1, 1],
    ninth: 'Speech is already preparing the maximum number of sentences.',
  });
});
