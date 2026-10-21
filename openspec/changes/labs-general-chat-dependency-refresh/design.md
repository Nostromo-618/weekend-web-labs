## Context
Speech requires identical Transformers.js and ONNX Runtime/WASM versions.

## Decisions
Use one General history per chat engine; remove mode switching and chat retrieval. Update the coupled Transformers/ORT pair together and validate actual cached models. Replace third-party glob copying with fixed asset lists and Node filesystem APIs; retain CSP. Pin reviewed versions and retain install policies.

## Risks
Runtime updates can affect Whisper, Kokoro and Silero; actual-model acceptance is required. Asset middleware must reject traversal and serve WASM with correct MIME types. A clean audit is evidence of known advisory removal, not a complete security guarantee.
