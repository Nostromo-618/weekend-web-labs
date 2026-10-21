## ADDED Requirements
### Requirement: General-only chat
Labs SHALL expose only General chat and SHALL preserve manual text, dictation and Conversation Mode without a context selector or documentation retrieval.
#### Scenario: Consecutive turns
- **GIVEN** a loaded chat with a typed draft and existing history
- **WHEN** a user continues a text or voice conversation
- **THEN** General history is retained and no documentation search assets are requested by chat
### Requirement: Dependency and asset integrity
Labs SHALL use vd3 1.7.5, review all direct dependencies, and serve matching local runtime assets without widening CSP.
#### Scenario: Production build
- **GIVEN** installed reviewed dependencies
- **WHEN** Labs is built
- **THEN** runtime WASM is present, QA/model mirrors are excluded, and speech remains functional
