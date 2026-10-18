/** Best-effort local PNG of the flowchart SVG. Returns null when the canvas cannot be drawn. */
export async function captureFlowchartPng(root) {
  const svg = root?.querySelector?.('svg');
  if (!svg) return null;
  const bounds = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width || svg.viewBox?.baseVal?.width || 640));
  const height = Math.max(1, Math.round(bounds.height || svg.viewBox?.baseVal?.height || 480));
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const xml = new globalThis.XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new globalThis.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Flowchart screenshot failed.'));
      element.src = url;
    });
    const maxEdge = 768;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
