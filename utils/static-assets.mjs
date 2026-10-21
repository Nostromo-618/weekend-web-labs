import fs from 'node:fs';
import path from 'node:path';
import { documentationPage } from './documentation.mjs';

/** Fixed local assets only: no glob parser, arbitrary paths, or remote executable code. */
export function staticAssetsPlugin({ root, litertRoot, ortRoot }) {
  const files = new Map();
  // Publish the exact sources used by this checkout without duplicating attribution data.
  for (const [url, source] of [
    ['/doc/chat-third-party-notices.md', '../wwl-ai-chat/THIRD_PARTY_NOTICES.md'],
    ['/doc/chat-guardrail-provenance.json', '../wwl-ai-chat/src/guardrails/data/provenance.json'],
    ['/doc/speech-source-provenance.md', 'src/lib/speech/PROVENANCE.md'],
    ['/doc/kokoro-english-voices.json', 'src/lib/speech/voices.json'],
  ])
    files.set(url, path.resolve(root, source));
  const documents = new Map();
  function collectDocuments(directory, prefix = '/doc') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      const url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) collectDocuments(source, url);
      else {
        files.set(url, source);
        if (entry.name.endsWith('.md')) documents.set(url.slice(0, -3) + '.html', source);
      }
    }
  }
  collectDocuments(path.join(root, 'doc'));
  for (const [url, source] of files)
    if (url.endsWith('.md')) documents.set(url.slice(0, -3) + '.html', source);
  for (const [directory, destination, accept] of [
    [path.join(litertRoot, 'wasm'), 'litert-wasm', () => true],
    [path.join(ortRoot, 'dist'), 'transformers-wasm', (name) => name.startsWith('ort-wasm')],
  ]) {
    for (const name of fs.readdirSync(directory)) {
      const source = path.join(directory, name);
      if (accept(name) && fs.statSync(source).isFile())
        files.set(`/${destination}/${name}`, source);
    }
  }
  let output;
  let siteBase = '/';
  return {
    name: 'labs-static-assets',
    configResolved(config) {
      siteBase = config.base || '/';
      if (config.command === 'build') output = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let url;
        try {
          url = decodeURIComponent((request.url || '').split('?')[0]);
        } catch {
          response.statusCode = 400;
          response.end('Bad path');
          return;
        }
        if (!['GET', 'HEAD'].includes(request.method)) return next();
        const document = documents.get(url);
        if (document) {
          const html = documentationPage(
            fs.readFileSync(document, 'utf8'),
            url.slice(0, -5) + '.md',
            siteBase,
          );
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(request.method === 'HEAD' ? undefined : html);
          return;
        }
        const source = files.get(url);
        if (!source && url.startsWith('/doc/')) {
          response.statusCode = 404;
          response.end('Documentation not found');
          return;
        }
        if (!source || !['GET', 'HEAD'].includes(request.method)) return next();
        response.setHeader(
          'Content-Type',
          source.endsWith('.wasm')
            ? 'application/wasm'
            : source.endsWith('.md')
              ? 'text/plain; charset=utf-8'
              : source.endsWith('.json')
                ? 'application/json'
                : /\.m?js$/.test(source)
                  ? 'text/javascript'
                  : 'application/octet-stream',
        );
        response.setHeader('Content-Length', String(fs.statSync(source).size));
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        const stream = fs.createReadStream(source);
        response.on('close', () => stream.destroy());
        stream.on('error', next).pipe(response);
      });
    },
    async closeBundle() {
      if (!output) return;
      for (const [url, source] of files) {
        const destination = path.join(output, url.slice(1));
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.copyFile(source, destination);
      }
      for (const [source, destination] of [
        ['doc', 'doc'],
        ['favicon.svg', 'favicon.svg'],
      ])
        await fs.promises.cp(path.join(root, source), path.join(output, destination), {
          recursive: true,
        });
      for (const [url, source] of documents) {
        await fs.promises.writeFile(
          path.join(output, url.slice(1)),
          documentationPage(
            await fs.promises.readFile(source, 'utf8'),
            url.slice(0, -5) + '.md',
            siteBase,
          ),
        );
      }
    },
  };
}
