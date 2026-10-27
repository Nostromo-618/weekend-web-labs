# Labs dependency and General chat refresh — 2026-10-04

Follow-up: [compatible bulk updates and interaction fixes](./dependency-bulk-update-2026-10-04.md) now update the linked siblings and supersede their audit findings below. This report records the initial Labs-only refresh.

Labs now uses vd3 1.7.5 and offers General chat only. Dictation, read-aloud, Conversation Mode, and model comparison remain available. The public AiChat API and sibling source packages were not changed.

## Dependencies reviewed

Registry metadata and `pnpm outdated --format json` were checked on 2026-10-04. The final outdated result is `{}` for Labs dependencies and devDependencies. Reviewed registry packages are pinned exactly; private sibling packages remain local links.

| Package                       | Before                         | After / assessment                                                              |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| @vanduo-oss/vd3               | 1.7.4                          | **1.7.5**, requested release                                                    |
| @vanduo-oss/vd3-charts        | 1.1.0                          | **1.1.1**                                                                       |
| vue                           | 3.5.42                         | **3.5.43**                                                                      |
| @huggingface/transformers     | 4.2.0                          | **4.3.0**                                                                       |
| onnxruntime-web               | 1.26.0-dev.20260416-b7804b056c | **1.31.0-dev.20260914-8d85527a0**, exact version required by Transformers 4.3.0 |
| @litert-lm/core               | 0.17.1                         | Retained; current stable                                                        |
| @mlc-ai/web-llm               | 0.2.85                         | Retained; current stable                                                        |
| fuse.js                       | 7.5.0                          | Retained current stable; exact pin                                              |
| phonemizer                    | 1.2.1                          | Retained; current stable and adapted Kokoro provenance                          |
| @eslint/js                    | 10.0.1                         | Retained current stable; exact pin                                              |
| @playwright/test              | 1.62.1                         | **1.63.0**                                                                      |
| @vitejs/plugin-vue            | 6.0.8                          | **6.0.9**                                                                       |
| eslint                        | 10.8.1                         | **10.12.0**                                                                     |
| prettier                      | 3.9.6                          | **3.9.9**                                                                       |
| vite                          | 8.2.1                          | **8.3.2**                                                                       |
| vite-plugin-static-copy       | 4.1.1                          | **Removed**; latest release still includes the vulnerable chain                 |
| @wwl/wwl-ai-chat       | Local link, 0.1.1              | Retained local package; audited separately                                      |
| @wwl/wwl-cbun          | Local link, 1.0.0              | Retained local package; audited separately                                      |
| @wwl/wwl-hex-earth     | Local link, 0.1.0              | Retained local package; audited separately                                      |

pnpm was updated within the existing major from 10.28.2 to **10.34.6**. Registry latest is 12.9.1; that separate major migration was not included in this compatible dependency refresh. Stable ONNX Runtime 1.30.0 is not substituted for Transformers' required development build: direct VAD runtime, Transformers runtime and copied WASM must match exactly. Installed versions and byte-identical runtime assets were validated.

## Security findings and changes

Before: Labs audit reported **one high advisory** in `vite-plugin-static-copy → chokidar → braces@3.0.3`. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) describes stack-exhaustion denial of service from deeply nested brace patterns and lists no patched version. This is a Node build-tool dependency path, not browser speech inference.

The plugin was replaced with `utils/static-assets.mjs`, using fixed local file lists and Node filesystem APIs. There is no third-party glob parser in this asset path. Dev asset delivery uses an exact URL/file map; production copies match the served `/litert-wasm/` and `/transformers-wasm/` paths. Matching runtime files, local executable delivery and production CSP were checked.

After: Labs audit reports **zero known advisories** across its 218 audited entries. This is an advisory snapshot, not proof of complete security. Install-script blocking, the 24-hour release delay, trust policy, exotic-source blocking, peer checks and existing vulnerability overrides remain configured. Only the explicitly requested `@vanduo-oss/vd3@1.7.5` was added to the existing workspace release-age exception.

Linked siblings have separate lockfiles and build processes, so a clean Labs audit does not cover all tooling used to create their dist files. Read-only audits found:

| Separate project  | Low | Moderate | High | Findings / follow-up                                                                                                                                          |
| ----------------- | --: | -------: | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| wwl-ai-chat       |   0 |        1 |    2 | TypeScript ESLint parser → minimatch → brace-expansion 5.0.9; update to 5.0.12                                                                                |
| wwl-cbun          |   3 |        7 |    5 | jsdom → undici 7.29.0 (fix ≥7.29.1), stylelint → fast-uri 3.1.7 (fix ≥3.1.8), parser → brace-expansion 5.0.9 (fix 5.0.12), stylelint → unpatched braces 3.0.3 |
| wwl-hex-earth     |   0 |        0 |    0 | No known audit advisories                                                                                                                                     |

Those paths originate in sibling development tools; they are not installed by Labs' local links. They still matter to sibling testing/build trust. Their configurations were examined but not edited in this Labs-scoped change. Full advisory IDs, affected paths and patch ranges are recorded in [the audit snapshot](./dependency-refresh-audit.json).

## Code simplification

Removed the General/Docs selector, Docs semantic controls, retrieval and insufficient-evidence branches, citation processing/list UI, separate mode histories, Docs evaluation scopes/cases, and Docs-specific tests. Compare now owns two General histories; its exports use **schema 2** with `turns: [paneA, paneB]`, without `mode`/`modes` or citations. Report renderers and consumers use this shape. Suspend/reload preserves each pane's independent history.

Labs reports installed injected chat runtime versions rather than older catalog defaults.

## Validation

- **134 focused checks passed** in Playwright Chromium Desktop and WebKit Desktop: General chat lifecycle, IME/HTML escaping, no chat retrieval requests, speech, Conversation Mode, comparison, and model evaluation. Final strengthened history/reload/schema checks passed in both browsers (8 comparison checks; remaining paired evaluation checks passed).
- **5 actual-model checks passed** in installed Chrome 154: three Gemma E2B/Whisper/Silero/Kokoro turns, cached offline operation, non-silent Web Audio playback, silence/noise handling, Whisper round-trip, microphone resampling/release and no recording/transcript uploads. Models used the existing local mirrors; this refresh did not repeat cold remote speech-download measurements.
- Conversation silence-to-submit: **2.30–2.36 s**; silence-to-first-audio: **4.66–8.14 s** over three turns. These are observations on this machine, not cross-device guarantees. Worker WASM and GPU allocations are not included in main-thread heap readings.
- Real LFM2.5 causal chat completed a guarded answer and committed a two-message history using Transformers 4.3.0.
- Production build passed. Runtime files, QA/model exclusion, and script CSP were checked.
- ESLint: zero errors, 10 existing warnings in draw-stencils/draw-tools. Changed code formatted.
- Actual-model Safari/Firefox speech certification was not added by this change.

Review locally: [AI Chat](../demo/ai-chat-demo.html). No commit, push or deployment was made.
