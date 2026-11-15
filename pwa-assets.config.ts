import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Gera favicon, apple-touch-icon e ícones do PWA a partir do logo (npm run icons).
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: minimal2023Preset,
  images: ['public/logo.svg'],
});
