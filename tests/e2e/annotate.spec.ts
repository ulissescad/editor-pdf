// M4 · Anotar: destacar/sublinhar/riscar pela geometria do texto, caneta, formas, corretivo e notas.
import { expect, test, type Page } from '@playwright/test';
import { downloadPdf, openFromHome, openInEditor, pdfText, tapAt } from './helpers';

const tool = (page: Page, name: string) => page.locator('nav.tools').getByRole('button', { name, exact: true });
const props = (page: Page) => page.locator('aside.props');

/** Caixa da página n na tela, depois que o layout parou de mudar (painéis abrindo mudam o zoom). */
async function stableBox(page: Page, n = 0) {
  const loc = page.locator('.pdfViewer .page').nth(n);
  let prev = await loc.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const cur = await loc.boundingBox();
    if (prev && cur && Math.abs(cur.width - prev.width) < 0.5 && Math.abs(cur.y - prev.y) < 0.5) return cur;
    prev = cur;
  }
  return prev!;
}

/** Ponto do PDF (pt, origem embaixo à esquerda, página A4 sem giro) → ponto na tela. */
async function at(page: Page, x: number, y: number, n = 0) {
  const box = await stableBox(page, n);
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + (842 - y) * s };
}

async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, steps = 12) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function annotations(bytes: Uint8Array, n = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  return (await (await pdf.getPage(n)).getAnnotations()).map((a) => ({ subtype: a.subtype as string, text: a.contentsObj?.str as string }));
}

// Linhas do text.pdf: base em y = 760, 736 e 712; texto em Helvetica 16 a partir de x = 60
const LINE1 = 765, LINE2 = 741, LINE3 = 717;

test('destacar arrastando sobre o texto vira anotação Highlight e volta editável', async ({ page }) => {
  await openFromHome(page, 'text.pdf');
  await tool(page, 'Destacar').click();
  await drag(page, await at(page, 62, LINE1), await at(page, 150, LINE2));
  await expect(page.locator('.mbox')).toHaveCount(1);
  await expect(page.locator('.mbox')).toHaveAttribute('aria-label', /^Destaque: Primeira linha do texto.*Segunda/);

  const out = await downloadPdf(page);
  const ann = await annotations(out.bytes);
  expect(ann.map((a) => a.subtype)).toEqual(['Highlight']);
  expect(ann[0].text).toMatch(/^Primeira linha do texto para destacar com o dedo\. Segunda/);
  expect(await pdfText(out.bytes)).toContain('Primeira linha'); // o texto continua lá, só marcado

  // Reabrir: o destaque volta como objeto, e baixar de novo não duplica a anotação
  await openInEditor(page, { name: out.name, bytes: out.bytes });
  await expect(page.locator('#status')).toContainText('1 objeto continua editável');
  await expect(page.locator('.mbox')).toHaveCount(1);
  const again = await downloadPdf(page);
  expect((await annotations(again.bytes)).map((a) => a.subtype)).toEqual(['Highlight']);
});

test('um toque numa palavra sublinha a palavra; riscar e trocar a cor depois', async ({ page }) => {
  await openFromHome(page, 'text.pdf');
  await tool(page, 'Destacar').click();
  await props(page).getByRole('button', { name: 'Sublinhar' }).click();
  const p = await at(page, 85, LINE3);
  await tapAt(page, p.x, p.y);
  await expect(page.locator('.mbox')).toHaveAttribute('aria-label', 'Sublinhado: Terceira');

  await props(page).getByRole('button', { name: 'Riscar' }).click();
  await drag(page, await at(page, 62, LINE2), await at(page, 120, LINE2));
  await expect(page.locator('.mbox')).toHaveCount(2);

  // Selecionar o riscado e trocar a cor
  await tool(page, 'Selecionar').click();
  const strike = page.locator('.mbox').nth(1);
  const hit = (await strike.locator('.hit').first().boundingBox())!;
  await tapAt(page, hit.x + hit.width / 2, hit.y + hit.height / 2);
  await expect(strike).toHaveClass(/selected/);
  await props(page).getByRole('button', { name: 'Cor #000000' }).click();

  const ann = await annotations((await downloadPdf(page)).bytes);
  expect(ann.map((a) => a.subtype).sort()).toEqual(['StrikeOut', 'Underline']);
  expect(ann.find((a) => a.subtype === 'Underline')!.text).toBe('Terceira');
});

test('fora do texto, destacar desenha um retângulo (PDF digitalizado)', async ({ page }) => {
  await openFromHome(page, 'text.pdf');
  await tool(page, 'Destacar').click();
  await drag(page, await at(page, 200, 500), await at(page, 400, 450));
  await expect(page.locator('.mbox')).toHaveCount(1);
  const ann = await annotations((await downloadPdf(page)).bytes);
  expect(ann.map((a) => a.subtype)).toEqual(['Highlight']);
});

test('caneta, seta, corretivo e nota vão para o PDF; a nota é uma anotação com o comentário', async ({ page }) => {
  await openFromHome(page, 'text.pdf');

  await tool(page, 'Caneta').click();
  await drag(page, await at(page, 100, 600), await at(page, 250, 560));
  await drag(page, await at(page, 100, 580), await at(page, 250, 590)); // logo depois: mesmo objeto
  await expect(page.locator('.obox.ink')).toHaveCount(1);

  await tool(page, 'Formas').click();
  await props(page).getByRole('button', { name: 'Seta' }).click();
  await drag(page, await at(page, 100, 450), await at(page, 300, 400));
  await props(page).getByRole('button', { name: 'Corretivo' }).click();
  await drag(page, await at(page, 58, LINE3 + 12), await at(page, 380, LINE3 - 8));
  await expect(page.locator('.obox.shape')).toHaveCount(2);

  await tool(page, 'Nota').click();
  const n = await at(page, 450, 760);
  await tapAt(page, n.x, n.y);
  const note = page.getByLabel('Texto da nota');
  await expect(note).toBeFocused();
  await note.fill('Revisar este parágrafo');
  await note.press('Escape');
  await expect(page.locator('.obox.note')).toHaveAttribute('aria-label', 'Nota: Revisar este parágrafo');

  const out = await downloadPdf(page);
  const ann = await annotations(out.bytes);
  expect(ann).toEqual([{ subtype: 'Text', text: 'Revisar este parágrafo' }]);

  await openInEditor(page, { name: out.name, bytes: out.bytes });
  await expect(page.locator('#status')).toContainText('4 objetos continuam editáveis');
  await expect(page.locator('.obox.ink')).toHaveCount(1);
  await expect(page.locator('.obox.shape')).toHaveCount(2);
  await expect(page.locator('.obox.note')).toHaveCount(1);
});

test('nota vazia some ao fechar; desfazer remove o último traço', async ({ page }) => {
  await openFromHome(page, 'text.pdf');
  await tool(page, 'Nota').click();
  const n = await at(page, 450, 600);
  await tapAt(page, n.x, n.y);
  await expect(page.getByLabel('Texto da nota')).toBeFocused();
  await page.getByLabel('Texto da nota').press('Escape');
  await tool(page, 'Selecionar').click();
  await expect(page.locator('.obox.note')).toHaveCount(0);

  await tool(page, 'Caneta').click();
  await drag(page, await at(page, 100, 600), await at(page, 250, 560));
  await expect(page.locator('.obox.ink')).toHaveCount(1);
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('.obox.ink')).toHaveCount(0);
});

test('celular: um dedo desenha com a caneta, sem rolar a página', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'toque real via CDP só no Chromium emulando celular');
  await openFromHome(page, 'text.pdf');
  await tool(page, 'Caneta').click();
  const scroller = page.locator('.viewer-container');
  const before = await scroller.evaluate((el) => el.scrollTop);
  const a = await at(page, 100, 600), b = await at(page, 300, 500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 10; i++) {
    const x = a.x + ((b.x - a.x) * i) / 10, y = a.y + ((b.y - a.y) * i) / 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.obox.ink')).toHaveCount(1);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
});
