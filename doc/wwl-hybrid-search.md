# Hybrid search in Labs

Labs consumes the private sibling `@wwl/wwl-hybrid-search`. Its README documents the headless API. The current site UI is `WwlHybridSearchUI.vue`; the older imperative DOM fixture exists only for compatibility tests.

## Model choice and loading

Fuzzy search starts after the local corpus loads and does not need WebGPU or model storage. Labs offers EmbeddingGemma (`onnx-community/embeddinggemma-300m-ONNX`, q8, 768 dimensions, approximately 300 MB) as the default semantic option. MiniLM (`Xenova/all-MiniLM-L6-v2`, q8, 384 dimensions, approximately 23 MB) stays available as the lighter choice. Choosing a preset does not download it: select **Enable semantic search** to load it. Typing and Enter use fuzzy retrieval until that model is ready.

The runtime rejects mismatched models, dimensions, corpus identity, dtype, pooling or prefixes before importing Transformers.js. A failure leaves fuzzy search usable with an explanatory status. Query vectors must also have matching dimensions. Each UI owns and disposes its extractor. Storage-denied operation is tested for fuzzy search; semantic model caching remains browser-dependent.

## Canonical assets

Run `pnpm index` after building the latest local vd3-docs checkout. The default source is `../../vd3/vd3-docs`; `VD3_DOCS_PATH` overrides it. Source files are read only. The package CLI consumes `dist/search/search-index.json` and rendered HTML from the same build, extracting verified anchors, identifiers, API tables and bounded code examples without executing navigation code.

`data/search-manifest.json` references a content-addressed generation with a corpus plus MiniLM and EmbeddingGemma vectors. It records source revision/dirty state/content hash, asset hashes, corpus hash and the complete embedding configuration. Both sets must validate before the manifest is replaced. An incomplete build preserves the last valid generation.

All routes use `https://vd3.vanduo.dev`. The refresh covers 92 routes, including Dock, Global Search, Surfaces, Login, Liquid Gradient, Canvas Components Bundle and the ecosystem guide. Section links come from actual HTML anchors.


## Quality checks

`node utils/neptune-benchmark.mjs` runs the actual package with real embedding models against retained queries and new route/name/prop/class/typo/concept/irrelevance cases. It fails on recall or reciprocal-rank regression or a failed new query. Results are in `qa/local-refresh/search-benchmark.json`.

Package coverage and atomic-build tests live in the sibling repository. Labs tests cover the real Vue UI, offline fuzzy retrieval after loading, denied storage, keyboard and IME input, missing WebGPU and lifecycle cleanup. Production-preview checks exercise the bundled ORT runtime under the site's CSP.
