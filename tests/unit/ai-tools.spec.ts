import { test, expect } from '@playwright/test';

const HARNESS = '/tests/fixtures/blank-harness.html';

test.describe('AiChat tool calling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
  });

  test('generateWithTools rejects non-LiteRT models', async ({ page }) => {
    const message = await page.evaluate(async () => {
      const { AiChat, TOOLS_UNSUPPORTED_ERROR } =
        await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');
      const chat = new AiChat({ modelId: 'LFM2.5-2.6B-q4f16-ONNX' });
      chat.registerTools([{ name: 'ping', description: 'ping', parameters: { type: 'object' } }]);
      chat._isLoaded = true;
      chat.engine = {};
      try {
        await chat.generateWithTools('hi', { execute: async () => ({}) });
        return 'expected-throw';
      } catch (err) {
        return err?.message || String(err);
      }
    });
    expect(message).toMatch(/Tool calling is only supported|TOOLS_UNSUPPORTED/i);
  });

  test('generateWithTools XML loop executes allowlisted tool then returns final reply', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { AiChat } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');
      const chat = new AiChat({
        modelId: 'gemma-4-E2B-it-web',
        toolProtocol: 'xml',
        systemPromptOptions: { product: 'Labs Test' },
      });
      chat.registerTools([
        {
          name: 'search_curriculum',
          description: 'Search lessons',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ]);
      chat._isLoaded = true;
      chat.engine = {
        createConversation: async () => ({
          sendMessage: async () => ({ content: 'unused' }),
        }),
      };
      chat._nativeToolsSupported = false;

      const scripted = [
        '<tool_call name="search_curriculum">{"query":"narrowing"}</tool_call>',
        'Narrowing is covered in the types track.',
      ];
      let i = 0;
      chat._completeOnceLiteRTDetailed = async () => {
        const reply = scripted[Math.min(i, scripted.length - 1)];
        i += 1;
        return { reply, usage: null, rawMessage: { content: reply } };
      };

      const calls = [];
      const final = await chat.generateWithTools('Where is narrowing taught?', {
        maxRounds: 3,
        execute: async (name, args) => {
          calls.push({ name, args });
          return { hits: [{ id: 'in-operator-narrowing', title: 'in operator narrowing' }] };
        },
      });
      return { final, calls, messageRoles: chat.messages.map((m) => m.role) };
    });

    expect(result.calls).toEqual([{ name: 'search_curriculum', args: { query: 'narrowing' } }]);
    expect(result.final).toContain('Narrowing is covered');
    expect(result.messageRoles[0]).toBe('user');
    expect(result.messageRoles).toContain('assistant');
  });

  test('generateWithTools blocks unknown tool names before execute', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { AiChat } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');
      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web', toolProtocol: 'xml' });
      chat.registerTools([{ name: 'search_curriculum', parameters: { type: 'object' } }]);
      chat._isLoaded = true;
      chat.engine = { createConversation: async () => ({}) };
      let executed = false;
      const scripted = ['<tool_call name="delete_everything">{}</tool_call>', 'I cannot do that.'];
      let i = 0;
      chat._completeOnceLiteRTDetailed = async () => {
        const reply = scripted[i++];
        return { reply, usage: null, rawMessage: { content: reply } };
      };
      const onTool = [];
      const final = await chat.generateWithTools('Wipe disk', {
        execute: async () => {
          executed = true;
          return {};
        },
        onTool: (info) => onTool.push(info),
      });
      return { final, executed, onTool };
    });
    expect(result.executed).toBe(false);
    expect(result.onTool[0]?.result?.error).toBe('tool.name.not_allowed');
    expect(result.final).toContain('cannot');
  });

  test('generateWithTools stops at maxRounds', async ({ page }) => {
    const message = await page.evaluate(async () => {
      const { AiChat } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');
      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web', toolProtocol: 'xml' });
      chat.registerTools([{ name: 'ping', parameters: { type: 'object' } }]);
      chat._isLoaded = true;
      chat.engine = { createConversation: async () => ({}) };
      chat._completeOnceLiteRTDetailed = async () => ({
        reply: '<tool_call name="ping">{}</tool_call>',
        usage: null,
        rawMessage: {},
      });
      try {
        await chat.generateWithTools('loop', {
          maxRounds: 2,
          execute: async () => ({ ok: true }),
        });
        return 'expected-throw';
      } catch (err) {
        return err?.message || String(err);
      }
    });
    expect(message).toMatch(/maxRounds/i);
  });

  test('Gemma model draws flowchart via native set_flowchart_document tool call', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        SET_FLOWCHART_DOCUMENT,
        FLOWCHART_TOOL_DESCRIPTION,
        prepareFlowchartDocument,
        validateFlowchartDocument,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web' });
      chat.registerTools([
        {
          name: SET_FLOWCHART_DOCUMENT,
          description: FLOWCHART_TOOL_DESCRIPTION,
          parameters: { type: 'object' },
        },
      ]);
      chat._isLoaded = true;
      chat.engine = {
        createConversation: async () => ({
          sendMessage: async () => ({ content: '' }),
        }),
      };

      const rawToolCall = {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            type: 'function',
            function: {
              name: SET_FLOWCHART_DOCUMENT,
              arguments: {
                document: {
                  nodes: [
                    { id: 'start', type: 'circle', text: 'Start' },
                    { id: 'step-1', type: 'rect', text: 'Process Order' },
                  ],
                  edges: [
                    { id: 'e1', from: { nodeId: 'start' }, to: { nodeId: 'step-1' } },
                  ],
                },
              },
            },
          },
        ],
      };

      let step = 0;
      chat._completeOnceLiteRTDetailed = async () => {
        if (step === 0) {
          step++;
          return { reply: '', usage: null, rawMessage: rawToolCall };
        }
        return {
          reply: 'I have drawn the order processing flowchart with Start and Process Order steps.',
          usage: null,
          rawMessage: { content: 'I have drawn the order processing flowchart.' },
        };
      };

      let appliedDocument = null;
      const finalReply = await chat.generateWithTools('Please draw an order processing flowchart', {
        execute: async (name, args) => {
          if (name !== SET_FLOWCHART_DOCUMENT) return { error: 'unknown' };
          const prepared = prepareFlowchartDocument(args?.document);
          const validation = validateFlowchartDocument(prepared);
          if (validation.allowed) {
            appliedDocument = prepared;
            return { ok: true };
          }
          return { error: validation.code };
        },
      });

      return {
        finalReply,
        appliedDocument,
        messagesCount: chat.messages.length,
      };
    });

    expect(result.appliedDocument).not.toBeNull();
    expect(result.appliedDocument.nodes).toHaveLength(2);
    expect(result.appliedDocument.nodes[0].text).toBe('Start');
    expect(result.appliedDocument.nodes[1].text).toBe('Process Order');
    expect(result.appliedDocument.edges[0].from.port).toBe('bottom');
    expect(result.appliedDocument.edges[0].to.port).toBe('top');
    expect(result.finalReply).toContain('drawn the order processing flowchart');
    expect(result.messagesCount).toBe(2);
  });

  test('Gemma model recovers loose call:set_flowchart_document syntax when parser throws', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        SET_FLOWCHART_DOCUMENT,
        FLOWCHART_TOOL_DESCRIPTION,
        prepareFlowchartDocument,
        validateFlowchartDocument,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web' });
      chat.registerTools([
        {
          name: SET_FLOWCHART_DOCUMENT,
          description: FLOWCHART_TOOL_DESCRIPTION,
          parameters: { type: 'object' },
        },
      ]);
      chat._isLoaded = true;
      chat.engine = {
        createConversation: async () => ({
          sendMessage: async () => ({ content: '' }),
        }),
      };

      const gemmaError =
        'Failed to parse tool calls from code block: call:set_flowchart_document{document:{nodes:[{id:"n1",type:"rounded-rect",text:"Async Task"}],edges:[]}}';

      chat._completeOnceLiteRTDetailed = async () => {
        throw new Error(gemmaError);
      };

      let capturedDocument = null;
      const finalReply = await chat.generateWithTools('Diagram an async task', {
        execute: async (name, args) => {
          if (name === SET_FLOWCHART_DOCUMENT) {
            const prepared = prepareFlowchartDocument(args?.document);
            const check = validateFlowchartDocument(prepared);
            if (check.allowed) {
              capturedDocument = prepared;
              return { ok: true };
            }
          }
          return { error: 'failed' };
        },
      });

      return {
        finalReply,
        capturedDocument,
      };
    });

    expect(result.finalReply).toBe('Updated the flowchart.');
    expect(result.capturedDocument).not.toBeNull();
    expect(result.capturedDocument.nodes[0].text).toBe('Async Task');
  });

  test('Flowchart draw follow-up prompts model when canvas remains unchanged', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        SET_FLOWCHART_DOCUMENT,
        FLOWCHART_DRAW_FOLLOW_UP,
        flowchartDrawNeedsFollowUp,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const initialEmpty = { nodes: [], edges: [] };
      const prompt = 'Please draw a flowchart for user login';

      const needsFollowUpInitially = flowchartDrawNeedsFollowUp(prompt, initialEmpty, initialEmpty);

      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web' });
      chat.registerTools([
        {
          name: SET_FLOWCHART_DOCUMENT,
          parameters: { type: 'object' },
        },
      ]);
      chat._isLoaded = true;
      chat.engine = {
        createConversation: async () => ({
          sendMessage: async () => ({ content: '' }),
        }),
      };

      let round = 0;
      chat._completeOnceLiteRTDetailed = async (pendingInput) => {
        round++;
        if (round === 1) {
          // Model describes instead of calling tool
          return {
            reply: 'User login involves entering username and password.',
            usage: null,
            rawMessage: { content: 'User login involves entering username and password.' },
          };
        }
        // Round 2: follow-up received, model calls tool
        return {
          reply: '',
          usage: null,
          rawMessage: {
            role: 'assistant',
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: SET_FLOWCHART_DOCUMENT,
                  arguments: {
                    document: {
                      nodes: [{ id: 'login-node', type: 'rect', text: 'Enter Credentials' }],
                      edges: [],
                    },
                  },
                },
              },
            ],
          },
        };
      };

      // Simulating WwlAiChatUI's follow-up pattern
      let canvasUpdated = false;
      let firstReply = await chat.generateWithTools(prompt, {
        execute: async (name, args) => {
          if (name === SET_FLOWCHART_DOCUMENT) {
            canvasUpdated = true;
            return { ok: true };
          }
          return { error: 'unknown' };
        },
      });

      let finalReply = firstReply;
      if (!canvasUpdated && flowchartDrawNeedsFollowUp(prompt, initialEmpty, initialEmpty)) {
        chat._completeOnceLiteRTDetailed = async () => ({
          reply: 'I have drawn the login diagram on the canvas.',
          usage: null,
          rawMessage: { content: 'I have drawn the login diagram on the canvas.' },
        });
        finalReply = await chat.generateWithTools(FLOWCHART_DRAW_FOLLOW_UP, {
          execute: async (name) => {
            if (name === SET_FLOWCHART_DOCUMENT) {
              canvasUpdated = true;
              return { ok: true };
            }
            return { error: 'unknown' };
          },
        });
      }

      return {
        needsFollowUpInitially,
        finalReply,
      };
    });

    expect(result.needsFollowUpInitially).toBe(true);
    expect(result.finalReply).toContain('drawn the login diagram');
  });

  test('Model explains on-screen flowchart using structured snapshot and redacts unsafe content', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        flowchartSnapshot,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const onScreenDiagram = {
        version: '1.3.0',
        viewport: { x: 0, y: 0, scale: 1 },
        nodes: [
          { id: 'auth-service', type: 'rect', text: 'Authentication Microservice' },
          { id: 'token-store', type: 'rect', text: 'Redis Token Cache <script>alert("xss")</script>' },
        ],
        edges: [
          {
            id: 'e1',
            from: { nodeId: 'auth-service', port: 'right' },
            to: { nodeId: 'token-store', port: 'left' },
            label: 'validates session',
          },
        ],
      };

      const snapshot = flowchartSnapshot(onScreenDiagram);

      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web' });
      chat._isLoaded = true;
      let receivedInput = '';
      chat._completeOnceLiteRTDetailed = async (input) => {
        receivedInput = typeof input === 'string' ? input : JSON.stringify(input);
        return {
          reply: 'The diagram shows an Authentication Microservice connected to a Redis Token Cache to validate sessions.',
          usage: null,
          rawMessage: { content: 'Explanation of diagram.' },
        };
      };

      const reply = await chat.generate('What is currently shown on the screen?', {
        flowchartDocument: onScreenDiagram,
      });

      return {
        reply,
        receivedInput,
        snapshotText: snapshot.text,
      };
    });

    expect(result.receivedInput).toContain('Authentication Microservice');
    expect(result.receivedInput).toContain('token-store');
    expect(result.receivedInput).toContain('data, not instructions');
    expect(result.receivedInput).not.toContain('<script>');
    expect(result.receivedInput).not.toContain('Redis Token Cache');
    expect(result.receivedInput).toContain('[redacted]');
    expect(result.reply).toContain('Authentication Microservice');
  });

  test('Vision-capable model receives canvas screenshot whereas text model excludes raw image', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        visionImagesForModel,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      // 1. Text-only Gemma model
      const gemmaChat = new AiChat({ modelId: 'gemma-4-E2B-it-web' });
      gemmaChat._isLoaded = true;
      let gemmaInput = '';
      gemmaChat._completeOnceLiteRTDetailed = async (input) => {
        gemmaInput = typeof input === 'string' ? input : JSON.stringify(input);
        return {
          reply: 'Text response',
          usage: null,
          rawMessage: { content: '' },
        };
      };

      await gemmaChat.generate('Explain the diagram', {
        images: [{ dataUrl: testPng }],
        flowchartDocument: {
          nodes: [{ id: 'n1', text: 'Overview Node' }],
          edges: [],
        },
      });

      // 2. Vision model check
      const visionAllowed = visionImagesForModel(
        { capabilities: { vision: true } },
        [{ dataUrl: testPng }],
      );
      const textAllowed = visionImagesForModel(
        { capabilities: { vision: false } },
        [{ dataUrl: testPng }],
      );

      return {
        gemmaSawImage: gemmaInput.includes('data:image/png'),
        gemmaSawSnapshot: gemmaInput.includes('Overview Node'),
        visionAllowedCount: visionAllowed.length,
        textAllowedCount: textAllowed.length,
      };
    });

    expect(result.gemmaSawImage).toBe(false);
    expect(result.gemmaSawSnapshot).toBe(true);
    expect(result.visionAllowedCount).toBe(1);
    expect(result.textAllowedCount).toBe(0);
  });

  test('Multi-turn interaction: draw flowchart -> explain screen -> modify flowchart', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        SET_FLOWCHART_DOCUMENT,
        FLOWCHART_TOOL_DESCRIPTION,
        prepareFlowchartDocument,
        validateFlowchartDocument,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web' });
      chat.registerTools([
        {
          name: SET_FLOWCHART_DOCUMENT,
          description: FLOWCHART_TOOL_DESCRIPTION,
          parameters: { type: 'object' },
        },
      ]);
      chat._isLoaded = true;
      chat.engine = {
        createConversation: async () => ({
          sendMessage: async () => ({ content: '' }),
        }),
      };

      let currentDocument = { nodes: [], edges: [] };
      const toolExecutor = async (name, args) => {
        if (name === SET_FLOWCHART_DOCUMENT) {
          const prepared = prepareFlowchartDocument(args?.document);
          const check = validateFlowchartDocument(prepared);
          if (check.allowed) {
            currentDocument = prepared;
            return { ok: true };
          }
          return { error: check.code };
        }
        return { error: 'unknown' };
      };

      // Turn 1: User asks to draw flowchart
      chat._completeOnceLiteRTDetailed = async () => ({
        reply: '',
        usage: null,
        rawMessage: {
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              function: {
                name: SET_FLOWCHART_DOCUMENT,
                arguments: {
                  document: {
                    nodes: [
                      { id: 'step-a', type: 'rect', text: 'Step A' },
                      { id: 'step-b', type: 'rect', text: 'Step B' },
                    ],
                    edges: [
                      { id: 'e1', from: { nodeId: 'step-a' }, to: { nodeId: 'step-b' } },
                    ],
                  },
                },
              },
            },
          ],
        },
      });

      // The second round of Turn 1 gives final reply
      let turn1Round = 0;
      const originalComplete = chat._completeOnceLiteRTDetailed;
      chat._completeOnceLiteRTDetailed = async () => {
        turn1Round++;
        if (turn1Round === 1) return originalComplete();
        return {
          reply: 'I created the diagram with Step A and Step B.',
          usage: null,
          rawMessage: { content: 'Diagram created.' },
        };
      };

      const reply1 = await chat.generateWithTools('Draw a diagram with Step A and Step B', {
        execute: toolExecutor,
        flowchartDocument: currentDocument,
      });

      // Turn 2: User asks to explain what is on the screen
      chat._completeOnceLiteRTDetailed = async () => ({
        reply: 'The screen currently displays a two-step process: Step A transitions to Step B.',
        usage: null,
        rawMessage: { content: 'Explanation provided.' },
      });

      const reply2 = await chat.generate('Explain the diagram on my screen', {
        flowchartDocument: currentDocument,
      });

      // Turn 3: User asks to add Step C
      let turn3Round = 0;
      chat._completeOnceLiteRTDetailed = async () => {
        turn3Round++;
        if (turn3Round === 1) {
          return {
            reply: '',
            usage: null,
            rawMessage: {
              role: 'assistant',
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: SET_FLOWCHART_DOCUMENT,
                    arguments: {
                      document: {
                        nodes: [
                          ...currentDocument.nodes,
                          { id: 'step-c', type: 'rect', text: 'Step C' },
                        ],
                        edges: [
                          ...currentDocument.edges,
                          { id: 'e2', from: { nodeId: 'step-b' }, to: { nodeId: 'step-c' } },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          };
        }
        return {
          reply: 'I updated the flowchart to include Step C.',
          usage: null,
          rawMessage: { content: 'Flowchart updated.' },
        };
      };

      const reply3 = await chat.generateWithTools('Now add Step C after Step B', {
        execute: toolExecutor,
        flowchartDocument: currentDocument,
      });

      return {
        reply1,
        reply2,
        reply3,
        finalNodesCount: currentDocument.nodes.length,
        finalEdgesCount: currentDocument.edges.length,
      };
    });

    expect(result.reply1).toContain('created the diagram');
    expect(result.reply2).toContain('Step A transitions to Step B');
    expect(result.reply3).toContain('updated the flowchart to include Step C');
    expect(result.finalNodesCount).toBe(3);
    expect(result.finalEdgesCount).toBe(2);
  });

  test('WebLLM Ministral model is excluded from default flowchart tools and only runs XML protocol when explicitly configured', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        getModelOption,
        SET_FLOWCHART_DOCUMENT,
        FLOWCHART_TOOL_DESCRIPTION,
        prepareFlowchartDocument,
        validateFlowchartDocument,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const option = getModelOption('Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC');
      const defaultToolsEnabled = !!option?.capabilities?.tools;

      const chat = new AiChat({
        modelId: 'Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC',
        toolProtocol: 'xml',
      });
      chat.registerTools([
        {
          name: SET_FLOWCHART_DOCUMENT,
          description: FLOWCHART_TOOL_DESCRIPTION,
          parameters: { type: 'object' },
        },
      ]);
      chat._isLoaded = true;

      const replies = [
        '<tool_call name="set_flowchart_document">{"document":{"nodes":[{"id":"m1","type":"diamond","text":"Condition Check"}],"edges":[]}}</tool_call>',
        'Flowchart condition node placed on the board.',
      ];
      let callIndex = 0;
      chat.engine = {
        chat: {
          completions: {
            create: async () => {
              const reply = replies[Math.min(callIndex, replies.length - 1)];
              callIndex++;
              return (async function* () {
                yield { choices: [{ delta: { content: reply } }] };
              })();
            },
          },
        },
      };

      let placedDoc = null;
      const final = await chat.generateWithTools('Add a decision diamond', {
        execute: async (name, args) => {
          if (name === SET_FLOWCHART_DOCUMENT) {
            const prep = prepareFlowchartDocument(args?.document);
            if (validateFlowchartDocument(prep).allowed) {
              placedDoc = prep;
              return { ok: true };
            }
          }
          return { error: 'invalid' };
        },
      });

      return {
        defaultToolsEnabled,
        final,
        placedDoc,
      };
    });

    expect(result.defaultToolsEnabled).toBe(false);
    expect(result.final).toContain('condition node placed');
    expect(result.placedDoc).not.toBeNull();
    expect(result.placedDoc.nodes[0].type).toBe('diamond');
    expect(result.placedDoc.nodes[0].text).toBe('Condition Check');
  });

  test('Flowchart tool safely rejects malformed and malicious documents in tool arguments', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const {
        AiChat,
        SET_FLOWCHART_DOCUMENT,
        validateFlowchartDocument,
      } = await import('/node_modules/@wwl/wwl-ai-chat/dist/index.js');

      const chat = new AiChat({ modelId: 'gemma-4-E2B-it-web', toolProtocol: 'xml' });
      chat.registerTools([
        {
          name: SET_FLOWCHART_DOCUMENT,
          parameters: { type: 'object' },
        },
      ]);
      chat._isLoaded = true;
      chat.engine = { createConversation: async () => ({}) };

      // Scripted attack: node with external phishing URL and XSS
      const maliciousScript = [
        '<tool_call name="set_flowchart_document">{"document":{"nodes":[{"id":"n1","type":"rect","text":"https://phishing.site <script>evil()</script>"}],"edges":[]}}</tool_call>',
        'The flowchart update was rejected due to safety violations.',
      ];
      let i = 0;
      chat._completeOnceLiteRTDetailed = async () => ({
        reply: maliciousScript[i++],
        usage: null,
        rawMessage: {},
      });

      let appliedOnCanvas = false;
      const onToolEvents = [];

      const finalReply = await chat.generateWithTools('Draw a diagram with a link', {
        execute: async (name, args) => {
          if (name === SET_FLOWCHART_DOCUMENT) {
            const check = validateFlowchartDocument(args?.document);
            if (!check.allowed) {
              return { error: check.code, message: check.message };
            }
            appliedOnCanvas = true;
            return { ok: true };
          }
          return { error: 'unknown' };
        },
        onTool: (info) => onToolEvents.push(info),
      });

      return {
        appliedOnCanvas,
        onToolEvents,
        finalReply,
      };
    });

    expect(result.appliedOnCanvas).toBe(false);
    expect(result.onToolEvents[0].result.error).toMatch(/flowchart\.(text|node)/);
    expect(result.finalReply).toContain('rejected');
  });
});

