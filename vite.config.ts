import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * `npm run build:single` makes one self-contained index.html (fonts and all),
 * handy for sharing a demo by email or opening straight from disk.
 * A few lines of our own instead of a plugin dependency: the script and the
 * stylesheet are moved into the HTML, and fonts are already inlined as data
 * URIs by the high `assetsInlineLimit`.
 */
function singleFile(): Plugin {
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 'control:single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!page || page.type !== 'asset') return;
      let html = String(page.source);
      for (const [key, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          const tag = new RegExp(`<script[^>]*\\ssrc="[^"]*${escapeRe(file.fileName)}"[^>]*></script>`);
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          html = html.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[key];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*\\shref="[^"]*${escapeRe(file.fileName)}"[^>]*>`);
          html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
          delete bundle[key];
        }
      }
      page.source = html;
    },
  };
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), ...(single ? [singleFile()] : [])],
    build: single
      ? { outDir: 'dist-single', assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false, modulePreload: false }
      : { outDir: 'dist' },
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  };
});
