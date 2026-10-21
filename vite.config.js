import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { staticAssetsPlugin } from './utils/static-assets.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const litertRoot = path.dirname(require.resolve('@litert-lm/core/package.json'));
const transformersRoot = path.resolve(
  path.dirname(require.resolve('@huggingface/transformers')),
  '..',
);
const ortRoot = path.resolve(
  path.dirname(
    createRequire(path.join(transformersRoot, 'package.json')).resolve('onnxruntime-web'),
  ),
  '..',
);

const localModelsDir = path.join(root, '.models');
const vdlCbunRoot = path.resolve(root, '../wwl-cbun');
const vdlCbunDist = path.join(vdlCbunRoot, 'dist');
const useLocalVdlCbun = fs.existsSync(path.join(vdlCbunDist, 'index.js'));

/** Dev/QA preview only: serve `.models/<id>/…` at `/models/<id>/…` (never copied into `dist/`).
 *  Also accepts HuggingFace-style `/resolve/main/…` suffixes that WebLLM appends.
 */
function localModelsPlugin(preview = false) {
  const plugin = {
    name: 'labs-local-models',
    configureServer(server) {
      server.middlewares.use('/models', (req, res, next) => {
        try {
          const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
          let rel = urlPath.replace(/^\/+/, '');
          // WebLLM HF URL helper: {model}/resolve/main/<file>
          rel = rel.replace(/\/resolve\/(?:main|[a-f0-9]{40})(?=\/|$)/g, '');
          if (!rel || rel.includes('..')) {
            res.statusCode = 400;
            res.end('Bad path');
            return;
          }
          const filePath = path.join(localModelsDir, rel);
          if (!filePath.startsWith(localModelsDir)) {
            res.statusCode = 400;
            res.end('Bad path');
            return;
          }
          if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          const st = fs.statSync(filePath);
          res.setHeader('Content-Length', String(st.size));
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Accept-Ranges', 'bytes');
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          const stream = fs.createReadStream(filePath);
          res.on('close', () => stream.destroy());
          stream.on('error', next).pipe(res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
  if (preview) plugin.configurePreviewServer = plugin.configureServer;
  return plugin;
}

const vdlCbunAlias = useLocalVdlCbun
  ? {
      '@wwl/wwl-cbun/code-editor/css': path.join(vdlCbunDist, 'code-editor/vd3-code-editor.css'),
      '@wwl/wwl-cbun/code-editor/highlight': path.join(vdlCbunDist, 'code-editor/highlight.js'),
      '@wwl/wwl-cbun/code-editor': path.join(vdlCbunDist, 'code-editor'),
      '@wwl/wwl-cbun/draw/css': path.join(vdlCbunDist, 'draw/vd3-draw.css'),
      '@wwl/wwl-cbun/draw': path.join(vdlCbunDist, 'draw'),
      '@wwl/wwl-cbun/hex-grid/hex-math': path.join(vdlCbunDist, 'hex-grid/hex-math.js'),
      '@wwl/wwl-cbun/hex-grid': path.join(vdlCbunDist, 'hex-grid'),
      '@wwl/wwl-cbun/music-player/css': path.join(vdlCbunDist, 'music-player/vd3-music-player.css'),
      '@wwl/wwl-cbun/music-player': path.join(vdlCbunDist, 'music-player'),
      '@wwl/wwl-cbun': vdlCbunDist,
    }
  : {};

export default defineConfig(({ command, mode }) => ({
  // Project site: https://nostromo-618.github.io/weekend-web-labs/
  // Dev and Playwright keep `/` so the Vite server stays at the host root.
  base: command === 'build' ? '/weekend-web-labs/' : '/',
  plugins: [
    {
      name: 'labs-csp',
      transformIndexHtml: {
        order: 'post',
        handler(html, context) {
          if (!context.bundle) return html;
          const hashes = [
            ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
          ].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
          const policy = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' ws: wss: https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com; worker-src 'self' blob:; media-src 'self' blob: https:; object-src 'none'; base-uri 'self'`;
          return html.replace(
            '<head>',
            `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
          );
        },
      },
    },
    vue(),
    localModelsPlugin(mode === 'qa'),
    staticAssetsPlugin({ root, litertRoot, ortRoot }),
  ],
  worker: { format: 'es' },
  resolve: {
    dedupe: ['vue', '@vanduo-oss/vd3'],
    alias: {
      ...vdlCbunAlias,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        'ai-chat-demo': path.resolve(root, 'demo/ai-chat-demo.html'),
        ...(mode === 'qa'
          ? {
              'model-eval-harness': path.resolve(root, 'demo/model-eval-harness.html'),
              'speech-eval-harness': path.resolve(root, 'demo/speech-eval-harness.html'),
              'conversation-eval-harness': path.resolve(
                root,
                'demo/conversation-eval-harness.html',
              ),
            }
          : {}),
      },
    },
  },
  server: {
    hmr: process.env.LABS_STABLE_EVAL !== '1',
    watch: process.env.LABS_STABLE_EVAL === '1' ? { ignored: ['**/*'] } : undefined,
    port: 3000,
    fs: {
      allow: [path.resolve(root, '..'), root, ...(useLocalVdlCbun ? [vdlCbunRoot] : [])],
    },
  },
  preview: {
    port: 3000,
  },
}));
