import { defineConfig, devices } from '@playwright/test';

// Os testes rodam contra o build de produção servido num subcaminho, como no GitHub Pages
// (https://usuario.github.io/<repo>/), para pegar erros de caminho base.
const BASE_PATH = '/editor-pdf/';
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    acceptDownloads: true,
    // O site segue o idioma do navegador: os roteiros são escritos para o português (tests/e2e/i18n.spec.ts cobre os outros)
    locale: 'pt-BR',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    env: { BASE_PATH },
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: false, // sempre testa o build atual (um servidor antigo esconderia mudanças)
    timeout: 180_000,
  },
});
