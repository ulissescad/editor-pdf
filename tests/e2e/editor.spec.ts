import { expect, test } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { openFromHome, readDownload } from './helpers';

test('PDF sem campos: avisa e sugere inserir texto', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await expect(page.locator('#status')).toContainText('não tem campos de formulário');
  await expect(page.locator('.pdfViewer .page')).toHaveCount(2);
});

test('formulário: preencher campo + caixa de texto e baixar com tudo gravado', async ({ page }) => {
  await openFromHome(page, 'form.pdf');
  await expect(page.locator('#status')).toContainText('3 campos editáveis');

  // Campo de formulário
  await page.locator('.annotationLayer input[type="text"]').first().fill('Maria da Silva');

  // Caixa de texto: liga o modo e clica na página
  await page.locator('#textMode').click();
  const pageBox = (await page.locator('.pdfViewer .page').first().boundingBox())!;
  const viewportH = page.viewportSize()!.height;
  // Um ponto dentro da página e dentro da área visível (no computador a página é maior que a tela)
  const y = Math.min(pageBox.y + pageBox.height * 0.45, viewportH - 120);
  await page.mouse.click(pageBox.x + pageBox.width * 0.15, y);
  await page.keyboard.type('Observação: ação concluída');
  await expect(page.locator('.tbox')).toHaveCount(1);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('form-preenchido.pdf');

  const bytes = await readDownload(download);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getForm().getTextField('nome').getText()).toBe('Maria da Silva');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
  expect(text).toContain('Observação: ação concluída');
});
