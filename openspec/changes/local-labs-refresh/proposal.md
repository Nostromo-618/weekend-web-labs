# Proposal

## Why

Labs has drifted from its sibling engines and current documentation: chat lacks cancellation and bounded context, and Hex Earth has no Labs entry point. Refresh these together while preserving on-device privacy and the existing local Hex Earth work.

## What Changes

- Modernize the sibling chat harness and curate the Labs model menu; add independent general/docs conversations and verified source citations.
- Integrate the sibling Hex Earth demo as a lazy full-page Labs route with the existing dock and responsive movable panels.
- Run all local quality gates and provide a review report before any commit or remote operation.

## Capabilities

### New Capabilities
- `wwl-hex-earth`: full-page sibling demo with responsive panels and lifecycle cleanup.

### Modified Capabilities
- `wwl-ai-chat`: cancellable, bounded chat with curated models and cited docs mode.
- `wwl-guardrails`: validated tool schemas, bounded execution, and safe streaming.

## Impact

Labs-owned vdl surfaces and sibling wwl-ai-chat and wwl-hex-earth implementations change. Public vd3 APIs remain unchanged. Existing callback APIs and the standalone Earth app remain supported. The user explicitly authorized coordinated sibling edits and implementation of the previously reviewed plan; no commit, push, or publishing is authorized.
