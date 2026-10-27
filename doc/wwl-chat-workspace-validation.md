# Chat workspace validation — 2026-10-04

> Historical workspace acceptance from October 4, 2026. For current reply delivery, paused model/voice settings and responsive controls, see [the latest feature validation](./wwl-checked-stream-conversation-validation.md).

The shared Labs/standalone AI Chat now has a collapsible 320px controls panel, a full-height message column and a composer with compact dictation controls. Below 960px of workspace width, Settings opens an accessible right drawer. A stable settings destination keeps voice preferences and the existing speech session mounted. This change leaves public AiChat interfaces, inference workers and privacy behavior unchanged.

## Coverage

**136 checks passed** in Playwright Chromium Desktop and WebKit Desktop. The installed-Chrome actual-model suite passed **two checks**, including three consecutive conversation turns. Production build and shipped asset/runtime/CSP validation passed. ESLint reported zero errors and ten existing draw-tool warnings.

Focused Playwright coverage includes both themes at 1440×900, 1024×768, 820×700, 390×844 and 390×390; long markdown/code and six messages; composer reachability; independent scrolling; message-height stability when settings changes; draft and voice preference preservation; focus trapping/restoration; Escape/backdrop dismissal; nested storage confirmation; and pending download, recording, playback and conversation resizing.

Existing chat, comparison and speech/controller lifecycle checks also run against the refactored component. Keyboard-open sizing is represented by a short viewport, not a physical phone certification.

Installed Chrome completed three actual Gemma E2B/Whisper/Silero/Kokoro turns through the existing synthetic-microphone acceptance harness. It verified non-silent PCM output, capture reopening, microphone-off synthesis/generation, retained history, cached offline inference and no uploads. Silence-to-submit was 2.44–2.62 s; silence-to-first-audio was 5.30–9.10 s on this machine. These are observations under test load, not cross-device performance guarantees. The harness validates the unchanged inference path; the responsive UI tests inject deterministic sessions for state and layout coverage.

The additional Firefox UI attempt could not launch the installed Playwright browser: it reported “Could not find profile folder” before visiting the application. Firefox layout acceptance therefore remains unverified in this run. Chrome and WebKit coverage does not certify actual-model Safari or mobile inference.

Screenshots are saved under `qa/chat-workspace/`, including populated light/dark desktop and narrow workspaces. These are local QA artifacts, not published assets. Open [Labs AI Chat](../#demos/aichat) or [standalone AI Chat](../demo/ai-chat-demo.html) on the current host.

No commit, push or deployment was made.
