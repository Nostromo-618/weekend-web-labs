import { test, expect } from '@playwright/test';
import {
  flowchartChatOffered,
  localDemoChoiceLabel,
  shouldRegisterFlowchartTool,
} from '../../src/lib/flowchart-chat-mode.js';

const HARNESS = '/tests/fixtures/blank-harness.html';

test.describe('flowchart canvas mode', () => {
  test('does not offer flowchart editing to the on-device chat', () => {
    const diagram = { nodes: [{ id: 'start', text: 'Start' }], edges: [] };
    expect(flowchartChatOffered()).toBe(false);
    expect(shouldRegisterFlowchartTool(true, null)).toBe(false);
    expect(shouldRegisterFlowchartTool(true, undefined)).toBe(false);
    expect(shouldRegisterFlowchartTool(false, diagram)).toBe(false);
    expect(shouldRegisterFlowchartTool(true, diagram)).toBe(false);
    expect(localDemoChoiceLabel('Gemma · LiteRT · 2000 MB · Tools available')).toBe(
      'Gemma · LiteRT · 2000 MB · Diagram editing not offered',
    );
  });

  test('closed canvas drops the flowchart tool and states that the canvas is off', async ({
    page,
  }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    const prompt = await page.evaluate(async () => {
      const { AiChat, FLOWCHART_CANVAS_OFF_CLAUSE, SET_FLOWCHART_DOCUMENT } =
        await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');
      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web' });
      chat.registerTools([]);
      chat.setSystemPromptOptions({
        flowchartCanvas: 'off',
        extraRules: 'Answer in 1–3 short conversational sentences.',
      });
      const closed = chat._composeSystemPrompt();
      const toolsWhenClosed = chat._tools.map((tool) => tool.name);
      chat.registerTools([
        {
          name: SET_FLOWCHART_DOCUMENT,
          description: 'Draw the flowchart.',
          parameters: { type: 'object' },
        },
      ]);
      chat.setSystemPromptOptions({ flowchartCanvas: 'on' });
      const open = chat._composeSystemPrompt();
      return {
        clause: FLOWCHART_CANVAS_OFF_CLAUSE,
        closed,
        open,
        toolsWhenClosed,
        toolsWhenOpen: chat._tools.map((tool) => tool.name),
      };
    });
    expect(prompt.closed).toContain(prompt.clause);
    expect(prompt.closed).toContain('1–3 short conversational sentences');
    expect(prompt.closed).not.toContain('set_flowchart_document');
    expect(prompt.toolsWhenClosed).toEqual([]);
    expect(prompt.open).toContain('set_flowchart_document');
    expect(prompt.open).not.toContain(prompt.clause);
    expect(prompt.toolsWhenOpen).toEqual(['set_flowchart_document']);
  });
});
