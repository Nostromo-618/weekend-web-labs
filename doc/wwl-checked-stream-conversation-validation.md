# Checked streaming and Conversation settings validation — 2026-10-07

Local development branches in Labs and wwl-ai-chat: `codex/checked-stream-conversation-settings`.
No deployment or runtime/model upgrades. [Machine-readable measurements](checked-stream-validation.json).
Raw local answers, WAV samples, screenshots and footprint records remain in `qa/checked-stream/` (ignored local evidence).

## Delivery boundary

The package defaults to complete-answer checking. Labs text Chat/Compare explicitly
use remembered checked previews, with a selectable full-answer mode. The gate checks
all accumulated visible text before release, at most once per 100 ms, holds 64 trailing
characters, and releases sentence/paragraph boundaries or a word boundary after 512
pending characters. Thought/tool channels are withheld. Final callbacks, returned
answers, history, exports and speech contain only complete checked content.

[NVIDIA's check-before-release streaming architecture](https://docs.nvidia.com/nemo/guardrails/configure-guardrails/yaml-schema/streaming/output-rail-streaming)
is the design reference; its runtime and moderation models are not used. Earlier
checked previews can have appeared before a late rejection. Withdrawing them does
not undo exposure. Complete mode retains the stronger boundary. Both use limited
local deterministic semantic moderation.

## Automated gates

- Package: **243 passing tests**, coverage 95.08% statements / 90.42% branches /
  96.09% functions / 95.36% lines; lint, formatting, types, build, pinned-rule checksum
  verification and the actual Gemma E2B integration test pass.
- Labs: **200 passing affected Chromium desktop/mobile checks** covering Chat,
  Compare, speech, conversation, catalog, workspace and new settings/preview flows.
  Lint, formatting, build and production-asset validation pass (92 shipped routes).
- Split output attacks, Unicode/encoding normalization, withheld thought/tool markers,
  revised prefixes, late policy rejection, engine errors and cancellation are covered.
  Checked text stays separate from final callbacks and history across all three adapters.
  Benign health, identity, educational and ordinary prose remains accepted.
- Previews are escaped plain text; Markdown/safe links and read-aloud activate only
  after acceptance. Compare keeps preview timing separate and excludes text from exports.
  Independent stop/retry remains covered. Reset and Stop clear visible previews.
- Paused model/voice edits preserve completed turns and typed drafts; settings are
  locked until cancelled work settles. Speech stays complete-only. System provider
  omits Kokoro loading. Manual system playback requires the explicitly selected local voice. Corrupt styles fail checksums; unavailable offline styles
  report an actionable error without substitutions. Selection/restoration starts no
  downloads or microphone capture.
- Production desktop (1440 px) and mobile (390 px) settings/Compare checks found no
  model/style downloads, CSP violations or horizontal overflow. Delivery preferences
  stay shared when moving between Chat/Compare. Visual inspection found transformed
  cards clipping the narrow drawer; it now teleports to the page body. Focus/close
  and the full affected browser suite pass after this fix.

## Fresh Chrome text inference

Installed Chrome **154.0.8037.98**, macOS, WebGPU. Dedicated QA profile,
local pinned model mirrors; browser HTTP cache disabled. The four primary models and
both compatibility variants released previews before completion and delivered one
final callback. Same long friendly-story prompt, 768 output tokens (1536 for required
reasoning). These differing output lengths and shared machine conditions do not
establish a model ranking. Earlier LFM 230M/350M timings from this run are omitted
because those sizes are no longer in the catalog.

| Configuration | First checked preview | Complete checked reply | Previews |
| --- | --- | --- | --- |
| gemma-4-E2B-it-web | 1.30 s | 14.33 s | 26 |
| gemma-4-E4B-it-web | 3.65 s | 30.26 s | 30 |
| Qwen3-0.6B-q4f16_1-MLC | 0.78 s | 5.26 s | 18 |
| Qwen3-0.6B-q4f32_1-MLC | 1.01 s | 5.85 s | 18 |
| LFM2.5-2.6B-q4f16-ONNX | 4.44 s | 31.83 s | 46 |
| LFM2.5-2.6B-q4-ONNX | 5.35 s | 21.50 s | 29 |

A warmed 50-sample full-prefix gate measurement after 10 warmups measured median
**0.2 / 0.8 / 3.2 / 6.3 ms** at 1,000 / 4,000 / 16,000 / 32,000 characters;
p95 **0.4 / 0.9 / 3.4 / 6.7 ms**. This covers rule scanning and boundary selection,
not model inference, worker transport or rendering. Bounded hostile cases are
regression-tested; these benign timing samples are not a worst-case bound.

## Spoken pipeline and voice catalog

All **four primary models** (plus the two compatibility variants) completed a spoken
turn using real Kokoro input speech into a synthetic 48 kHz MediaStream, actual
worklet/resampler, Silero VAD, Whisper, model inference and checked Kokoro/Web Audio
playback. No preview callback fired. Output allowances were 192 tokens, or 1024 for
LFM 2.6B. Every playback began with microphone tracks stopped; all tracks were ended
after End. No load retry was needed. Silence-to-first-audio ranged from about 12.1 to
25.8 seconds. This is synthetic pipeline acceptance, not certification of physical
microphone acoustics or speaker volume.

All **28 named English presets** produced finite, non-silent PCM. Shared model load
was about 0.83 seconds from local assets; subsequent selected-style
loads were 2.9–6.4 ms in this run. Four representative presets
(Heart, Michael, Emma, George) completed real playback; WAV samples are saved locally.
The installed local **Samantha** system voice also completed playback. A fresh worker
loaded Emma and synthesized with all model/style networking blocked. The isolated
cache corruption test rejected incorrect bytes, the uncached offline test paused
with an online-load instruction, and restored bytes synthesized successfully.
Style identity, accent, byte size, SHA-256 and attribution are pinned in the catalog/
provenance docs; American/British presets use matching phonemization.

Subjective listening quality and physical volume were not assessed by a human.
Automated evidence establishes finite audio, successful actual playback and cache
behavior. Browser permissions, cancellation during loading/playback, missing local
voices and storage failures are covered deterministically. Internet cold downloads,
Firefox/Safari actual inference and physical mobile/noisy-room tests remain unverified.
The small LFM models gave longer replies than requested and some weak factual
explanations; all candidate labels remain unchanged.

## Bundle and compatibility

No new runtime dependencies, classifier or remote service. Compared with the saved
pre-feature production build, bundled Labs JavaScript grows about **19.8 KB** and
package JavaScript about **5.1 KB**; combined compressed ESM entrypoints grow about
**879 bytes**. Runtime WASM assets remain unchanged. Final static totals, including
validation docs, are recorded in `qa/checked-stream/footprint.json`. Downloaded voice
and model mirrors are excluded; voice weights are fetched only by explicit actions.

Public generation options add `delivery` and optional `onPreview`. Existing synchronous
validators, result/error types, generic tool APIs and final callback signatures stay
compatible. Speech APIs add optional voice identity with Heart as the default. Local
consumers must render previews separately and keep speech behind final acceptance.
Change records and API notes are coordinated in both repositories.
