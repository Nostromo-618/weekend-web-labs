import { expect, test } from '@playwright/test';

test('a stopped pair evaluation keeps completed turns and its partial report', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const { runPairEvaluation } = await import('/src/lib/model-evaluation.js');
    const controller = new AbortController();
    const modelIds = ['gemma-4-E2B-it-web', 'LFM2.5-2.6B-q4f16-ONNX'];
    const state = {
      models: [...modelIds],
      panes: [
        { turns: [{ response: 'completed on A', status: 'complete' }] },
        { turns: [{ response: 'completed on B', status: 'complete' }] },
      ],
    };
    let stopCalls = 0;
    const compare = {
      state,
      chats: [{ isLoaded: () => true }, { isLoaded: () => true }],
      loadPair: async () => {},
      send: async (prompt) => {
        state.panes[0].turns.push({ prompt, response: 'partial on A', status: 'stopped' });
        state.panes[1].turns.push({ prompt, response: 'completed on B', status: 'complete' });
        controller.abort();
      },
      stop: () => {
        stopCalls++;
      },
      export: () => ({
        schemaVersion: 2,
        kind: 'paired-chat',
        models: modelIds.map((id) => ({ id })),
        turns: structuredClone(state.panes.map((pane) => pane.turns)),
      }),
      dispose: async () => {},
    };
    const result = await runPairEvaluation({
      modelIds,
      signal: controller.signal,
      createCompare: () => compare,
    });
    return { report: result, stopCalls };
  });

  expect(report.report.stopped).toBe(true);
  expect(report.report.turns[0]).toContainEqual({
    response: 'completed on A',
    status: 'complete',
  });
  expect(report.report.turns[0]).toContainEqual({
    prompt: 'Remember that our project codename is Amber Finch. Acknowledge briefly.',
    response: 'partial on A',
    status: 'stopped',
  });
  expect(report.report.turns[1]).toContainEqual({
    response: 'completed on B',
    status: 'complete',
  });
  expect(report.report.checks).toEqual([{ id: 'simultaneous-residency', pass: true }]);
  expect(report.stopCalls).toBe(1);
});

test('pair recovery retries only the stopped pane', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { runPairEvaluation } = await import('/src/lib/model-evaluation.js');
    const modelIds = ['gemma-4-E2B-it-web', 'LFM2.5-2.6B-q4f16-ONNX'];
    const state = {
      models: [...modelIds],
      busy: false,
      panes: [
        { turns: [], status: 'Ready' },
        { turns: [], status: 'Ready' },
      ],
    };
    let onChange;
    const retries = [];
    const compare = {
      state,
      chats: [{ isLoaded: () => true }, { isLoaded: () => true }],
      loadPair: async () => {},
      send: async (prompt) => {
        const responses = prompt.startsWith('Remember')
          ? ['Amber Finch acknowledged.', 'Amber Finch noted.']
          : prompt.startsWith('What')
            ? ['Amber Finch.', 'Amber Finch.']
            : ['An unfinished island story.', 'A complete island story.'];
        const turns = responses.map((response, i) => ({
          prompt,
          response,
          status: i === 0 && prompt.startsWith('Write') ? 'running' : 'complete',
        }));
        turns.forEach((turn, i) => state.panes[i].turns.push(turn));
        if (prompt.startsWith('Write')) {
          state.busy = true;
          onChange(state);
          await new Promise((resolve) => setTimeout(resolve, 80));
          turns[0].response = 'An unfinished island story.';
          turns[1].status = 'complete';
          state.busy = false;
          onChange(state);
        }
      },
      stop: (i) => {
        if (i !== undefined) state.panes[i].turns.at(-1).status = 'stopped';
      },
      retry: async (i) => {
        retries.push(i);
        const turn = state.panes[i].turns.at(-1);
        turn.status = 'complete';
        turn.response = 'The retried story is complete.';
      },
      export: () => ({
        schemaVersion: 2,
        kind: 'paired-chat',
        models: modelIds.map((id) => ({ id })),
        turns: structuredClone(state.panes.map((pane) => pane.turns)),
      }),
      dispose: async () => {},
    };
    const report = await runPairEvaluation({
      modelIds,
      createCompare: (options) => {
        onChange = options.onChange;
        return compare;
      },
    });
    return { report, retries, rightTurns: state.panes[1].turns };
  });

  expect(result.retries).toEqual([0]);
  expect(result.report.checks).toEqual([
    { id: 'simultaneous-residency', pass: true },
    { id: 'paired-recall', pass: true },
    { id: 'independent-stop', pass: true },
    { id: 'pair-retry-stopped-side', pass: true },
  ]);
  expect(result.report.turns[0].at(-1)).toMatchObject({
    status: 'complete',
    response: 'The retried story is complete.',
  });
  expect(result.rightTurns).toHaveLength(3);
  expect(result.rightTurns.at(-1)).toMatchObject({
    status: 'complete',
    response: 'A complete island story.',
  });
});
