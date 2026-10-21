import { createApp, h } from 'vue';
import { VanduoVue, VdCard, VdThemeSwitcher } from '@vanduo-oss/vd3';
import '@vanduo-oss/vd3/css';
import '../styles/legacy-bridge.css';
import { installResolvedTheme } from '../wwl-resolved-theme.js';
import WwlChatWorkbench from '../components/WwlChatWorkbench.vue';

const DemoApp = {
  name: 'AiChatDemo',
  setup() {
    return () =>
      h('div', { class: 'demo-root wwl-chat-demo' }, [
        h('header', { class: 'demo-header' }, [
          h('h1', 'AI Chat (WebGPU)'),
          h('p', [
            'In-browser inference using LiteRT-LM for Gemma 4 (true multi-turn), plus optional WebLLM models.',
            h('br'),
            'Your prompts stay on this device. Models download only when you choose Load.',
          ]),
          h(VdThemeSwitcher, { menu: false }),
        ]),
        h('div', { class: 'demo-chat-wrap' }, [h(WwlChatWorkbench)]),
        h(
          VdCard,
          { class: 'demo-info-section wwl-card-glow vd-glass' },
          {
            default: () => [
              h('h3', 'How it Works'),
              h('h4', 'Browser Caching & Loading Behavior'),
              h(
                'p',
                'Choose a model and click "Load AI Model" when you are ready to download it and use your GPU.',
              ),
              h('p', [h('strong', 'What happens when the page is refreshed?')]),
              h('ul', [
                h('li', [
                  h('strong', 'Browser cache: '),
                  'The browser can retain downloaded weights for later loads. Storage denial, quota limits, or clearing site data may require another download.',
                ]),
                h('li', [
                  h('strong', 'VRAM Initialization: '),
                  'Refreshing releases the active model. Click Load again to initialize it; when cached weights are available, the browser can reuse them.',
                ]),
              ]),
              h('h4', 'Acknowledgments, Technologies & Attribution'),
              h(
                'p',
                'Building a fully private, in-browser AI chat with robust guardrails relies on an incredible ecosystem of open-source tools:',
              ),
              h('h5', 'Core AI & Inference'),
              h('ul', [
                h('li', [
                  h('strong', [
                    h(
                      'a',
                      {
                        href: 'https://developers.google.com/edge/litert-lm/js',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                      },
                      'LiteRT-LM (@litert-lm/core)',
                    ),
                  ]),
                  ': Default Gemma 4 backend — Google AI Edge WebGPU runtime with native multi-turn conversations.',
                ]),
                h('li', [
                  h('strong', [
                    h(
                      'a',
                      {
                        href: 'https://webllm.mlc.ai/',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                      },
                      'WebLLM (@mlc-ai/web-llm)',
                    ),
                  ]),
                  ': Experimental Ministral 3 and Mistral 7B chat models for Chat and Compare. Qwen3 0.6B is not offered.',
                ]),
                h('li', [
                  h('strong', [
                    h(
                      'a',
                      {
                        href: 'https://ai.google.dev/gemma',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                      },
                      'Gemma 4',
                    ),
                  ]),
                  ': Primary local models (E2B / E4B) via official LiteRT-LM web packages.',
                ]),
              ]),
              h('h5', 'UI & Design'),
              h('ul', [
                h('li', [
                  h('strong', [
                    h(
                      'a',
                      {
                        href: 'https://github.com/vanduo-oss/vd3',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                      },
                      '@vanduo-oss/vd3',
                    ),
                  ]),
                  ': Vanduo UI for Vue 3 powering the Labs site shell and chat UI.',
                ]),
                h('li', [
                  h('strong', [
                    h(
                      'a',
                      {
                        href: 'https://phosphoricons.com/',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                      },
                      'Phosphor Icons',
                    ),
                  ]),
                  ': Iconography used throughout.',
                ]),
              ]),
            ],
          },
        ),
        h(
          'footer',
          { class: 'demo-footer' },
          'AI Chat — Experimental Labs Component for Weekend Web Labs',
        ),
      ]);
  },
};

const style = document.createElement('style');
style.textContent = `
  .demo-root {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    color: var(--text-primary);
  }
  .demo-header {
    padding: 0.75rem 1rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.25rem 0.75rem;
    text-align: left;
  }
  .demo-header h1 {
    font-size: 1.1rem;
    font-weight: 700;
    margin-bottom: 0;
    color: var(--color-primary);
  }
  .demo-header p {
    color: var(--text-muted);
    max-width: 65rem;
    margin: 0;
    grid-column: 1;
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .demo-header > :last-child { grid-column: 2; grid-row: 1 / 3; align-self: start; }
  .demo-chat-wrap {
    padding: 0 0.75rem 1rem;
    max-width: min(90vw, 100%);
    width: 90%;
    margin: 0 auto;
  }
  .demo-chat-wrap:has(.wwl-flowchart-column) {
    max-width: min(90vw, 100%);
    width: 90%;
  }
  .demo-info-section {
    max-width: min(70rem, 100%);
    margin: 0 auto 3rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    line-height: 1.6;
  }
  .demo-info-section h3 {
    color: var(--color-primary);
    margin-top: 2rem;
    margin-bottom: 1rem;
    font-size: 1.25rem;
  }
  .demo-info-section h4 {
    color: var(--text-primary);
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    font-size: 1.05rem;
  }
  .demo-info-section p,
  .demo-info-section ul {
    margin-bottom: 1rem;
    color: var(--text-secondary);
  }
  .demo-info-section ul {
    padding-left: 1.5rem;
  }
  .demo-info-section a {
    color: var(--color-primary);
    text-decoration: none;
  }
  .demo-info-section a:hover {
    text-decoration: underline;
  }
  .demo-footer {
    margin-top: auto;
    padding: 2rem 1.5rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-muted);
    border-top: 1px solid var(--border-color);
  }
`;
document.head.appendChild(style);

installResolvedTheme({ storagePrefix: 'wwl-', defaultTheme: 'dark' });

createApp(DemoApp)
  .use(VanduoVue, {
    themeDefaults: {
      PRIMARY_LIGHT: 'green',
      PRIMARY_DARK: 'green',
      NEUTRAL: 'neutral',
      RADIUS: '0.25',
      FONT: 'open-sans',
      THEME: 'dark',
    },
  })
  .mount('#demo-root');
