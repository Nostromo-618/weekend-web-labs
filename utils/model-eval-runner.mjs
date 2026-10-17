#!/usr/bin/env node
/**
 * Headed Chromium runner for wwl-model-eval.
 *
 * Usage:
 *   pnpm model-eval
 *   pnpm model-eval -- --models gemma-4-E2B-it-web,gemma-4-E4B-it-web,LFM2.5-2.6B-q4f16-ONNX
 *   MODEL_EVAL_BASE_URL=http://localhost:3000 pnpm model-eval
 *
 * Expects Vite (`pnpm dev`) serving the repo, or set MODEL_EVAL_BASE_URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { BASELINE_MODEL_IDS, NEW_MODEL_IDS } from '@wwl/wwl-ai-chat';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'qa/local-refresh/model-eval');
const PROFILE = path.resolve(
  process.env.MODEL_EVAL_PROFILE || path.join(ROOT, '.models/.refresh-eval-profile'),
);

const args = process.argv.slice(2);
const modelsIdx = args.indexOf('--models');
const models =
  modelsIdx >= 0
    ? args[modelsIdx + 1]
    : process.env.MODEL_EVAL_MODELS || [...BASELINE_MODEL_IDS, ...NEW_MODEL_IDS].join(',');

const base = (process.env.MODEL_EVAL_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const timeoutMs = Number(process.env.MODEL_EVAL_TIMEOUT_MS || 45 * 60 * 1000);
const warmRepetitions = Number(process.env.MODEL_EVAL_WARM_REPETITIONS ?? 3);
if (!Number.isInteger(warmRepetitions) || warmRepetitions < 0 || warmRepetitions > 20)
  throw new Error('MODEL_EVAL_WARM_REPETITIONS must be an integer from 0 to 20.');
const isPair = args.includes('--pair');
const reportName = process.env.MODEL_EVAL_REPORT_NAME || (isPair ? 'pair-report' : 'report');
if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(reportName))
  throw new Error('Invalid MODEL_EVAL_REPORT_NAME.');
const url = `${base}/demo/model-eval-harness.html?autorun=1&models=${encodeURIComponent(models)}&warm=${warmRepetitions}${args.includes('--cold') ? '&cold=1' : ''}${isPair ? '&pair=1' : ''}${args.includes('--release-caches') ? '&releaseCaches=1' : ''}`;
const reportPath = path.join(OUT_DIR, `${reportName}.json`);
const htmlPath = path.join(OUT_DIR, reportName === 'report' ? 'index.html' : `${reportName}.html`);

fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('[model-eval] opening', url);

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: process.env.MODEL_EVAL_HEADLESS === '1',
  channel: process.env.MODEL_EVAL_CHANNEL || 'chrome',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  viewport: { width: 1200, height: 900 },
});

const page = context.pages()[0] || (await context.newPage());
if (process.env.MODEL_EVAL_DISABLE_HTTP_CACHE === '1') {
  await (
    await context.newCDPSession(page)
  ).send('Network.setCacheDisabled', { cacheDisabled: true });
}
if (process.env.MODEL_EVAL_STORAGE_QUOTA_BYTES) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', {
    origin: new URL(base).origin,
    quotaSize: Number(process.env.MODEL_EVAL_STORAGE_QUOTA_BYTES),
  });
}
let lastWeightProgressAt = 0;
let lastWeightProgressText = '';
page.on('console', (msg) => {
  const text = msg.text();
  const checkpointPrefix = '[WWL_EVAL_CHECKPOINT]';
  if (text.startsWith(checkpointPrefix)) {
    try {
      const report = JSON.parse(text.slice(checkpointPrefix.length));
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(
        `[model-eval] checkpoint saved (${report.models?.length || 0} models${report.kind === 'paired-chat' ? ', paired' : ''})`,
      );
    } catch (error) {
      console.error('[model-eval] ignored invalid checkpoint:', error.message);
    }
    return;
  }
  if (/Fetching model weights|Reading(?: local| cached)? model weights/i.test(text)) {
    const now = Date.now();
    if (text === lastWeightProgressText && now - lastWeightProgressAt < 5000) return;
    lastWeightProgressAt = now;
    lastWeightProgressText = text;
  }
  if (
    /(?:^|: )(?:tokenizer\.json|tokenizer_config\.json|vocab\.json|merges\.txt|progress_total)$/i.test(
      text,
    ) ||
    /(?:params_shard_\d+\.bin|onnx\/model_[^ ]+|tensor-cache\.json|ndarray-cache\.json)/i.test(text)
  )
    return;
  console.log(`[browser:${msg.type()}]`, text);
});
page.on('response', (response) => {
  if (response.status() >= 400) console.log(`[http:${response.status()}]`, response.url());
});
page.on('requestfailed', (request) => {
  const reason = request.failure()?.errorText || 'unknown';
  if (reason !== 'net::ERR_ABORTED') console.log(`[request-failed]`, request.url(), reason);
});

let payload;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__WWL_MODEL_EVAL_DONE__ === true, null, {
    timeout: timeoutMs,
  });
  payload = await page.evaluate(() => ({
    report: window.__WWL_MODEL_EVAL_REPORT__ || null,
    html: window.__WWL_MODEL_EVAL_HTML__ || '',
    error: window.__WWL_MODEL_EVAL_ERROR__ || null,
  }));
  if (payload.report)
    payload.report.executionStorage = {
      releaseCachesAfterModel: args.includes('--release-caches'),
      httpCacheDisabled: process.env.MODEL_EVAL_DISABLE_HTTP_CACHE === '1',
      quotaOverrideBytes: process.env.MODEL_EVAL_STORAGE_QUOTA_BYTES
        ? Number(process.env.MODEL_EVAL_STORAGE_QUOTA_BYTES)
        : null,
    };
} finally {
  await context.close();
}

if (payload.error || !payload.report) {
  console.error('[model-eval] failed:', payload.error || 'missing report');
  process.exitCode = 1;
  process.exit();
}

fs.writeFileSync(reportPath, `${JSON.stringify(payload.report, null, 2)}\n`);
fs.writeFileSync(htmlPath, payload.html || '<!DOCTYPE html><title>empty</title>');

console.log('[model-eval] wrote', path.relative(ROOT, reportPath));
console.log('[model-eval] wrote', path.relative(ROOT, htmlPath));

const rates = payload.report.summary?.passRates || {};
for (const [id, rate] of Object.entries(rates)) {
  console.log(`  ${id}: ${rate == null ? 'n/a' : `${Math.round(rate * 100)}%`}`);
}
