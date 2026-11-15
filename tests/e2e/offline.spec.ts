import { expect, test } from '@playwright/test';
import { fixture } from './helpers';

// Requisito R6 do PLANO.md: depois da primeira visita, o site funciona sem internet.
test('funciona offline depois da primeira visita', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'O Playwright não intercepta o modo offline do service worker no WebKit');

  await page.goto('./');
  // Espera o service worker terminar de guardar o site (precache) e ficar ativo
  await expect(page.getByText('Pronto para usar offline')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // No modo "prompt" o service worker só controla a página a partir da próxima navegação
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Abrir PDF para editar' })).toBeVisible();

  // Editor offline: abre e renderiza um PDF (worker e WASM do pdf.js vêm do cache)
  await page.goto('./editor.html');
  await page.locator('html[data-ready="true"]').waitFor();
  await page.locator('#fileInput').setInputFiles(fixture('flat-table.pdf'));
  await page.locator('.pdfViewer .page canvas').first().waitFor();
  await expect(page.locator('#status')).toContainText('não tem campos');
});
