/** Validate the local docs build, immutable indexes, and production runtime assets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  buildCanonicalCorpus,
  hash,
} from '../../wwl-hybrid-search/scripts/lib/canonical-index.mjs';

const require = createRequire(import.meta.url);
const sourceRoot = path.resolve(process.env.VD3_DOCS_ROOT || '../../vd3/vd3-docs');
const read = (p) => fs.readFile(p);
const json = async (p) => JSON.parse(await read(p));
const manifest = await json('data/search-manifest.json');
const index = await json(`data/${manifest.index}`);
const compareCurrentDocs = !process.argv.includes('--shipped-only');
let verifiedAnchors = 0;
if (compareCurrentDocs) {
  const fresh = await buildCanonicalCorpus({
    sourceRoot,
    input: path.join(sourceRoot, 'dist/search/search-index.json'),
    htmlDir: path.join(sourceRoot, 'dist'),
  });
  assert.deepEqual(index, fresh, 'The corpus must exactly match the current local docs build.');
}
assert.equal(hash(await read(`data/${manifest.index}`)), manifest.indexHash);
assert.equal(index.corpusHash, hash(JSON.stringify(index.documents)));
if (compareCurrentDocs)
  for (const doc of index.documents) {
    const file = doc.route === '/' ? 'index.html' : `${doc.route.slice(1)}.html`;
    const html = await fs.readFile(path.join(sourceRoot, 'dist', file), 'utf8');
    for (const anchor of doc.anchors) {
      assert(html.includes(`id="${anchor}"`) || html.includes(`id='${anchor}'`));
      verifiedAnchors++;
    }
  }
for (const preset of Object.values(manifest.presets)) {
  const bytes = await read(`data/${preset.path}`);
  assert.equal(hash(bytes), preset.hash);
  const vectors = JSON.parse(bytes);
  for (const field of ['model', 'dimensions', 'dtype', 'pooling', 'queryPrefix', 'documentPrefix'])
    assert.equal(vectors[field], preset[field], field);
  for (const field of ['corpusHash', 'sourceRevision', 'sourceContentHash'])
    assert.equal(vectors[field], manifest[field], field);
  assert.deepEqual(
    vectors.documents.map((d) => d.id),
    index.documents.map((d) => d.id),
  );
  for (const doc of vectors.documents) {
    assert.equal(doc.embedding.length, preset.dimensions);
    assert(doc.embedding.every(Number.isFinite));
  }
  assert.deepEqual(await read(`dist/data/${preset.path}`), bytes);
}
assert.deepEqual(
  await read('dist/data/search-manifest.json'),
  await read('data/search-manifest.json'),
);
assert.deepEqual(await read(`dist/data/${manifest.index}`), await read(`data/${manifest.index}`));

const litertRoot = path.dirname(require.resolve('@litert-lm/core/package.json'));
assert.equal((await json(path.join(litertRoot, 'package.json'))).version, '0.17.1');
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
for (const page of ['index.html', 'demo/ai-chat-demo.html', 'demo/hybrid-search-demo.html']) {
  const html = await fs.readFile(`dist/${page}`, 'utf8');
  assert(html.includes('Content-Security-Policy'));
  const scripts = html.match(/script-src ([^;]+)/)?.[1];
  assert(scripts?.includes("'wasm-unsafe-eval'"));
  assert(!scripts?.includes("'unsafe-eval'"));
  assert(!scripts?.includes("'unsafe-inline'"));
}
const report = {
  corpusScope: compareCurrentDocs ? 'current-local-docs' : 'shipped-pinned-corpus',
  routes: index.documents.length,
  verifiedAnchors,
  generation: manifest.generation,
  sourceRevision: manifest.sourceRevision,
  sourceContentHash: manifest.sourceContentHash,
  presets: manifest.presets,
  allHashesMatch: true,
  production: {
    runtimeFiles,
    webllm: wasmManifest,
    excludesModelsAndEvaluation: true,
    restrictiveScriptCsp: true,
  },
};
await fs.writeFile(
  'qa/local-refresh/asset-validation.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  `Validated ${report.routes} routes, ${verifiedAnchors} anchors, both presets and production assets.`,
);
