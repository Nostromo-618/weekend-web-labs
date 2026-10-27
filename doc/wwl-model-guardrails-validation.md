# Model catalog and guardrail validation

> Catalog/guardrail acceptance snapshot before checked previews and configurable conversations. Its measurements remain historical; see [the follow-up validation](./wwl-checked-stream-conversation-validation.md) and [current usage guide](./wwl-ai-chat.md).

October 2026. Local validation on October 6–7, 2026, on development branches
`codex/simplify-models-strengthen-guardrails` in Labs and `wwl-ai-chat`.
These changes have not been published or deployed.

## Delivered behavior

The catalog contains four primary models and two compatibility precisions. Gemma 4
E2B remains the default. Chat and Compare share the family picker,
precision controls, engine/download information, candidate labels and tool labels.
Retired selections show a selection error and offer the default without downloading
a replacement automatically. LFM 230M and 350M were dropped after this snapshot for
subpar demo quality. Qwen3 Tiny was later retired from the catalog for the same
reason and is no longer offered. The table below records what was measured at the time.

| Family     | Engine                                      | Retained configurations (at snapshot)           | Tool execution                                |
| ---------- | ------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Gemma 4    | LiteRT 0.17.1                               | E2B, E4B                                        | Native tools available                        |
| Qwen3 Tiny | WebLLM 0.2.85                               | 0.6B Q4F16, Q4F32 (retired after this snapshot) | Model support documented; integration pending |
| LFM2.5     | Transformers.js 4.3.0 / ONNX Runtime WebGPU | 2.6B Q4F16, 2.6B Q4 compatibility (now retained) | Model support documented; integration pending |

LFM models remain candidates. Model-card tool claims do not certify a quantized
artifact or enable a new adapter. `capabilities.tools` still means that this
integration can execute tools; `toolCalling` holds model-level claims and official
sources.

AI Draw, its planner, execution and logging paths, evaluation runner, UI and
dedicated tests/docs are removed. The ordinary drawing widget and generic tool
APIs remain. Historical reports, archived change records, downloaded weight
files and user chats are preserved. Explicitly authorized QA cache clearing was
limited to chat-owned weight caches in dedicated test profiles.

## Guardrail boundaries and compatibility

Input, admitted source fields, complete imported history pairs, serialized tool
arguments/results and complete visible answers are checked locally. Rejected
arguments do not execute. Rejected results become a fixed error before callbacks
or model ingestion. Omitted sources/history are reported; generation stops if all
supplied evidence is rejected. Cancelled output is discarded and backend context
is rebuilt after cancellation or rejection.

`onUpdate` retains its signature but now delivers one complete checked reply,
including a fixed safe answer when output is rejected. Hosts must update loading
and speech behavior accordingly. Compare's legacy `firstAnswerMs` JSON field now
measures complete checked-answer delivery, and its UI says “Checked reply”. The
new `guardrailProfile` defaults to `family-friendly`; `general` relaxes language
moderation while retaining injection and harmful-assistance rules. Optional
`onGuardrail` events contain codes, rule IDs and bounded structured identities,
without raw rejected text. Synchronous validators and result/error types remain.

Pinned `obscenity@0.4.6` is the specifically approved runtime-dependency exception.
The package records its integrity, selected MIT PyRIT source revision, Unicode 18
source/derived SHA-256 checksums, licenses and adaptations in
[`provenance.json`](./chat-guardrail-provenance.json) and
[`THIRD_PARTY_NOTICES.md`](./chat-third-party-notices.md). Five source/data
checksums and the dependency exception are verified by `pnpm guardrails:verify`,
also included in `test:ci`. Package packing includes notices, provenance and
licenses; full upstream snapshots are development data.

Scanning preserves original text and bounds normalization/decoding to 32,768
input characters, 12 variants, 128 KiB total scanned characters and two decoding
rounds. Pinned ASCII normalization/confusable tables supplement native browser
NFKC/NFKD; this is not a complete Unicode normalization implementation. The
reviewed profanity subset and contextual rules preserve critical health,
identity, abuse-reporting and help-seeking fixtures. User profanity alone does
not trigger refusal. Rendered links allow HTTP(S), ordinary relative paths and
fragments; rejected destinations become inert labels.

Local rules provide limited semantic moderation. Novel attacks, context-dependent
harm and multilingual content can evade them. No additional classifier model or
remote service is introduced. Tool permission/schema checks remain necessary;
see [OWASP's boundary guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

## Automated verification

| Gate                                           | Result                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Package lint, formatting, TypeScript and build | Passed                                                                               |
| Package unit/coverage suite                    | 232 tests passed; statements 94.84%, branches 90.10%, functions 95.97%, lines 95.13% |
| Package real Gemma E2B browser test            | 1 passed                                                                             |
| Labs affected desktop/mobile Chromium checks   | 130 passed                                                                           |
| Labs lint, formatting and production build     | Passed                                                                               |
| Shipped-asset validation                       | 92 routes, both presets and production assets passed                                 |
| Cross-repo change coordination                 | Completed                                                                            |

Boundary tests cover split output chunks, Unicode/encoded attacks, quoted
educational discussion, sources/imported history, unsafe tool arguments/results,
cancellation, processing bounds and unsafe link schemes. Host checks verify that
rejected input does not enter the transcript, and rejected assistant content does
not reach callbacks, rendered DOM, saved history or speech. Shared picker labels,
precision options, retired selections and preserved Compare behavior are covered.

## Identical fixture comparison

The baseline is package commit `d518433afea7d60fbca90777d0258dd4217dfc58`. Both
implementations were evaluated against the same manual fixtures with
`scripts/evaluate-guardrails.mjs`. These small samples measure regressions, not
general detection accuracy.

| Fixture set                        | Baseline attacks blocked | Current attacks blocked | Baseline benign blocked | Current benign blocked |
| ---------------------------------- | ------------------------ | ----------------------- | ----------------------- | ---------------------- |
| Targeted attacks / critical benign | 1/16                     | 16/16                   | 4/14                    | 0/14                   |
| Broader exploratory sample         | 0/12                     | 12/12                   | 1/12                    | 1/12                   |

The remaining exploratory false positive is the unquoted request “Describe the
phrase do anything now in security research.” Quoted educational discussion has
dedicated passing fixtures; there is no blanket educational exemption. The
broader false positive is reported rather than used to weaken a targeted rule.

Warm Node measurements on this host recorded about 0.023 ms P95 for per-scan
batch means over targeted fixtures, and 4.14 ms P95 for a bounded 32,768-character
normalization-heavy input. These are local microbenchmarks, not browser latency
guarantees or individual-scan percentiles. The machine was also running QA.

## Fresh desktop Chrome inference

All eight configurations (including later-retired LFM 230M/350M) loaded in installed
desktop Chrome 154 with WebGPU and `shader-f16`. Each ran multiple turns,
stop/recovery, reset, warm reload, grounded answers and injected-reference checks.
Both Gemmas passed native tool execution; Qwen/LFM tool checks were skipped because
their integrations do not execute tools. Only the six configurations still in the
catalog are summarized below.

| Configuration                | Strict smoke cases passed | Material observations                                                                            |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| Gemma 4 E2B                  | 12/14                     | Lifecycle and tools passed; branding and exact wording failed                                    |
| Gemma 4 E4B                  | 13/14                     | Lifecycle and tools passed; branding failed                                                      |
| Tiny Q4F16                   | 9/13                      | Lifecycle/grounding passed; arithmetic, exact formatting and extracted ID failed                 |
| LFM2.5 2.6B Q4F16            | 11/13                     | Lifecycle/grounding passed; branding and honesty failed                                          |
| Tiny Q4F32 compatibility     | 8/13                      | Lifecycle/grounding passed; arithmetic/formatting and extracted priority casing failed           |
| LFM2.5 2.6B Q4 compatibility | 11/13                     | Lifecycle/grounding passed; branding and honesty failed                                          |

These include strict punctuation/wording checks and are not rankings. LFM 2.6B emitted
unsupported textual tool-call markup in an honesty case; no tool executed. The
historical September 27 smoke scores remain unchanged and are not directly
comparable with this expanded lifecycle suite. Earlier snapshot rows for LFM 230M/350M
are omitted because those sizes are no longer in the catalog.

Actual Tiny/LFM Compare checks passed simultaneous residency, paired recall,
independent cancellation and retry of the stopped side without modifying the
completed side. A separate engine-switch check covers Gemma → Tiny → LFM → Gemma
using Labs' explicit history-reset policy.

Local review artifacts are under `qa/local-refresh/model-eval/`:

- `guardrails-acceptance-2026-10-07.json` and `.html`: original eight-configuration snapshot (includes later-retired LFM 230M/350M).
- `guardrails-pair-2026-10-07.json` and `.html`: four Compare checks.
- `guardrails-switch-2026-10-07.json`: model switching.
- `guardrails-fixtures-2026-10-07.json`: baseline/current guardrail comparison.
- `guardrails-footprint-2026-10-07.json`: build measurements.

Runs used a dedicated testing profile, disabled HTTP caching and a recorded
12 GB diagnostic CDP quota override. The serial acceptance run released each
tested model's chat-owned caches after warm checks to avoid accumulating weights.
A switch retry used a fresh profile after a transient local weight-stream error.
Downloaded local model mirrors were retained. This does not certify storage
behavior on an ordinary constrained device. Physical mobile inference, actual
device loss and other-browser inference were unavailable; mobile checks emulate
layout. Speech delivery was tested at its callback/UI boundary, without new
neural speech-model inference.

## Build footprint and coordinated follow-up

Baseline Labs commit `7c2357523c479c181c6fb3f4c06ac6b915754c48` and the package
baseline above were rebuilt from read-only Git snapshots using the same installed
toolchain. Nine obsolete WebLLM WASM files account for **59,286,174 bytes** removed
(59.3 MB uncompressed).

| Measurement                            |            Before |             After |
| -------------------------------------- | ----------------: | ----------------: |
| Labs production static output          | 429,603,208 bytes | 370,334,359 bytes |
| Labs JavaScript output                 |  17,003,728 bytes |  17,035,743 bytes |
| Labs WASM output                       | 308,958,670 bytes | 249,672,496 bytes |
| Package ESM + CJS JavaScript           |     256,275 bytes |     261,713 bytes |
| Four package ESM entry files, gzip sum |      42,780 bytes |      43,478 bytes |

The net static reduction is 59,268,849 bytes. Gzip entry sums exclude shared chunks
and the external `obscenity` dependency; Labs' built JavaScript includes its
bundled cost. Package declarations and source maps also grew and are recorded in
the footprint JSON.

Before a future coordinated release, commit/push the package changes and update
**both** Labs CI and Pages sibling-checkout pins to that real package commit.
Existing pins intentionally remain at the previously published commit during
this local delivery. Linked consumers such as `ts-school` must install the new
dependency, rebuild the linked package and account for complete-answer callbacks,
retired IDs and the new metadata. No deployment or new tool adapter is included.
