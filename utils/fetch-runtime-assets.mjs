/** Fetch compiled libraries for catalog WebLLM models. Run explicitly when updating WebLLM. */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MODEL_OPTIONS } from '@wwl/wwl-ai-chat';
const dir = new URL('../public/webllm-wasm/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const records = MODEL_OPTIONS.filter((m) => m.backend === 'webllm' && m.modelLibUrl).map((m) => ({
  model_id: m.id,
  model_lib: m.modelLibUrl,
}));
const assets = [];
for (const record of records) {
  const response = await fetch(record.model_lib);
  if (!response.ok) throw new Error(`Runtime download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(new URL(`${record.model_id}.wasm`, dir), bytes);
  assets.push({
    model: record.model_id,
    source: record.model_lib,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
await fs.writeFile(
  new URL('manifest.json', dir),
  JSON.stringify({ webllm: '0.2.86', assets }, null, 2) + '\n',
);
console.log(assets);
