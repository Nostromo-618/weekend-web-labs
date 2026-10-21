/**
 * The on-device chat ships Gemma 4 E2B and E4B (LiteRT web, 8192-token KV cache).
 * A first diagram often comes back; asking to change that diagram does not.
 * Larger remote Gemma models did better, and they are not this demo.
 * Do not offer the canvas or the flowchart tool here.
 */
export function flowchartChatOffered() {
  return false;
}

/** The catalog still says the model can call tools. This demo does not use that for diagrams. */
export function localDemoChoiceLabel(label) {
  return String(label || '').replace(' · Tools available', ' · Diagram editing not offered');
}

/** The canvas is open only when the host passes a diagram object. `null` means it is off. */
export function flowchartCanvasOpen(document) {
  return document != null && typeof document === 'object';
}

/** Tool-capable models still chat without the flowchart tool while the canvas is closed. */
export function shouldRegisterFlowchartTool(modelHasTools, document) {
  if (!flowchartChatOffered()) return false;
  return Boolean(modelHasTools) && flowchartCanvasOpen(document);
}
