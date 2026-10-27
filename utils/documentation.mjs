const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (text) => text.replace(/&(?:amp|lt|gt|quot|#39);/g, (value) => entities[value]);
const escape = (text) =>
  text.replace(
    /[&<>"']/g,
    (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value],
  );

/** `/` in dev, `/weekend-web-labs/` on GitHub Pages. A trailing slash is required. */
function joinBase(siteBase, pathname) {
  const root = siteBase.endsWith('/') ? siteBase.slice(0, -1) : siteBase;
  return `${root}${pathname}`;
}

/** Rebase only anchors emitted by the safe renderer, never raw Markdown destinations. */
export function renderDocumentation(markdown, sourcePath, siteBase = '/') {
  const base = new URL(sourcePath, 'https://labs.invalid');
  const counts = new Map();
  return markdown
    .replace(/<a href="([^"]*)"/g, (match, encoded) => {
      const href = decode(encoded);
      if (/^https?:/i.test(href)) return match;
      const target = new URL(href, base);
      if (target.pathname.startsWith('/doc/') && target.pathname.endsWith('.md'))
        target.pathname = target.pathname.slice(0, -3) + '.html';
      return `<a href="${escape(joinBase(siteBase, target.pathname) + target.search + target.hash)}"`;
    })
    .replace(/<h([1-6])>(.*?)<\/h\1>/g, (match, level, content) => {
      const slug = decode(content.replace(/<[^>]*>/g, ''))
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, '')
        .trim()
        .replace(/\s/g, '-');
      const count = counts.get(slug) || 0;
      counts.set(slug, count + 1);
      return `<h${level} id="${escape(slug + (count ? `-${count}` : ''))}">${content}</h${level}>`;
    });
}

/** Readable, script-free report pages; original Markdown remains available alongside them. */
export function documentationPage(markdown, sourcePath, siteBase = '/') {
  const body = renderDocumentation(markdown, sourcePath, siteBase);
  const title = escape((markdown.match(/^#\s+(.+)$/m) || [null, 'Labs documentation'])[1]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title} · Labs</title>
<style>
:root{color-scheme:light dark;font:16px/1.6 system-ui,sans-serif}body{max-width:920px;margin:0 auto;padding:24px;overflow-wrap:anywhere}a{color:light-dark(#075bbb,#8fbcff)}nav{display:flex;gap:24px;flex-wrap:wrap}h1,h2,h3{line-height:1.25}pre{overflow:auto;padding:16px;background:light-dark(#f2f4f6,#222);border-radius:8px}code{font-size:.9em}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:8px;border:1px solid #888}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #888}@media(max-width:600px){body{padding:16px}}
</style></head><body><nav><a href="${escape(joinBase(siteBase, '/'))}#home">Back to Labs</a><a href="${escape(joinBase(siteBase, sourcePath))}">Source Markdown</a></nav><main>${body}</main></body></html>`;
}
