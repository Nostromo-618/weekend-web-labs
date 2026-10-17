import { HybridSearch } from '@wwl/wwl-hybrid-search';
import Fuse from 'fuse.js';
import { publicUrl } from './public-url.js';

export const SEARCH_PRESETS = [
  { id: 'embeddinggemma', label: 'Quality · EmbeddingGemma', download: 'about 300 MB' },
  { id: 'minilm', label: 'Lightweight · MiniLM', download: 'about 23 MB' },
];
export async function createDocsSearch(preset = 'embeddinggemma', overrides = {}) {
  let indexUrl = overrides.indexUrl;
  let vectorsUrl = overrides.vectorsUrl;
  if (!indexUrl || !vectorsUrl) {
    const response = await fetch(publicUrl('data/search-manifest.json'));
    if (!response.ok) throw new Error(`Documentation index unavailable (${response.status}).`);
    const manifest = await response.json();
    const model = manifest.presets?.[preset];
    const safePath = (p) => /^search\/[a-f0-9]{24}\/[a-z0-9-]+\.json$/.test(p);
    if (
      manifest.schemaVersion !== 1 ||
      !model ||
      !safePath(manifest.index) ||
      !safePath(model.path)
    )
      throw new Error('Invalid documentation manifest.');
    indexUrl = publicUrl(`data/${manifest.index}`);
    vectorsUrl = publicUrl(`data/${model.path}`);
  }
  const engine = new HybridSearch({
    embeddingPreset: preset,
    indexUrl,
    vectorsUrl,
    loadFuse: async () => ({ default: Fuse }),
    loadTransformers: () => import('@huggingface/transformers'),
    onnxWasmPaths: publicUrl('transformers-wasm/'),
  });
  await engine.initFuzzy();
  return engine;
}
