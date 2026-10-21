## Why
Labs should consume vd3 1.7.5, simplify AI Chat to General only, and reduce dependency security exposure.

## What Changes
- Remove Docs chat UI, retrieval, citation processing, mode histories, and evaluation cases from Labs Chat and Compare.
- Preserve the public AiChat API.
- Review all direct dependencies, update compatible releases, and replace the vulnerable static-copy plugin with fixed-path asset delivery.

## Capabilities
### New Capabilities
- `general-chat`: General-only Labs chat and compatible dependency delivery.

## Impact
Labs UI, internal sessions, QA, dependency lockfile and build asset copying change. vd3 APIs and engine packages remain unchanged. Paired exports use schema 2 with a single turns array.
