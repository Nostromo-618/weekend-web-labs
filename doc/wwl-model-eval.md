# wwl-model-eval

Local browser inference evaluation, excluded from the production build. It does not publish reports or appear in the live Tools navigation.

## Run locally

```sh
LABS_STABLE_EVAL=1 pnpm dev --host 127.0.0.1 --port 3001
# In another terminal:
MODEL_EVAL_BASE_URL=http://127.0.0.1:3001 pnpm model-eval --cold
```

The default run evaluates E2B, E4B, and the LFM candidates serially in a dedicated Chrome profile at `.models/.refresh-eval-profile`. `--cold` clears only chat-owned caches in that evaluation profile. The runner enables WebGPU for evaluation and does not disable browser web security. `MODEL_EVAL_HEADLESS=1` selects headless mode. Restart the stable server after source edits and before the next run.

Reports are saved to `qa/local-refresh/model-eval/report.json` and `index.html`. They include runtime/model versions, initial load source and duration, browser signals, case timings, and failure excerpts. Browser memory signals are approximate; serial evaluation avoids concurrent large engines.

## Coverage and interpretation

The suite retains branding, honesty, and strict instruction checks, adding arithmetic, benign wording, multi-turn recall, cancellation/recovery, context pressure, native tools where supported, warm reload, and independent retained-model checks. Deterministic package tests exercise adversarial tool schemas, malformed protocols, output bounds, and simulated GPU loss separately.

Strict answer checks deliberately count extra punctuation or different words as failures. Lifecycle checks include actual cancellation and history preservation; recovery and warm replies also have exact-word checks, so a wording failure must be distinguished from a runtime failure. All failed cases remain in the report. A single run is a smoke evaluation, not a statistically stable model-quality estimate.

Real production inference is checked separately with `node utils/production-chat-qa.mjs` against port 4173; `PRODUCTION_CHAT_MODEL` selects a model and `PRODUCTION_CHAT_BROWSER` can isolate a browser. That runner uses installed Chrome and Playwright WebKit without WebGPU override flags.

Phone layout emulation, synthetic IME events, and simulated GPU loss do not replace physical mobile inference, operating-system keyboards, or actual device loss. The review report names unavailable checks.

Paired reports use schema version 2 with a single `turns` array (one list per pane). Chat evaluations cover General only.

`--models` also accepts LFM 2.6B Q4. Qwen3 0.6B is not in the catalog. `MODEL_EVAL_PROFILE` selects a dedicated test profile. `MODEL_EVAL_DISABLE_HTTP_CACHE=1` disables Chrome HTTP caching while retaining app-owned warm-cache checks. `--release-caches` explicitly clears only each tested model's chat-owned caches after its warm checks. Use these options only with authorization to clear test caches. `MODEL_EVAL_STORAGE_QUOTA_BYTES` is a diagnostic CDP quota override and is recorded in the report; it does not certify ordinary device storage behavior.

`firstAnswerMs` retains its legacy JSON name and now measures delivery of the complete checked answer. Compare displays “Checked reply”. Restart `LABS_STABLE_EVAL=1` servers after rebuilding linked packages, because stable mode disables file watching.
