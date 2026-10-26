import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const pagesBase = '/weekend-web-labs';
const docDir = path.join(root, 'doc');
const pending = fs.existsSync(docDir)
  ? fs
      .readdirSync(docDir)
      .filter((name) => name.endsWith('.html'))
      .map((name) => `/doc/${name}`)
  : [];
const visited = new Set();
const external = new Set();
const errors = [];
const local = new Set();
let links = 0;
while (pending.length) {
  const page = pending.pop();
  if (visited.has(page)) continue;
  visited.add(page);
  const html = fs.readFileSync(path.join(root, page.slice(1)), 'utf8');
  for (const match of html.matchAll(/<a href="([^"]*)"/g)) {
    links++;
    const href = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const target = new URL(href, `https://labs.invalid${page}`);
    if (target.origin !== 'https://labs.invalid') {
      external.add(target.href);
      continue;
    }
    // Built pages prefix links with `/weekend-web-labs`. Files in dist/ stay unprefixed.
    const logical =
      target.pathname === pagesBase || target.pathname === `${pagesBase}/`
        ? '/'
        : target.pathname.startsWith(`${pagesBase}/`)
          ? target.pathname.slice(pagesBase.length)
          : target.pathname;
    const file = path.join(
      // Root app routes are checked as index.html below.
      root,
      decodeURIComponent(logical).replace(/^\//, '') || 'index.html',
    );
    local.add(logical);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      errors.push(`${page}: missing ${href}`);
      continue;
    }
    if (!logical.startsWith('/doc/')) continue; // App routes use hashes, not DOM heading IDs.
    if (logical.endsWith('.html')) {
      const content = fs.readFileSync(file, 'utf8');
      if (!content.includes('<main>')) errors.push(`${page}: SPA fallback ${href}`);
      if (target.hash && !content.includes(`id="${decodeURIComponent(target.hash.slice(1))}"`))
        errors.push(`${page}: missing fragment ${href}`);
      pending.push(logical);
    }
  }
}
// Optional real-server verification catches 200 responses containing the SPA fallback.
const baseURL = process.argv[2];
if (baseURL) {
  for (const destination of local) {
    const response = await fetch(new URL(destination, baseURL));
    const expected = fs.readFileSync(path.join(root, destination.slice(1) || 'index.html'));
    const actual = Buffer.from(await response.arrayBuffer());
    if (!response.ok || !actual.equals(expected))
      errors.push(`HTTP content mismatch ${response.status}: ${destination}`);
  }
}
console.log(
  JSON.stringify(
    {
      pages: visited.size,
      links,
      localDestinations: local.size,
      external: [...external].sort(),
      errors,
    },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
