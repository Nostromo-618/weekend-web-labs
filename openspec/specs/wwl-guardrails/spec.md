# wwl-guardrails Specification

## Purpose
Shared deterministic guardrails for Labs LLM paths, including Weekend Web Labs system-prompt context for chat.
## Requirements
### Requirement: Guardrails modules remain available
Labs MUST obtain guardrails from `@wwl/wwl-ai-chat/guardrails/*` for LLM and tools rather than a labs-owned `guardrails/` source tree.

#### Scenario: LLM input validation remains callable
- **WHEN** a consumer validates chat input through the LLM guardrails API from `@wwl/wwl-ai-chat/guardrails/llm`
- **THEN** known prompt-injection patterns are blocked before generation

### Requirement: System prompt includes Weekend Web Labs context
The chat system prompt composed for supported models MUST identify Weekend Web Labs (Nostromo-618) and MUST mention that Labs consumes `@vanduo-oss/vd3` (UI) from the vanduo-oss organization.

#### Scenario: Prompt mentions ecosystem context
- **WHEN** the chat system prompt is built for a model that accepts a system role
- **THEN** the prompt text includes Weekend Web Labs / Nostromo-618 context and references to vd3

