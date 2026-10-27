import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { staticAssetsPlugin } from './utils/static-assets.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

const vdlCbunRoot = path.resolve(root, '../wwl-cbun');
const vdlCbunDist = path.join(vdlCbunRoot, 'dist');
const useLocalVdlCbun = fs.existsSync(path.join(vdlCbunDist, 'index.js'));

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

export default defineConfig(({ command }) => ({
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
          const policy = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' ws: wss: https://raw.githubusercontent.com; worker-src 'self' blob:; media-src 'self' blob: https:; object-src 'none'; base-uri 'self'`;
          return html.replace(
            '<head>',
            `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
          );
        },
      },
    },
    vue(),
    staticAssetsPlugin({ root }),
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
