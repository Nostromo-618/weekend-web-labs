# wwl-ai-chat Specification

## Purpose
In-browser WebGPU AI chat with LiteRT Gemma as the default path, optional experimental MLC models, and Labs composer UX conventions.
## Requirements
### Requirement: LiteRT Gemma is the default chat path
The default model MUST be Gemma 4 E2B via LiteRT-LM, and that path MUST preserve real multi-turn conversation context across turns in a session. Additional LiteRT families MAY be offered as non-default options without changing the default identity.

#### Scenario: Default model identity
- **WHEN** a user opens Labs AI chat without choosing another model
- **THEN** the selected default is Gemma 4 E2B on the LiteRT path

#### Scenario: Multi-turn on LiteRT
- **WHEN** the user sends a follow-up message on the LiteRT Gemma default after a prior assistant reply
- **THEN** generation uses conversation context from prior turns (not latest-turn-only)

### Requirement: Community MLC Gemma is experimental
Community WebLLM/MLC Gemma packages MAY remain available but MUST be labeled experimental, and the product MUST NOT treat their native multi-turn behavior as reliable.

#### Scenario: Experimental labeling
- **WHEN** the model picker lists a community MLC Gemma option
- **THEN** the option is marked experimental (or equivalent user-facing signal)

### Requirement: Composer Enter sends and list sticks to bottom
Labs chat UI MUST send on Enter (Shift+Enter inserts a newline) and MUST keep the message list scrolled to the latest content while the user is near the bottom.

#### Scenario: Enter sends
- **WHEN** the composer has focus and the user presses Enter without Shift
- **THEN** the current message is submitted

#### Scenario: Stick to bottom while near bottom
- **WHEN** new assistant tokens arrive and the user is already near the bottom of the message list
- **THEN** the list remains scrolled to show the latest content

### Requirement: Multi-architecture catalog with honest LiteRT labels
The model catalog MUST keep Gemma 4 E2B LiteRT as the default web-official path and MAY expose LiteRT spikes for other families labeled `spike` / experimental. Qwen3 0.6B MUST NOT be offered. A constrained-device warning MUST NOT name a removed model.

#### Scenario: Qwen3 Tiny is not offered
- **WHEN** a user opens the model picker
- **THEN** neither Qwen3 0.6B precision is listed

#### Scenario: Official Gemma web remains default
- **WHEN** a user opens Labs AI chat without choosing another model
- **THEN** the default remains Gemma 4 E2B LiteRT with web-official support

#### Scenario: Weak-device warning names no removed model
- **WHEN** load-capacity heuristics flag a constrained device
- **THEN** the warning does not recommend Qwen3 0.6B or any other removed model

### Requirement: Outdated optional models removed
The catalog MUST NOT offer Qwen3 0.6B, SmolLM2-360M, Qwen2.5-1.5B, or Llama-3.2-3B as selectable options.

#### Scenario: Removed models absent from picker
- **WHEN** the model picker lists catalog choices
- **THEN** Qwen3 0.6B, SmolLM2-360M, Qwen2.5-1.5B, and Llama-3.2-3B are not present

### Requirement: Experimental Mistral choices stay optional
The catalog MUST keep Gemma 4 E2B LiteRT as the default. It MAY offer three experimental WebLLM choices: Ministral 3 3B Instruct q4f16, Ministral 3 3B Reasoning q4f16, and Mistral 7B Instruct v0.3 q4f16. Only Gemma 4 E2B and E4B execute tools and remain selectable when the Flowchart panel is open; the experimental WebLLM choices and LFM 2.5 MUST remain listed for Chat and Compare and MUST be omitted from flowchart-interaction selection. The Ministral 3 3B ONNX choice MUST NOT be offered. WebLLM choices MUST require shader-f16 and use a 4096-token context. q4f32 twins, Mistral Small 4, and Ministral 8B/14B MUST NOT be offered. The reasoning WebLLM choice MUST remain a peer of LFM 2.5 and MUST NOT replace it.

#### Scenario: Default remains Gemma 4 E2B
- **WHEN** a user opens Labs AI chat without choosing another model
- **THEN** the default remains Gemma 4 E2B LiteRT

#### Scenario: Experimental choices are listed
- **WHEN** the model picker lists catalog choices
- **THEN** the three experimental WebLLM Mistral choices are present, labeled experimental, and Gemma 4 E2B is still the default

#### Scenario: Broken ONNX choice is absent
- **WHEN** the model picker lists catalog choices
- **THEN** Ministral 3 3B Instruct ONNX is not present

#### Scenario: Non-tool models are omitted when Flowchart is open
- **WHEN** the Flowchart panel is open
- **THEN** only tool-ready Gemma 4 models are selectable and LFM 2.5 / WebLLM Mistral choices are omitted from flowchart-interaction selection


### Requirement: AiChat engine comes from sibling Labs repo
The labs AI chat demo MUST import `AiChat` and related helpers from `@wwl/wwl-ai-chat`, and markdown from `@wwl/wwl-ai-chat/markdown`, resolved via `link:../wwl-ai-chat`. Labs MUST NOT treat a local `ai-chat.js` as the engine SoT.

#### Scenario: Vue chat UI imports sibling package
- **WHEN** `WwlAiChatUI` loads the chat engine and markdown helper
- **THEN** imports resolve from `@wwl/wwl-ai-chat` and `@wwl/wwl-ai-chat/markdown`
