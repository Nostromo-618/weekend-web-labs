import { test, expect } from '@playwright/test';

const HARNESS = '/tests/fixtures/neptune-harness.html';

test.describe('paired local chat session', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
  });

  test('keeps independent histories and exercises supported backend pairings', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { CompareSession } = await import('/src/lib/compare-session.js');
      const pairings = [
        ['gemma-4-E2B-it-web', 'gemma-4-E2B-it-web'],
        ['LFM2.5-2.6B-q4f16-ONNX', 'LFM2.5-2.6B-q4-ONNX'],
        ['LFM2.5-2.6B-q4f16-ONNX', 'gemma-4-E4B-it-web'],
        ['gemma-4-E2B-it-web', 'LFM2.5-2.6B-q4f16-ONNX'],
        ['gemma-4-E2B-it-web', 'gemma-4-E4B-it-web'],
      ];
      const observations = [];
      for (const models of pairings) {
        const metrics = { active: 0, maximum: 0, loads: [], instances: [] };
        class FakeChat {
          constructor(id) {
            this.id = id;
            this.index = metrics.instances.length;
            this.history = [];
            this.calls = 0;
            this.loaded = false;
            metrics.instances.push(this);
          }
          isLoaded() {
            return this.loaded;
          }
          onProgress() {
            return () => {};
          }
          async load() {
            metrics.loads.push(`start-${this.index}`);
            await Promise.resolve();
            this.loaded = true;
            metrics.loads.push(`end-${this.index}`);
          }
          async dispose() {
            this.loaded = false;
          }
          async setHistory(value) {
            this.history = structuredClone(value);
          }
          getHistory() {
            return structuredClone(this.history);
          }
          reset() {
            this.history = [];
          }
          cancel() {}
          async generate(prompt, options) {
            this.calls++;
            metrics.active++;
            metrics.maximum = Math.max(metrics.maximum, metrics.active);
            try {
              await new Promise((resolve) => setTimeout(resolve, 8));
              const answer = `pane-${this.index}-turn-${this.calls}`;
              options.onUpdate(answer);
              this.history.push(
                { role: 'user', content: prompt },
                { role: 'assistant', content: answer },
              );
              options.onFinish({ completion_tokens: 4 });
              return answer;
            } finally {
              metrics.active--;
            }
          }
        }
        const session = new CompareSession({
          modelA: models[0],
          createChat: (id) => new FakeChat(id),
        });
        session.system = { webgpuSupported: true, shaderF16: true };
        session.state.models = [...models];
        await session.loadPair();
        await session.send('first shared prompt');
        await session.send('follow-up');
        const independent =
          session.chats[0].history.at(-1).content !== session.chats[1].history.at(-1).content;
        const exported = session.export();
        await session.suspend();
        await session.loadPair();
        const preserved = session.chats.every((chat) => chat.getHistory().length === 4);
        observations.push({
          preserved,
          schemaVersion: exported.schemaVersion,
          exportHasModes: 'modes' in exported || 'mode' in exported,
          exportedTurns: exported.turns.map((turns) => turns.length),
          models,
          metrics: { maximum: metrics.maximum, loads: metrics.loads },
          independent,
          instances: session.chats.length,
          bothLoaded: session.chats.every((chat) => chat?.isLoaded()),
        });
        await session.dispose();
      }
      return observations;
    });

    expect(result).toHaveLength(5);
    for (const run of result) {
      expect(run.independent).toBe(true);
      expect(run.instances).toBe(2);
      expect(run.bothLoaded).toBe(true);
      expect(run.preserved).toBe(true);
      expect(run.schemaVersion).toBe(2);
      expect(run.exportHasModes).toBe(false);
      expect(run.exportedTurns).toEqual([2, 2]);
      expect(run.metrics.loads).toEqual([
        'start-0',
        'end-0',
        'start-1',
        'end-1',
        'start-2',
        'end-2',
        'start-3',
        'end-3',
      ]);
      expect(run.metrics.maximum).toBe(
        run.models.every(
          (id) =>
            id.startsWith('gemma-4-') || id === 'gemma-4-E2B-it-web' || id === 'gemma-4-E4B-it-web',
        )
          ? 1
          : 2,
      );
    }
  });

  test('allows one-sided stop and retry without rerunning the successful answer', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { CompareSession } = await import('/src/lib/compare-session.js');
      const counts = [0, 0];
      let entered;
      const firstStarted = new Promise((resolve) => {
        entered = resolve;
      });
      class FakeChat {
        constructor(id, index) {
          this.id = id;
          this.index = index;
          this.history = [];
          this.loaded = false;
        }
        isLoaded() {
          return this.loaded;
        }
        onProgress() {
          return () => {};
        }
        async load() {
          this.loaded = true;
        }
        async dispose() {
          this.loaded = false;
        }
        async setHistory(value) {
          this.history = structuredClone(value);
        }
        getHistory() {
          return structuredClone(this.history);
        }
        reset() {
          this.history = [];
        }
        cancel() {}
        async generate(prompt, options) {
          counts[this.index]++;
          if (this.index === 0 && counts[0] === 1) {
            entered();
            options.onUpdate('partial');
            await new Promise((resolve, reject) =>
              options.signal.addEventListener(
                'abort',
                () => reject(new DOMException('stopped', 'AbortError')),
                { once: true },
              ),
            );
          }
          const answer = `answer-${this.index}-${counts[this.index]}`;
          this.history.push(
            { role: 'user', content: prompt },
            { role: 'assistant', content: answer },
          );
          return answer;
        }
      }
      const session = new CompareSession({
        modelA: 'gemma-4-E2B-it-web',
        createChat: (id, index) => new FakeChat(id, index),
      });
      session.system = { webgpuSupported: true, shaderF16: true };
      session.state.models[1] = 'LFM2.5-2.6B-q4f16-ONNX';
      await session.loadPair();
      const pending = session.send('shared turn');
      await firstStarted;
      session.stop(0);
      await pending;
      const afterStop = session.state.panes.map((pane) => pane.turns.at(-1).status);
      await session.retry(0);
      const afterRetry = session.state.panes.map((pane) => pane.turns.at(-1).status);
      const finalCounts = [...counts];
      await session.dispose();
      return { afterStop, afterRetry, finalCounts };
    });
    expect(result.afterStop).toEqual(['stopped', 'complete']);
    expect(result.afterRetry).toEqual(['complete', 'complete']);
    expect(result.finalCounts).toEqual([2, 1]);
  });

  test('serializes lower-memory and dual-LiteRT generation and archives results on model changes', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { CompareSession } = await import('/src/lib/compare-session.js');
      const metrics = { active: 0, maximum: 0, disposed: 0 };
      class FakeChat {
        constructor(id) {
          this.id = id;
          this.history = [];
          this.loaded = false;
        }
        isLoaded() {
          return this.loaded;
        }
        onProgress() {
          return () => {};
        }
        async load() {
          this.loaded = true;
        }
        async dispose() {
          this.loaded = false;
          metrics.disposed++;
        }
        async setHistory(value) {
          this.history = structuredClone(value);
        }
        getHistory() {
          return structuredClone(this.history);
        }
        reset() {
          this.history = [];
        }
        cancel() {}
        async generate(prompt) {
          metrics.active++;
          metrics.maximum = Math.max(metrics.maximum, metrics.active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          metrics.active--;
          const answer = this.id;
          this.history.push(
            { role: 'user', content: prompt },
            { role: 'assistant', content: answer },
          );
          return answer;
        }
      }
      const session = new CompareSession({
        modelA: 'gemma-4-E2B-it-web',
        createChat: (id) => new FakeChat(id),
      });
      session.system = { webgpuSupported: true, shaderF16: true };
      session.state.models[1] = 'gemma-4-E4B-it-web';
      await session.loadPair();
      await session.send('paired');
      const togetherMaximum = metrics.maximum;
      metrics.maximum = 0;
      await session.setExecution('one-at-a-time');
      await session.loadPair();
      await session.send('serial');
      const lowerMemoryMaximum = metrics.maximum;
      await session.select(1, 'LFM2.5-2.6B-q4f16-ONNX');
      const archived =
        session.archives.length === 1 &&
        session.state.panes.every((pane) => pane.turns.length === 0);
      await session.dispose();
      return { togetherMaximum, lowerMemoryMaximum, archived, disposed: metrics.disposed };
    });
    expect(result.togetherMaximum).toBe(1);
    expect(result.lowerMemoryMaximum).toBe(1);
    expect(result.archived).toBe(true);
    expect(result.disposed).toBeGreaterThanOrEqual(2);
  });

  test('blocks confirmed missing WebGPU features while treating browser RAM estimates as advisory', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { CompareSession } = await import('/src/lib/compare-session.js');
      const attempts = [];
      class FakeChat {
        constructor(id) {
          this.id = id;
          this.loaded = false;
          this.history = [];
        }
        isLoaded() {
          return this.loaded;
        }
        onProgress() {
          return () => {};
        }
        async load() {
          attempts.push(this.id);
          this.loaded = true;
        }
        async dispose() {
          this.loaded = false;
        }
        async setHistory(value) {
          this.history = value;
        }
        getHistory() {
          return this.history;
        }
        reset() {}
        cancel() {}
        async generate() {
          return 'ok';
        }
      }
      const blocked = new CompareSession({
        modelA: 'gemma-4-E2B-it-web',
        createChat: (id) => new FakeChat(id),
        getDeviceSignals: async () => ({ webgpuSupported: false, shaderF16: false }),
      });
      blocked.state.models[1] = 'LFM2.5-2.6B-q4f16-ONNX';
      await blocked.loadPair();
      const missingGpu = blocked.state.error;
      await blocked.dispose();

      const limitedRam = new CompareSession({
        modelA: 'gemma-4-E2B-it-web',
        createChat: (id) => new FakeChat(id),
        getDeviceSignals: async () => ({
          webgpuSupported: true,
          shaderF16: true,
          deviceMemory: 2,
          hardwareConcurrency: 2,
        }),
      });
      limitedRam.state.models[1] = 'LFM2.5-2.6B-q4f16-ONNX';
      await limitedRam.loadPair();
      const loadedDespiteEstimate = limitedRam.chats.every((chat) => chat?.isLoaded());
      await limitedRam.dispose();
      return { missingGpu, loadedDespiteEstimate, attempts };
    });
    expect(result.missingGpu).toMatch(/WebGPU is unavailable/i);
    expect(result.loadedDespiteEstimate).toBe(true);
    expect(result.attempts).toHaveLength(2);
  });
});
