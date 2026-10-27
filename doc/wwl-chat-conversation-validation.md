# Conversation Mode validation — 2026-10-03

> Historical initial acceptance snapshot. The fixed model/voice defaults and runtime versions below describe the original feature. See [current chat instructions](./wwl-ai-chat.md), [the latest streaming/conversation validation](./wwl-checked-stream-conversation-validation.md) and [dependency refresh history](./dependency-refresh-2026-10-04.md).

Implemented on `codex/chat-conversation-mode` (change `chat-conversation-mode`).

## Actual models in Chrome

Installed Chrome 154 on macOS ran three consecutive automatic turns using actual Gemma E2B, Whisper Tiny English, Silero v5.1 and Kokoro Heart. A synthetic microphone enters a real 48 kHz MediaStream/Web Audio worklet and continuous resampler; the detector and all inference engines are real. This establishes pipeline behavior, not physical room/microphone acoustics.

The first turn asked Gemma to remember blue; the next asked for the favorite color and correctly retained that history. The third requested a short goodbye. Four microphone streams were opened across three turns, with zero live tracks during transcription, generation and playback, and zero after End. Capture reopened after the 400 ms settling period. No assistant audio entered an active microphone stream. PCM peaks were 0.50–0.85, and the actual output analyser reached 0.85. The page cannot certify physical speaker volume or browser mute settings.

| Turn          | Silence to automatic submission | Silence to first audio |
| ------------- | ------------------------------: | ---------------------: |
| Remember blue |                          2.31 s |                 7.36 s |
| Recall blue   |                          2.24 s |                 7.74 s |
| Goodbye       |                          2.24 s |                 4.49 s |

These include the ~1.2 s VAD endpoint; the silence timestamp is estimated from processed VAD frames. After endpointing, transcription took about one second. First audio for the same first response was 11.06 s before the one-sentence preparation change. This is one machine/run comparison, not a universal performance guarantee. CPU neural synthesis can still cause gaps when look-ahead is slower than playback; the visible spinner identifies preparation between sentences.

All engines initialized in 4.96 s from existing local model mirrors in a fresh browser context. This is not an Internet download measurement. A separate cold retry encountered the existing LiteRT 2 GB model stream/network error while browser regressions ran concurrently; the mode paused, stopped the microphone, and retained the error. An isolated rerun passed without retry. Internet cold download and broad hardware performance remain unmeasured.

The second and third turns completed with the browser network disabled. After Pause, model weight URLs were blocked and Resume reloaded cached VAD weights, returned to listening, and did not resend. Executable JS/WASM requests stayed local; request monitoring found no upload bodies or non-GET/HEAD requests. The build's existing CSP produced zero violations. A cold offline site visit is still outside scope.

Main-thread heap observations after the three turns were approximately 723 MB, 28 MB and 29 MB as the initial model download buffer was collected. These exclude worker WASM and GPU memory and are not full process memory certification. Buffer caps are explicit: 60 seconds of mono PCM, 64 queued VAD frames, bounded resampler history, one sentence of audio look-ahead, and 20 diagnostic timing entries. A 50-turn controller test verifies one reused playback context and bounded timing history; intentional visible chat history can continue growing.

Raw evidence: [Chrome conversation report](./speech-validation/chrome-conversation-2026-10-03.json).

An additional actual Silero worker check produced peak probabilities of 0.012 for silence, 0.051 for synthetic white noise and 0.99998 for speech. Silence/noise submitted no utterance, speech submitted exactly one, and a fresh detector worker reloaded cached weights with all weight URLs blocked. [Raw detector report](./speech-validation/chrome-vad-2026-10-03.json).

## Deterministic browser coverage

Chromium and WebKit checks cover endpoint pauses around 1.2 seconds, short misfires, silence, pre-roll, duration cap, continuous anti-aliased resampling, ordered detector frames, microphone revocation cleanup, permission denial, empty/oversized/blocked transcripts, draft/history preservation, cancellation in every phase, late permission completion, generation/audio failures, page suspension, End instruction restoration, storage failure and resource reuse. Manual speech and existing General/Docs chat lifecycle regressions remain covered. Neural output, offline reload and real microphone resampling also pass installed Chrome checks.

Firefox's existing capability checks are retained. Automated Firefox is blocked by this host's Playwright sandbox issue noted in the speech report; no protections were disabled. Conversation Mode is not certified in Firefox/Safari with actual Gemma, physical noisy rooms, mobile or background operation. No spoken interruption, voice commands or cloning are included.

## Checks

- Focused Chromium/WebKit coverage: 94 distinct speech, controller and chat lifecycle checks. All 50 controller checks were rerun after the final permission-cancellation fix.
- Actual installed Chrome: three consecutive automatic turns, cached offline operation, microphone reopening, non-silent output, model-blocked Resume; actual Silero silence/noise/speech and offline reload; manual neural playback, Whisper/Kokoro round-trip and microphone resampling.
- Production build, ESLint (zero errors; ten existing unrelated warnings), and Prettier.
- Production excludes QA harnesses and local mirrors; executable/WASM stay local and the CSP directives remain unchanged.
