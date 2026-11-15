import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { baseFonts } from '../pdf-inspect';
import { addText, downloadPdf, fixture, isTouch, openFromHome, openInEditor, pdfText, pointOnPage, tapAt, waitForDoc } from './helpers';

const count = (s: string, sub: string) => s.split(sub).length - 1;

async function moreMenu(page: Page, item: RegExp) {
  if (await page.getByRole('button', { name: 'Mais opções' }).isVisible()) {
    await page.getByRole('button', { name: 'Mais opções' }).click();
    await page.getByRole('menuitem', { name: item }).click();
    return true;
  }
  return false;
}

test('PDF sem campos: avisa, mostra as páginas e o indicador de página', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await expect(page.locator('#status')).toContainText('não tem campos de formulário');
  await expect(page.locator('.pdfViewer .page')).toHaveCount(2);
  await expect(page.locator('.page-badge')).toHaveText('1 / 2');
});

test('formulário + caixa de texto: tudo gravado no PDF baixado', async ({ page }) => {
  await openFromHome(page, 'form.pdf');
  await page.locator('.annotationLayer input[type="text"]').first().fill('Maria da Silva');
  await addText(page, 'Observação: ação concluída');
  await expect(page.locator('.tbox')).toHaveCount(1);

  const { bytes, name } = await downloadPdf(page);
  expect(name).toBe('form-editado.pdf');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getForm().getTextField('nome').getText()).toBe('Maria da Silva');
  expect(await pdfText(bytes)).toContain('Observação: ação concluída');
});

test('formatação: fonte, tamanho, negrito, alinhamento e cor vão para o PDF', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await addText(page, 'Texto formatado');
  await page.getByRole('combobox', { name: 'Fonte' }).selectOption('serif');
  await page.getByRole('button', { name: 'Aumentar fonte' }).click();
  await page.getByRole('button', { name: 'Negrito' }).click();
  await page.getByRole('button', { name: 'Centralizar' }).click();
  await page.getByRole('button', { name: 'Cor #c62828' }).click();

  const content = page.locator('.tbox .tcontent');
  await expect(content).toHaveCSS('font-weight', '700');
  await expect(content).toHaveCSS('text-align', 'center');
  await expect(content).toHaveCSS('color', 'rgb(198, 40, 40)');

  const { bytes } = await downloadPdf(page);
  expect(await pdfText(bytes)).toContain('Texto formatado');
  expect(await baseFonts(bytes)).toContain('Times-Bold');
});

test('desfazer, refazer, duplicar e excluir', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await addText(page, 'Caixa');
  const boxes = page.locator('.tbox');
  await expect(boxes).toHaveCount(1);
  await page.keyboard.press('Control+d');
  await expect(boxes).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(boxes).toHaveCount(1);
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(boxes).toHaveCount(2);
  await page.getByRole('button', { name: 'Refazer' }).click();
  await expect(boxes).toHaveCount(1);
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.getByRole('button', { name: 'Desfazer' }).click(); // desfaz a duplicação
  await expect(boxes).toHaveCount(1);
});

test('mover e redimensionar a caixa', async ({ page }) => {
  test.skip(await isTouch(page), 'arraste com mouse; o toque é coberto no teste de criação');
  await openFromHome(page, 'flat-table.pdf');
  await addText(page, 'Mover');
  const box = page.locator('.tbox');
  const before = (await box.boundingBox())!;
  // arrasta pela alça “mover”
  const grip = (await page.locator('.tbox .grip').boundingBox())!;
  await page.mouse.move(grip.x + 10, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip.x + 70, grip.y + 50, { steps: 5 });
  await page.mouse.up();
  const moved = (await box.boundingBox())!;
  expect(moved.x - before.x).toBeGreaterThan(50);
  expect(moved.y - before.y).toBeGreaterThan(30);
  // alarga pela alça da direita
  const e = (await page.locator('.tbox .handle[data-h="e"]').boundingBox())!;
  await page.mouse.move(e.x + 5, e.y + 5);
  await page.mouse.down();
  await page.mouse.move(e.x + 105, e.y + 5, { steps: 5 });
  await page.mouse.up();
  expect((await box.boundingBox())!.width - moved.width).toBeGreaterThan(80);
});

test('rascunho automático: fechar e continuar de onde parou', async ({ page }) => {
  await openFromHome(page, 'form.pdf');
  await page.locator('.annotationLayer input[type="text"]').first().fill('Rascunho Silva');
  await addText(page, 'Não perder isto');
  await expect(page.getByText('Salvo neste aparelho')).toBeVisible();

  await page.goto('./');
  await page.locator('.drafts .open', { hasText: 'form.pdf' }).click();
  await waitForDoc(page);
  await expect(page.getByText(/Rascunho de .* restaurado/)).toBeVisible();
  await expect(page.locator('.tbox .tcontent')).toHaveText('Não perder isto');
  await expect(page.locator('.annotationLayer input[type="text"]').first()).toHaveValue('Rascunho Silva');

  // Começar do zero descarta o rascunho
  await page.getByRole('button', { name: 'Começar do zero' }).click();
  await expect(page.locator('.tbox')).toHaveCount(0);
  await expect(page.locator('.annotationLayer input[type="text"]').first()).toHaveValue('');
});

test('PDF reeditável: reabrir o PDF baixado e continuar editando sem duplicar', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await addText(page, 'Versão um');
  const first = await downloadPdf(page);
  expect(count(await pdfText(first.bytes), 'Versão um')).toBe(1);

  await openInEditor(page, { name: first.name, bytes: first.bytes });
  await expect(page.locator('#status')).toContainText('1 texto(s) continuam editáveis');
  await expect(page.locator('.tbox .tcontent')).toHaveText('Versão um');

  // edita: entra na caixa e acrescenta texto
  const b = (await page.locator('.tbox').boundingBox())!;
  await tapAt(page, b.x + b.width - 4, b.y + b.height / 2);
  await page.locator('.tbox.editing').waitFor();
  await page.keyboard.press('End');
  await page.keyboard.type(' e dois');
  await page.keyboard.press('Escape');

  const second = await downloadPdf(page);
  expect(second.name).toBe('flat-table-editado.pdf');
  const text = await pdfText(second.bytes);
  expect(count(text, 'Versão um e dois')).toBe(1);
  expect(count(text, 'Versão um')).toBe(1); // a versão antiga não ficou por baixo
});

test('arquivo sem extensão .pdf é reconhecido pelo conteúdo', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await openInEditor(page, { name: 'documento-sem-extensao', bytes: (await downloadPdf(page)).bytes });
  await expect(page.locator('.title strong')).toHaveText('documento-sem-extensao.pdf');
});

test('busca no documento', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  // No computador o botão fica no topo; no celular, na barra inferior (só um deles está visível)
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar no documento' }).fill('Regente');
  await expect(page.locator('.search .result')).toHaveText('1 de 2');
  await page.getByRole('button', { name: 'Próximo resultado' }).click();
  await expect(page.locator('.search .result')).toHaveText('2 de 2');
  await expect(page.locator('.page-badge')).toHaveText('2 / 2');
});

test('miniaturas levam à página escolhida', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  if (!(await page.locator('aside.thumbs').isVisible())) await page.getByRole('button', { name: 'Páginas' }).click();
  await page.getByRole('button', { name: 'Ir para a página 2' }).click();
  await expect(page.locator('.page-badge')).toHaveText('2 / 2');
});

test('caixa acompanha a página no zoom', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await addText(page, 'Zoom');
  const rel = async () => {
    const p = (await page.locator('.pdfViewer .page').first().boundingBox())!;
    const b = (await page.locator('.tbox').boundingBox())!;
    return [(b.x - p.x) / p.width, (b.width) / p.width];
  };
  const before = await rel();
  const pageWidth = async () => (await page.locator('.pdfViewer .page').first().boundingBox())!.width;
  const w0 = await pageWidth();
  // Ctrl + roda (mesmo caminho da pinça no trackpad). Disparado direto no visualizador porque o
  // WebKit móvel do Playwright não simula roda de mouse; funciona igual nos três perfis.
  await page.locator('.viewer-container').evaluate((c) => {
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 3, bubbles: true, cancelable: true }));
  });
  await expect.poll(pageWidth).toBeGreaterThan(w0 * 1.1);
  await page.waitForTimeout(600); // fim do redesenho
  const after = await rel();
  expect(Math.abs(after[0] - before[0])).toBeLessThan(0.01);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(0.01);
});

test('pinça com dois dedos aumenta o zoom (celular)', async ({ page, browserName }) => {
  test.skip(!(await isTouch(page)), 'só em telas de toque');
  test.skip(browserName === 'webkit', 'o WebKit do Playwright não permite criar eventos de toque sintéticos (new Touch)');
  await openFromHome(page, 'flat-table.pdf');
  const w0 = (await page.locator('.pdfViewer .page').first().boundingBox())!.width;
  await page.evaluate(async () => {
    const c = document.querySelector('.viewer-container')!;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const touches = (d: number) => [0, 1].map((i) => new Touch({ identifier: i, target: c, clientX: cx + (i ? d : -d), clientY: cy }));
    c.dispatchEvent(new TouchEvent('touchstart', { touches: touches(40), bubbles: true }));
    for (let d = 45; d <= 100; d += 5) {
      c.dispatchEvent(new TouchEvent('touchmove', { touches: touches(d), bubbles: true, cancelable: true }));
      await new Promise((res) => setTimeout(res, 16));
    }
    c.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
  });
  await expect.poll(async () => (await page.locator('.pdfViewer .page').first().boundingBox())!.width).toBeGreaterThan(w0 * 1.5);
});

test('imprimir prepara todas as páginas', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await page.evaluate(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++; }; });
  if (!(await moreMenu(page, /Imprimir/))) await page.getByRole('button', { name: 'Imprimir' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  await expect(page.locator('#print-root img')).toHaveCount(2);
});

test('arrastar e soltar outro PDF no editor troca o documento', async ({ page }) => {
  test.skip(await isTouch(page), 'arrastar arquivos é do computador');
  await openFromHome(page, 'flat-table.pdf');
  await openInEditor(page, fixture('form.pdf'));
  await expect(page.locator('.pdfViewer .page')).toHaveCount(1);
  await expect(page.locator('.title strong')).toHaveText('form.pdf');
});

test('toque na página com a ferramenta Texto cria a caixa (celular)', async ({ page }) => {
  test.skip(!(await isTouch(page)), 'só em telas de toque');
  await openFromHome(page, 'flat-table.pdf');
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  const p = await pointOnPage(page, 0.3, 0.3);
  await page.touchscreen.tap(p.x, p.y);
  await expect(page.locator('.tbox.editing')).toHaveCount(1);
  await page.keyboard.type('Pelo toque');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tbox .tcontent')).toHaveText('Pelo toque');
  // a barra de formatação aparece acima das ferramentas e não cria rolagem lateral
  await expect(page.getByRole('toolbar', { name: 'Formatação do texto' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
