/** The canvas is open only when the host passes a diagram object. `null` means it is off. */
export function flowchartCanvasOpen(document) {
  return document != null && typeof document === 'object';
}

/** Tool-capable models still chat without the flowchart tool while the canvas is closed. */
export function shouldRegisterFlowchartTool(modelHasTools, document) {
  return Boolean(modelHasTools) && flowchartCanvasOpen(document);
}
