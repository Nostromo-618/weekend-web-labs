# Private speech validation — 2026-10-01

> Historical initial acceptance snapshot. The fixed model/voice defaults and runtime versions below describe the original feature. See [current chat instructions](./wwl-ai-chat.md), [the latest streaming/conversation validation](./wwl-checked-stream-conversation-validation.md) and [dependency refresh history](./dependency-refresh-2026-10-04.md).

The implementation preserves AiChat's public text API and Labs' production CSP. QA ran on an Apple M4 with 24 GiB RAM. These are local snapshots, not a cross-device performance guarantee.

## Neural playback follow-up — 2026-10-03

After a report of silent neural playback in Chrome with audible system voices, the isolated Chrome session produced non-silent PCM and a running audio graph. The original user's silence was not reproduced and a browser/site mute cannot be detected by the page. The previous completion-only playback test could not establish audible output.

The follow-up primes the Web Audio graph in the user's click, resumes again after inference when needed, bounds resume/stalled-playback waits, rejects silent/invalid PCM, and releases interrupted sources. Voice settings now offer **Test Neural voice**; preparation is displayed separately from started playback. Chromium/WebKit passed 44 checks (28 speech checks and 16 existing Labs regressions), including suspended-context recovery, blocked/interrupted playback, cancellation and the new voice test.

Installed Chrome 154 under the production CSP produced a waveform peak of 0.474 and an analyser peak of 0.469 for the test phrase; the actual PCM source started with a running AudioContext. [Raw neural output](./speech-validation/chrome-neural-2026-10-03.json). These measurements validate non-silent Web Audio, not the operating system's output device, speaker volume or browser tab mute state.

All three installed-Chrome production checks passed: real session audio, speech round-trip with warm/fresh-worker offline inference and no upload requests, and microphone capture/resampling/release. The default chat model was not loaded for this follow-up; the earlier coexistence measurements below remain the reference.

## Coverage

- 30 focused checks passed in Playwright Chromium and WebKit: narration filtering, bounded text/token splitting, missing-local-voice fallback without automatic download, stereo-to-mono mixing and the exact 60-second PCM cap, cache denial/quota handling, owned-cache clearing, hard worker cancellation, late permission/result handling, draft overflow/manual sending, silence, Docs citation processing, playback interruption, download/navigation cancellation, and existing chat lifecycle/IME/layout regressions.
- Installed Chrome 154 ran the actual pinned q8 models with default Gemma E2B loaded. Cold remote downloads, silence, synthesis/transcription, fully offline inference in the loaded page, fresh workers with speech model networking blocked, local executable/WASM requests and the unchanged production CSP passed. All observed requests were GET/HEAD with no upload bodies.
- Installed Safari 27.0.1 and Firefox 157 completed the same real synthesis-to-transcription phrase under production CSP. Both completed neural PCM playback and installed local system-voice playback. Safari captured 45,142 mono frames resampled to 16 kHz (2.821 seconds) and released its microphone. Firefox's Block permission action returned the expected access-denied error.
- Chrome's fake microphone test exercised the actual AudioWorklet/OfflineAudioContext path and confirmed every media track ended. Microphone permission denial and silence preserve typed drafts in the Vue tests.
- Lint has no errors; its 10 pre-existing draw warnings remain. Source formatting and production/QA builds pass.

## Measurements

The test phrase, “Hello world. This is a private speech test.”, produces 3.175 seconds of Kokoro `af_heart` audio. Whisper returns “Hello World, this is a private speech test.”

| Browser/run                                                | Kokoro synthesis / first PCM | Whisper transcription |
| ---------------------------------------------------------- | ---------------------------: | --------------------: |
| Installed Chrome 154, headless, default Gemma loaded       |              about 4.8–4.9 s |           about 1.2 s |
| Installed Chrome 154, native desktop, default Gemma loaded |                      5.084 s |              12.549 s |
| Installed Firefox 157, local mirror                        |                      5.565 s |               1.232 s |
| Installed Safari 27.0.1, local mirror                      |                     12.846 s |               4.319 s |

The final headed Chrome run with Gemma loaded synthesized in 4.702 seconds and transcribed in 1.154 seconds. Cold pinned remote loads took 5.761 seconds for Kokoro and 2.987 seconds for Whisper, including model setup. Warm offline transcription with Gemma still loaded took 1.068 seconds. Fresh workers from Cache Storage took about 0.8 and 0.3 seconds respectively. Total speech downloads are approximately 94 MB and 44 MB including voice/tokenizer data. Models are loaded only after an explicit action. [Raw final Chrome measurements](./speech-validation/chrome-2026-10-01.json).

With Gemma loaded, Chrome's main-thread `usedJSHeapSize` was approximately 718 MB in headless QA and 724 MB in the native desktop run after the speech round-trip. This API excludes speech-worker WASM heaps and GPU allocations; it does not establish total application memory. Safari and Firefox did not expose this metric. Browser focus and concurrent activity were not controlled, and the runs show substantial timing variation.

The adapter prepares one neural chunk ahead. Two cached 3.175-second PCM buffers completed in 6.390 seconds, about 40 ms total wall-clock overhead; callback timestamps showed no additional gap between play calls. This does not measure the acoustic gap. Synthesis is slower than real time in these snapshots, so long neural replies can still pause. Installed system voices are the default. A full device-memory profile and acoustic gap measurement for long replies remain manual QA.

## Runtime fixes validated

Whisper disables ONNX graph optimization because the locked ORT 1.26 development runtime otherwise fails a decoder QDQ/MatMulNBits rewrite. Transformers.js 4.2.0's internal metadata/tokenizer discovery sometimes omits the revision option; each worker also pins its remote path template. Real remote fresh-worker offline tests cover this path and reject `resolve/main` requests.

## Remaining limitations

The bundled Playwright Firefox Nightly cannot launch on this macOS host: its plugin-container sandbox extension fails with `Operation not permitted`; headless launch also reports a framebuffer failure, and headed launch exits before tests run. Actual installed Firefox inference/playback/denial checks passed, but automated Firefox chat lifecycle coverage remains outstanding. No browser security protections were disabled to work around this.

Some repeated headless Chrome Gemma loads failed with the existing LiteRT model-stream network error before speech evaluation started. Earlier headless coexistence runs, the native desktop coexistence run, and the final headed Playwright coexistence/offline/playback/capture run completed. Use `SPEECH_HEADED=1` for coexistence QA on this host. This is reported separately from speech inference.

A full 60-second physical recording and successful Firefox microphone capture were not certified. The actual worklet's frame cap, automatic stop callback, three-second capture/resampling and late-grant cleanup are covered separately. Mobile, hands-free conversation and voice cloning remain outside v1. A cold offline visit is not supported by a service worker; fresh module workers still need the site's local executable/WASM assets.

## Reproduction

```sh
pnpm speech:fetch
pnpm models:fetch -- --model gemma-4-E2B-it-web
pnpm build:qa
SPEECH_HEADED=1 SPEECH_QA_PRODUCTION=1 RUN_SPEECH_REMOTE=1 RUN_SPEECH_CHAT=1 RUN_SPEECH_INFERENCE=1 pnpm exec playwright test -c tests/local/speech.playwright.config.ts
pnpm exec playwright test -c tests/local/speech-ui.playwright.config.ts --project=Chromium --project=WebKit
```

The local inference test writes `speech-measurements.json` under its Playwright output directory. The QA-only speech harness provides explicit model, microphone and playback actions for installed browsers. Normal production builds omit evaluation harnesses and model mirrors.
