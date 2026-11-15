import { expect, test } from '@playwright/test';
import { addText, downloadPdf, fixture, openInEditor } from './helpers';
import { baseFonts } from '../pdf-inspect';

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

  // Editor offline: abre e renderiza um PDF (editor, worker, WASM e fontes vêm do cache)
  await page.goto('./#/editor');
  await page.locator('html[data-editor-ready="true"]').waitFor();
  await openInEditor(page, fixture('flat-table.pdf'));
  await expect(page.locator('#status')).toContainText('não tem campos');

  // Fonte extra embutida no PDF sem internet (o arquivo .woff também está no cache)
  await addText(page, 'Sem internet');
  await page.getByRole('combobox', { name: 'Fonte' }).selectOption('hand');
  const { bytes } = await downloadPdf(page);
  expect((await baseFonts(bytes)).some((f) => f.startsWith('Caveat-Regular'))).toBe(true);

  // Ferramentas também funcionam offline (pdf-lib e fflate vêm do cache)
  await page.goto('./#/ferramenta/dividir');
  await page.locator('main input[type="file"]').first().setInputFiles(fixture('numbered.pdf'));
  await page.getByRole('button', { name: /Dividir em 2 arquivos/ }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar tudo (ZIP)' }).click();
  expect((await dl).suggestedFilename()).toBe('numbered-dividido.zip');
});
