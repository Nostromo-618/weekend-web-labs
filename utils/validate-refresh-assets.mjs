/** Validate production runtime assets and page CSP. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (p) => fs.readFile(p);
const json = async (p) => JSON.parse(await read(p));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const labsPkg = await json('package.json');
const litertRoot = path.dirname(require.resolve('@litert-lm/core/package.json'));
assert.equal(
  (await json(path.join(litertRoot, 'package.json'))).version,
  labsPkg.dependencies['@litert-lm/core'],
);
const runtimeFiles = await fs.readdir(path.join(litertRoot, 'wasm'));
for (const file of runtimeFiles)
  assert.deepEqual(
    await read(`dist/litert-wasm/${file}`),
    await read(path.join(litertRoot, 'wasm', file)),
  );
// Direct VAD runtime, Transformers runtime and shipped WASM must be one exact version.
const transformersPackage = require.resolve('@huggingface/transformers');
const transformersRoot = path.resolve(path.dirname(transformersPackage), '..');
const transformersRequire = createRequire(path.join(transformersRoot, 'package.json'));
const ortRoot = path.resolve(path.dirname(transformersRequire.resolve('onnxruntime-web')), '..');
const ortVersion = (await json(path.join(ortRoot, 'package.json'))).version;
assert.equal((await json('node_modules/onnxruntime-web/package.json')).version, ortVersion);
assert.equal(
  (await json(path.join(transformersRoot, 'package.json'))).dependencies['onnxruntime-web'],
  ortVersion,
);
for (const name of (await fs.readdir(path.join(ortRoot, 'dist'))).filter((name) =>
  name.startsWith('ort-wasm'),
)) {
  assert.deepEqual(
    await read(`dist/transformers-wasm/${name}`),
    await read(path.join(ortRoot, 'dist', name)),
  );
}
const wasmManifest = await json('public/webllm-wasm/manifest.json');
assert.equal(wasmManifest.webllm, '0.2.86');
assert.equal((await json('node_modules/@mlc-ai/web-llm/package.json')).version, '0.2.86');
for (const asset of wasmManifest.assets) {
  const bytes = await read(`dist/webllm-wasm/${asset.model}.wasm`);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(hash(bytes), asset.sha256);
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 97, 115, 109]);
}
const files = await fs.readdir('dist', { recursive: true });
assert(
  !files.some(
    (f) =>
      f !== 'doc/wwl-model-eval.html' &&
      /(^|\/)(?:\.models|models|qa|tests|logs)(?:\/|$)|model-eval[^/]*\.(?:html|js|json)$|ai-draw-demo|\.litertlm$/.test(
        f,
      ),
  ),
);
assert(
  files.some((f) => /webllm-worker.*\.js$/.test(f)),
  'WebLLM worker must be a bundled file.',
);
for (const page of ['index.html', 'demo/ai-chat-demo.html']) {
  const html = await fs.readFile(`dist/${page}`, 'utf8');
  assert(html.includes('Content-Security-Policy'));
  const scripts = html.match(/script-src ([^;]+)/)?.[1];
  assert(scripts?.includes("'wasm-unsafe-eval'"));
  assert(!scripts?.includes("'unsafe-eval'"));
  assert(!scripts?.includes("'unsafe-inline'"));
}
const report = {
  production: {
    runtimeFiles,
    webllm: wasmManifest,
    excludesModelsAndEvaluation: true,
    restrictiveScriptCsp: true,
  },
};
await fs.mkdir('qa/local-refresh', { recursive: true });
await fs.writeFile(
  'qa/local-refresh/asset-validation.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log('Validated production runtime assets and script CSP.');
