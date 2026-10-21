# wwl-ai-chat

On-device browser chat with LiteRT 0.17.1, WebLLM 0.2.86 and Transformers.js 4.3.0 / ONNX Runtime WebGPU. Labs links the local sibling package and uses a WebLLM module worker with local runtime/WASM assets. Prompts are processed locally; explicit model downloads still need a network connection unless available in browser cache or a development mirror.

## Getting started

1. Open **Settings**, choose a model and precision, and review its download size. Selecting a model does not start a download.
2. Use **Load AI Model**, then type and send a message. WebGPU is required; compatibility is checked before loading.
3. Under **Text replies**, choose **Checked live text** or **Full-answer check**.
4. For voice, choose a preset in **Voice settings** and use explicit Load/Test actions, or start **Voice Conversation Mode** to load the selected configuration.

## Models and compatibility

Chat and Compare share six primary choices grouped by family. Gemma 4 E2B remains the default. A separate precision control exposes the LFM compatibility variant; selecting a model never starts a download. Labels include engine, download size, candidate status and tool capability.

| Primary choice           | Engine                        | Role                                                 | Tools                                         |
| ------------------------ | ----------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| Gemma 4 E2B              | LiteRT                        | Default, about 2.0 GB                                | Native execution available                    |
| Gemma 4 E4B              | LiteRT                        | Quality, about 3.0 GB                                | Native execution available                    |
| LFM2.5 2.6B              | Transformers.js → ONNX WebGPU | Reasoning candidate, about 1.55 GB                   | Documented model support; integration pending |
| Ministral 3 3B Instruct  | WebLLM                        | Experimental, about 1.9 GB, 4096-token context       | Documented model support; integration pending |
| Ministral 3 3B Reasoning | WebLLM                        | Experimental reasoning peer beside LFM, about 1.9 GB | Documented model support; integration pending |
| Mistral 7B Instruct v0.3 | WebLLM                        | Experimental, about 4.1 GB, 4096-token context       | Documented model support; integration pending |

LFM 2.6B Q4 remains an explicit precision variant and cannot edit the flowchart. While the Flowchart panel is open, only tool-ready Gemma 4 models (E2B and E4B) are offered in the model picker. Qwen3 0.6B and the Ministral 3 3B ONNX build are not offered. WebLLM choices require shader-f16. Missing WebGPU disables loading; shader-f16 compatibility is checked before load. Retired selections display an explanation and offer the default without silently downloading it. LiteRT, WebLLM and Transformers.js retain worker/runtime isolation. Retired spikes, Gemma MLC peers, Qwen3 Tiny, LFM 230M/350M, q4f32 twins, Mistral Small 4, and Ministral 8B/14B are not offered. Existing downloaded models, chats and historical reports remain intact.

Official model-level tool support is recorded with [Gemma](https://deepmind.google/models/gemma/gemma-4/), [Ministral 3](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512), [Mistral 7B](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3) and Liquid's [2.6B](https://huggingface.co/LiquidAI/LFM2.5-2.6B#tool-use) cards in the catalog. It does not certify our quantized builds. Gemma executes native tools; the three WebLLM Mistral choices and LFM remain integration-pending and are omitted from flowchart-interaction selection.

Device and storage details are expandable. Browser-reported memory is approximate and does not establish GPU capacity. See [model and guardrail validation](./wwl-model-guardrails-validation.md) for measured browser/model limitations; phone layout emulation does not establish physical phone inference support.

## Conversation lifecycle

Stop cancels generation. Reset, model switching, and route exit invalidate late output and release runtime resources. Only one operation may generate at a time. Context budgeting reserves response space, preserves system instructions and recent complete turns, and discloses omitted older context while retaining the visible transcript.

Chat uses one visible transcript and model history.

Chat and Compare default to remembered **Checked live text** under **Text replies**. The delivery gate checks the accumulated visible answer before releasing a cumulative plain-text preview, retaining trailing context and normally releasing at sentence/paragraph boundaries. Long pending text may release at a complete-word boundary. Short replies can finish without a preview. Markdown and validated links activate only after final acceptance.

Earlier checked text can appear before a later policy violation is detected. Rejection clears it and delivers a fixed safe response; text already seen cannot be unseen. Choose **Full-answer check** when the entire answer must be checked before display. [NVIDIA's check-before-release architecture](https://docs.nvidia.com/nemo/guardrails/configure-guardrails/yaml-schema/streaming/output-rail-streaming) is a reference; no NVIDIA runtime or remote moderation service is used.

Previews never enter saved history, exports or speech. `onUpdate` and the returned answer contain final checked content only. Tool-generation loops stay buffered. Voice Conversation Mode always checks the complete answer before transcript display and speech, regardless of the text setting. Cancellation/error clears previews and commits no partial answer. Rejection or cancellation invalidates contaminated backend context. Markdown escapes HTML; links allow HTTP(S), ordinary relative paths and fragments. Rejected destinations are inert. Local rules reduce specific risks without guaranteeing that a model follows every instruction.

## Compare

Choose a model and precision for each side to compare the same prompt. Each side retains independent stop/retry behavior; retrying a stopped side preserves the completed side. Both use the remembered text delivery preference. **First checked text** measures the first preview; **Checked reply** measures complete checked-answer delivery (`firstAnswerMs` in exports). A short or fully buffered answer may have no first-preview timing. Exports contain final replies only.

## Private dictation and read-aloud

### Chat workspace

Messages and the composer fill the available viewport below navigation. Settings opens a 320px right panel at workspace widths of at least 960px; it is initially open and collapses to give messages more width. Narrower workspaces use a right-hand drawer with Escape/backdrop dismissal and keyboard focus return. Model, Text replies, Voice and Storage controls scroll separately from messages. Model details and Voice settings start expanded; you can collapse either section. Opening settings never downloads models or starts capture. Documentation remains below the workspace.

Voice Conversation Mode, Pause/Resume, End, New conversation and Settings remain in the compact chat header. Dictation stays beside the composer; Read aloud/Stop stays on each completed answer. A dedicated status line below the composer and Send/Record controls shows listening, transcribing, thinking and audio preparation/playback. It stays outside the scrolling transcript, remains visible with Settings closed and reserves its space while idle. Context notices and errors also stay beside the composer. Paused voice review remains separate from the saved typed draft.

Closing Settings or resizing does not restart engines, cancel audio or reset voice selection. Settings visibility is temporary UI state; model, delivery and voice preferences are remembered locally. The composer can use page scrolling in very short windows or when a keyboard leaves less than the workspace's minimum height.

See the historical [workspace validation](./wwl-chat-workspace-validation.md) for original layout checks and the [latest feature validation](./wwl-checked-stream-conversation-validation.md) for current desktop/mobile controls. Screenshots named in reports are local QA artifacts, not published downloads.

Labs adds speech controls without changing AiChat's text API. Enable dictation explicitly downloads the pinned Whisper Tiny English model and tokenizer (about 44 MB); Record message requests the microphone, and Stop recording transcribes locally into the current editable draft. Recording stops after 60 seconds. Nothing is sent automatically, and drafts over 2,000 characters stay intact with Send disabled until edited.

Read aloud is available on completed Chat replies. It reads the final displayed prose after guardrails, omitting code blocks, citation markers and raw URLs. Manual read-aloud and Voice Conversation Mode share a locally remembered provider and voice. The initial default is Kokoro Heart (`af_heart`). The picker offers **28 named English Kokoro presets**, grouped by American/British English, plus installed English system voices marked `localService: true`. Unnamed presets, other languages and remote system voices are excluded. Selecting or restoring preferences starts neither downloads nor microphone capture.

Explicit Load/Test or Conversation Start/Resume actions may fetch required assets. Kokoro's shared model with the initial style is about 94 MB. Successful voice switches reuse that model and load only the selected 522,240-byte style. Identity, accent, phonemization language, size and SHA-256 are recorded in the [pinned voice catalog](./kokoro-english-voices.json). American/British presets use matching phonemization. Both neural speech engines use single-threaded CPU/WASM; they do not change chat's WebGPU requirements. Neural playback prepares at most one sentence ahead, but slower devices may still have gaps.

Neural read-aloud shows “Preparing neural audio” until a PCM source starts. After loading Kokoro, use **Test Neural voice** in Voice settings to check playback independently of chat. If that test finishes silently, check the browser tab's mute state and the site's Sound setting; the page cannot detect a browser-level mute. Suspended, interrupted or stalled Web Audio and invalid/silent model output now produce actionable errors. Stop also cancels an outstanding audio-resume wait.

Recordings remain in memory and are discarded after transcription or cancellation. The application sends neither recordings nor transcripts to inference services and never falls back to browser SpeechRecognition. Sending or recording stops playback; reset, model/mode changes, suspension and navigation invalidate pending results and release workers and audio resources. Speech failure leaves text chat available. Cache denial/quota errors are best effort and may require another download. Clear storage includes the dedicated `wwl-speech-whisper-v1` and `wwl-speech-kokoro-v1` caches.

Pinned model revisions, adapted Kokoro source, package provenance and license attribution are in [source provenance](./speech-source-provenance.md) and [speech notices](./wwl-chat-speech-notices.md). Models load only after explicit actions. Executable code and matching WASM stay bundled locally under the existing CSP.

For local evaluation:

```sh
pnpm speech:fetch
RUN_SPEECH_INFERENCE=1 pnpm exec playwright test -c tests/local/speech.playwright.config.ts
pnpm exec vite build --mode qa
SPEECH_QA_PRODUCTION=1 RUN_SPEECH_INFERENCE=1 pnpm exec playwright test -c tests/local/speech.playwright.config.ts
```

The QA-only `/demo/speech-eval-harness.html` measures synthesis, transcription, cache reuse, capture and optional coexistence with default Gemma. `RUN_SPEECH_CHAT=1` enables the coexistence test. Development and QA preview can serve ignored `.models/` mirrors; ordinary production builds exclude the harness and mirrors. Warm inference works with network disabled in an already loaded page; new workers still need local executable assets, and cold offline site visits remain outside this change. See [speech validation](./wwl-chat-speech-validation.md) for measurements and outstanding browser QA.

## Host API

```js
import { AiChat } from '@wwl/wwl-ai-chat';
import { chatRuntimeOptions } from './src/lib/chat-runtime.js';

const chat = new AiChat({ ...chatRuntimeOptions });
await chat.load();
const controller = new AbortController();
const reply = await chat.generate('Hello', {
  signal: controller.signal,
  maxOutputTokens: 512,
  delivery: 'checked-stream', // omit or use 'complete' for full-answer checking
  onPreview: (text) => {
    previewElement.textContent = text;
  }, // cumulative; '' clears
  onUpdate: (text) => {
    previewElement.textContent = '';
    console.log(text);
  },
});
await chat.dispose();
```

The package default remains `complete`; Labs opts into checked previews according to the remembered preference. Render previews as escaped plain text, and never persist, export or speak them. Existing callback signatures remain supported; `onUpdate` and the returned reply carry final checked content only. Optional structured `onGuardrail` events omit raw rejected content. The workspace package README documents typed options, source context, token accounting and JSON Schema support.

Native LiteRT tools are allowlisted and validated before execution. Rounds, calls, execution time, and result size are bounded; native calls receive native tool-response messages. An explicit `toolProtocol: 'xml'` host option remains available in `AiChat` for custom XML tool loops, while the WebLLM Mistral and LFM catalog choices remain integration-pending and are omitted from flowchart-interaction selection when the Flowchart panel is open. Tool handlers receive an AbortSignal and should cooperate with cancellation. Arguments are checked before execution and results before model ingestion or callbacks; rejected results become fixed errors. A rejected `set_flowchart_document` call leaves the canvas unchanged. The flowchart JSON is quoted data on every turn. A local screenshot is attached only when the loaded model declares vision; none of the current catalog models do.

## Local development and storage

```sh
pnpm models:fetch
pnpm models:fetch -- --model gemma-4-E4B-it-web
pnpm dev
```

Development probes `/models/<id>/…` for mirrors in ignored `.models/`; an HTML SPA fallback is rejected. Mirrors and evaluation artifacts are excluded from the production build. LiteRT weights use `wwl-litert-models`; Transformers.js chat weights use `wwl-chat-onnx-v1`; WebLLM owns its model caches. Clear storage targets chat-owned records only. Caching is best effort and may fail when the browser denies storage or exceeds its quota. Warm offline inference was verified with an already loaded page and model; a cold offline site visit is not provided by a service worker.

The production build serves bundled JavaScript, LiteRT WASM, and ONNX WASM locally. Model weights remain explicit downloads. Its script policy permits WebAssembly compilation without general JavaScript `unsafe-eval`.

## Guardrail policy and attribution

The default is English-first, family-friendly output. User profanity alone does not refuse a request. Reviewed profanity/slur data and contextual rules preserve health, identity, abuse reporting and help-seeking discussions. Inputs, admitted reference material, imported history, tool arguments and tool results are scanned. Rejected references/history are reported; all supplied evidence being rejected stops generation.

Local TypeScript uses selected adapted [Microsoft PyRIT](https://github.com/microsoft/PyRIT) rules, pinned Unicode confusables and `obscenity@0.4.6`. The [third-party notices](./chat-third-party-notices.md) and [provenance manifest](./chat-guardrail-provenance.json) record versions, licenses, checksums and adaptations. Earlier LlmGuard, ai-guardian and llm-prompt-guard links were research references, not installed dependencies or a maintenance guarantee.

Bounded normalization/decoding scan variants preserve original text. These rules provide limited semantic moderation and may miss new attacks or misunderstand context. No additional classifier or remote service is used. [OWASP boundary guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) informs source/tool boundaries. Keep tool permissions minimal.

See [model and guardrail validation](./wwl-model-guardrails-validation.md) for catalog/security acceptance, [guardrail API documentation](./wwl-guardrails.md) for boundaries and [latest feature validation](./wwl-checked-stream-conversation-validation.md) for checked streaming and customizable conversations. Inference uses Google LiteRT, MLC WebLLM, Hugging Face Transformers.js and ONNX Runtime. Labs UI uses Vanduo VD3 and Phosphor icons.

## Voice Conversation Mode

**Voice Conversation Mode** uses your selected model, precision and shared voice preference. E2B/Heart remain the initial defaults. Start/Resume explicitly authorizes any missing assets: all conversations need the chat model, Whisper and the small Silero detector; neural conversations additionally need Kokoro and the selected preset. Local system-voice conversations do not require Kokoro. Download information and progress follow the selected configuration. GPU checks run first, and the browser may request microphone permission. Completed history continues and the typed draft stays separate. Settings are snapshotted for each active run; changing selectors while paused does not download assets.

Speak, then pause for about 1.2 seconds. A valid turn is transcribed and automatically submitted. The model receives concise spoken-answer instructions with a 192-token output allowance, or 1,024 tokens for models marked as requiring reasoning, within existing context limits. The complete answer is checked before display and speech. The selected voice plays the displayed prose; a spinner beside the reply identifies audio preparation and playback. Neural synthesis now prepares one bounded sentence first and looks ahead by only one sentence while it plays. Listening reopens 400 ms after playback. The microphone tracks are stopped throughout transcription, generation and playback, so spoken interruption is unavailable.

**Pause conversation** cancels and settles generation, recording and playback before unlocking model and voice settings. **Resume conversation** applies the new choices and starts a fresh listening turn without resending the previous message. Completed history and the separate typed draft are preserved. Missing system voices, unavailable models or uncached offline presets pause with an actionable message; no alternative or remote fallback is chosen. Idle models stay loaded; an interrupted inference worker may need cached reinitialization. **End conversation** restores normal instructions and manual controls. Hiding/freezing the page pauses the loop and requires explicit Resume; reset, workbench changes and navigation end it. Errors pause with available text retained.

Silence, brief detector misfires and empty transcripts do not send. A 60-second recording cap, oversized input or validation rejection pauses with a separate editable voice message. **Send reviewed voice message** explicitly submits that edited message and restarts the loop. Your typed draft is never combined with it or silently truncated. Model/voice settings are locked during an active run and editable after Pause settles. The typed composer and manual speech actions remain unavailable until End restores normal controls.

The internal `ConversationSession` owns cancellation epochs and loop media; the parent owns a shared `SpeechSession`/runtime for manual and automatic speech. A persistent context is unlocked in the initial gesture. Its PCM adapter can stop one playback independently of context disposal. Continuous mono resampling produces ordered 512-sample 16 kHz frames, with 0.5/0.35 VAD thresholds, 300 ms pre-roll and at least 250 ms detected speech. Detector state resets each turn. Queue, recording and audio look-ahead are bounded; raw audio stays in memory only. Clear storage also removes `wwl-speech-vad-v1`.

Actual-model acceptance uses a QA-only synthetic microphone graph, the production CSP and installed Chrome:

```sh
pnpm speech:fetch vad
pnpm build:qa
SPEECH_HEADED=1 SPEECH_QA_PRODUCTION=1 RUN_CONVERSATION_INFERENCE=1 \
  pnpm exec playwright test -c tests/local/speech.playwright.config.ts conversation-inference.spec.ts
pnpm exec playwright test -c tests/local/speech-ui.playwright.config.ts --project=Chromium --project=WebKit
```

See [latest feature validation](./wwl-checked-stream-conversation-validation.md) for current model/voice timings and limits, and [initial conversation validation](./wwl-chat-conversation-validation.md) for the earlier fixed-model snapshot. English foreground desktop operation is the scope; physical room acoustics, mobile, background listening, barge-in and voice commands are not certified.

Voice identity is optional in speech APIs and defaults to Heart: use `session.load('kokoro', { voiceId: 'bf_emma' })` and `session.speak(text, { provider: 'neural', voiceId: 'bf_emma' })`. The worker validates the pinned catalog before synthesis.
