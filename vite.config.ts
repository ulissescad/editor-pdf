import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CSP, resolveBase } from './config/site.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

// Arquivos de apoio do pdf.js (fontes padrão, CMaps, decodificadores WASM, perfis ICC) servidos pelo próprio site.
function pdfjsAssets(): Plugin {
  const copy = () => {
    for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      const from = `${root}node_modules/pdfjs-dist/${dir}`;
      const to = `${root}public/pdfjs/${dir}`;
      if (existsSync(from) && !existsSync(to)) cpSync(from, to, { recursive: true });
    }
  };
  return { name: 'pdfjs-assets', buildStart: copy, configureServer: copy };
}

// Injeta a CSP no lugar do marcador <!-- CSP --> só no build (o servidor de desenvolvimento usa scripts inline).
function contentSecurityPolicy(): Plugin {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<!-- CSP -->', `<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
  };
}

export default defineConfig({
  base: resolveBase(process.env),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    pdfjsAssets(),
    contentSecurityPolicy(),
    svelte(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Editor de PDF',
        short_name: 'Editor PDF',
        description: 'Preencha, assine e organize PDFs direto no navegador. Seus arquivos nunca saem do aparelho.',
        lang: 'pt-BR',
        theme_color: '#2457d6',
        background_color: '#eef0f3',
        display: 'standalone',
        start_url: './',
        scope: './',
        // Com o site instalado: aparece em “Compartilhar” (Android) e em “Abrir com” (Chrome/Edge no computador)
        share_target: {
          action: './compartilhar',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'file', accept: ['application/pdf', '.pdf', 'image/*'] }] },
        },
        file_handlers: [{ action: './', accept: { 'application/pdf': ['.pdf'] } }],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        importScripts: ['share-target.js'], // recebe os arquivos do “Compartilhar” (public/share-target.js)
        // Tudo que o site precisa para funcionar offline, inclusive os arquivos de apoio do pdf.js
        // .woff: as fontes extras são embutidas no PDF a partir do WOFF (o WOFF2 fica para a tela)
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2,wasm,bcmap,pfb,ttf,icc}', '**/{open-sans,caveat,dancing-script}-*.woff'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    // pdf.js (worker) e pdf-lib são grandes por natureza e carregados sob demanda
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: `${root}index.html`,
      },
    },
  },
  worker: { format: 'es' },
});
