# wwl-guardrails

Canonical documentation for FOSS guardrails consumed from linked WWL sibling packages (not a labs-owned source tree).

This module family centralizes deterministic validation and safety composition used by `wwl-ai-chat`.

## Purpose and Scope

Package guardrail subpaths exist to provide a single, reusable policy layer that works in both UI and headless code paths.

- **Deterministic validation**: reject malformed or unsafe inputs before expensive runtime work.
- **System-prompt guardrails**: compose explicit safety and behavior policies for LLM components.
- **Shared result/error contracts**: standardize allow/block outcomes and thrown error shape.

## Module Map

### `@wwl/wwl-ai-chat` / core helpers

Shared contracts and helpers used by LLM guardrails:

- `normalizeText(value)`
- `allow(meta?)`
- `block({ code, message, matchedPatternIds?, meta? })`
- `toGuardrailError(result, fallbackMessage?)`

### `@wwl/wwl-ai-chat/guardrails/llm`

LLM policy surface used by `wwl-ai-chat`:

- `BASE_FOSS_GUARDRAILS_SYSTEM_PROMPT`
- `DEFAULT_LLM_GUARD_PATTERNS`
- `LLM_BLOCK_MESSAGE`
- `validateLlmInput(input)`
- `buildChatSystemPrompt({ product?, extra?, extraRules?, toolsEnabled?, toolNames? })`
- Re-exports tool helpers from `tools.js`
- `chatGuardrails`

### `@wwl/wwl-ai-chat/guardrails/tools`

Tool-call validation and XML fallback protocol helpers:

- `validateToolCall({ name, args, allowlist, maxArgsBytes? })`
- `parseXmlToolCalls(text)`
- `formatXmlToolResult(name, result)`
- `DEFAULT_MAX_TOOL_ARGS_BYTES`

## Threat Model Split

Guardrails are intentionally split by runtime behavior and risk surface.

- **LLM guardrails (`llm.js`)**
  - Target instruction-following generators (`wwl-ai-chat`).
  - Combine deterministic input blocking (regex pattern matching, max length, empty checks) with system-prompt policy composition.

## API Reference

### Core helpers (`core.js`)

#### `normalizeText(value): string`

Normalizes whitespace to single spaces and trims boundaries.

#### `allow(meta?): GuardrailResult`

Returns `{ allowed: true }` plus optional metadata.

#### `block(params): GuardrailResult`

Returns a blocked result with canonical fields:

- `allowed: false`
- `code`
- `message`
- optional `matchedPatternIds`
- optional `meta`

#### `toGuardrailError(result, fallbackMessage?): GuardrailError`

Converts a blocked (or generic) result into a structured error.

Produced error shape:

- `name = 'GuardrailError'`
- `code` (from result code or `guardrail.blocked` fallback)
- `reason` (same text as message)
- `guardrail` (attached original `GuardrailResult`)

### LLM helpers (`llm.js`)

#### `DEFAULT_LLM_GUARD_PATTERNS`

Default deterministic block patterns for common prompt-injection/jailbreak classes:

- instruction override attempts (including typo-normalized scans and “do anything now”)
- system prompt extraction attempts
- role/persona rebinding
- delimiter breakout framing
- jailbreak framing patterns

#### `normalizeJailbreakScanText(text): string`

Produces a bounded scan form with Unicode compatibility/confusable folds, invisible-character removal, common obfuscation and typo normalization (e.g. `gonre` → `ignore`). Original submitted content is preserved.

#### `validateLlmInput(input): GuardrailResult`

Validates prompt text (`string` or options object) and returns allow/block result.

- Blocks empty input (`llm.input.empty`)
- Blocks over-length input (`llm.input.too_long`)
- Blocks matched guard patterns on bounded raw, normalized and decoded variants (`llm.input.blocked`)
- Supports `profile` and locally quoted educational discussion; reference/tool boundaries disable the quote exception

#### `validateLlmOutput(input): GuardrailResult`

Checks complete visible assistant output for jailbreak-compliance phrasing, narrow harmful-content patterns and the profile's reviewed profanity rules. `AiChat` uses it before callbacks, transcript persistence or speech (`llm.output.blocked`). This is limited local moderation, not a semantic classifier.

#### `buildChatSystemPrompt(options?): string`

Returns `BASE_FOSS_GUARDRAILS_SYSTEM_PROMPT` (role lock included), optional product/tools/`extra` policy, then `FOSS_SYSTEM_PROMPT_TRAILER` (sandwich / primacy-recency reminder).

#### `chatGuardrails`

Preset objects that bundle:

- `validateInput`
- `buildSystemPrompt`
- `patterns`

## Return Contracts and Error Behavior

### `GuardrailResult`

From `core.js` JSDoc:

```ts
interface GuardrailResult {
  allowed: boolean;
  code?: string;
  message?: string;
  matchedPatternIds?: string[];
  meta?: Record<string, unknown>;
}
```

### `GuardrailError`

Returned by `toGuardrailError()`:

```ts
type GuardrailError = Error & {
  code?: string;
  reason?: string;
  guardrail?: GuardrailResult;
};
```

## Usage Examples

### Headless LLM input validation before generation

```javascript
import { validateLlmInput } from '@wwl/wwl-ai-chat/guardrails/llm';
import { toGuardrailError } from '@wwl/wwl-ai-chat'; /* or package core re-exports */

const check = validateLlmInput({
  text: userPrompt,
  maxLength: 8000,
});

if (!check.allowed) {
  throw toGuardrailError(check);
}
```

### Custom system prompt building for chat

```javascript
import { buildChatSystemPrompt } from '@wwl/wwl-ai-chat/guardrails/llm';

const chatPrompt = buildChatSystemPrompt({
  extraRules: 'Prefer concise bullet points.',
});
```

## Compatibility Notes

Prefer the published package guardrail APIs:

- `validateLlmInput()`
- `buildChatSystemPrompt()`

## October 2026 chat boundaries

AiChat defaults to `guardrailProfile: 'family-friendly'`; `'general'` relaxes the family language rule while retaining harmful-assistance and injection rules. Profanity in user input alone is allowed. Health, identity, abuse reporting and help-seeking remain supported.

`onGuardrail` optionally receives stage, code, rule IDs and structured source/history/tool identifiers, never raw rejected text. References and imported complete history turns are checked before admission; `onContext` reports rejection counts. If every supplied reference is rejected, generation stops. Tool arguments are checked before execution; rejected results are replaced before callbacks or ingestion.

`onUpdate` keeps its signature and now delivers the complete checked answer once. Output is buffered before display/history/speech, canceled output is discarded, and blocked output becomes a fixed safe answer while backend context is rebuilt.

Pinned `obscenity@0.4.6`, adapted Microsoft PyRIT rules and Unicode data are documented in the sibling notices/provenance manifest. This local policy supplies limited semantic moderation, without a classifier or remote service. See [chat validation](./wwl-model-guardrails-validation.md).

## Checked previews

Labs explicitly opts into checked previews for text Chat/Compare; the package
default remains complete-answer delivery. Every released prefix is checked with
all preceding visible context and a held trailing buffer. A later violation
can withdraw the preview but cannot undo earlier exposure. Select Full-answer
check for the stronger exposure boundary. Conversation transcripts and all
speech remain behind final checking. Previews are inert plain text; final
Markdown uses the existing safe-link renderer. No NVIDIA runtime or remote
moderation service is introduced. Deterministic rules have limited semantic
moderation in both modes.
