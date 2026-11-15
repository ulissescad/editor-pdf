// M2 · Preencher e assinar: assinatura, imagem, símbolos, data, detecção e criação de campos.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { downloadPdf, fixture, openFromHome, openInEditor, pdfText, pointOnPage, tapAt, waitForDoc } from './helpers';

/** Quantas imagens são desenhadas na página n (1-based) do PDF. */
async function imageDraws(bytes: Uint8Array, n = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const { fnArray } = await (await pdf.getPage(n)).getOperatorList();
  return fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
}

const tool = (page: Page, name: string) => page.locator('nav.tools').getByRole('button', { name, exact: true });

/** Desenha um rabisco na área de assinatura (mouse; no celular emulado vira ponteiro igual). */
async function scribble(page: Page) {
  const pad = (await page.getByLabel('Área para desenhar a assinatura').boundingBox())!;
  const pts = [[0.15, 0.7], [0.3, 0.3], [0.45, 0.75], [0.6, 0.35], [0.85, 0.6]];
  await page.mouse.move(pad.x + pad.width * pts[0][0], pad.y + pad.height * pts[0][1]);
  await page.mouse.down();
  for (const [fx, fy] of pts.slice(1)) await page.mouse.move(pad.x + pad.width * fx, pad.y + pad.height * fy, { steps: 8 });
  await page.mouse.up();
}

test('assinar desenhando: vai para o PDF e volta editável ao reabrir', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await tool(page, 'Assinar').click();
  const dialog = page.getByRole('dialog', { name: 'Assinatura' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Usar' })).toBeDisabled();
  await scribble(page);
  await dialog.getByRole('button', { name: 'Usar' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.obox.image')).toHaveCount(1);

  const out = await downloadPdf(page);
  expect(await imageDraws(out.bytes)).toBe(1);

  await openInEditor(page, { name: out.name, bytes: out.bytes });
  await expect(page.locator('#status')).toContainText('1 objeto continua editável');
  await expect(page.locator('.obox.image')).toHaveCount(1);
  const again = await downloadPdf(page);
  expect(await imageDraws(again.bytes)).toBe(1); // não duplica
});

test('assinatura digitada fica guardada no aparelho e pode ser reutilizada', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await tool(page, 'Assinar').click();
  const dialog = page.getByRole('dialog', { name: 'Assinatura' });
  await dialog.getByRole('tab', { name: 'Digitar' }).click();
  await dialog.getByPlaceholder('Digite seu nome').fill('Maria da Conceição');
  await dialog.getByRole('radio').nth(1).click();
  await dialog.getByRole('button', { name: 'Usar' }).click();
  await expect(page.locator('.obox.image')).toHaveCount(1);

  await tool(page, 'Assinar').click();
  await dialog.getByRole('button', { name: 'Usar assinatura guardada' }).first().click();
  await expect(page.locator('.obox.image')).toHaveCount(2);

  // Apagar a guardada
  await tool(page, 'Assinar').click();
  await dialog.getByRole('button', { name: 'Apagar assinatura guardada' }).first().click();
  await expect(dialog.getByRole('button', { name: 'Usar assinatura guardada' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(dialog).toBeHidden();
});

test('assinatura por foto: o fundo do papel é removido', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await tool(page, 'Assinar').click();
  const dialog = page.getByRole('dialog', { name: 'Assinatura' });
  await dialog.getByRole('tab', { name: 'Foto' }).click();
  // “Foto” sintética: papel acinzentado com um traço azul-escuro
  const jpg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 500;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ddd8cf'; x.fillRect(0, 0, 900, 500);
    x.strokeStyle = '#1d2a6b'; x.lineWidth = 8; x.lineCap = 'round';
    x.beginPath(); x.moveTo(150, 320); x.bezierCurveTo(250, 100, 400, 420, 500, 220); x.lineTo(750, 260); x.stroke();
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /Tirar foto ou escolher imagem/ }).click();
  await (await chooser).setFiles({ name: 'assinatura.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) });
  const preview = dialog.getByLabel('Assinatura sem o fundo');
  await expect(preview).toBeVisible();
  // O resultado foi recortado no traço e o papel ficou transparente
  const info = await preview.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let transparent = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 0) transparent++;
    return { w: c.width, h: c.height, transparent: transparent / (d.length / 4) };
  });
  expect(info.w).toBeLessThan(700);
  expect(info.transparent).toBeGreaterThan(0.6);
  await dialog.getByRole('button', { name: 'Usar' }).click();
  await expect(page.locator('.obox.image')).toHaveCount(1);
});

test('imagem do aparelho entra no PDF', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Imagem').click();
  await (await chooser).setFiles(fixture('image.png'));
  await expect(page.locator('.obox.image')).toHaveCount(1);
  const out = await downloadPdf(page);
  expect(await imageDraws(out.bytes)).toBe(1);
});

test('símbolos e data de hoje', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await tool(page, 'Símbolos').click();
  let p = await pointOnPage(page, 0.3, 0.25);
  await tapAt(page, p.x, p.y);
  await expect(page.locator('.obox.symbol')).toHaveCount(1);
  await page.getByRole('button', { name: 'Xis' }).click(); // troca o selecionado
  await expect(page.locator('.obox.symbol')).toHaveAttribute('aria-label', 'Símbolo xis');

  await page.keyboard.press('Escape'); // tira a seleção (um toque na página colocaria outro símbolo)
  await page.getByRole('button', { name: 'Data de hoje' }).click();
  p = await pointOnPage(page, 0.3, 0.35);
  await tapAt(page, p.x, p.y);
  const d = new Date();
  const hoje = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  await expect(page.locator('.tbox .tcontent')).toHaveText(hoje);

  const out = await downloadPdf(page);
  expect(await pdfText(out.bytes)).toContain(hoje);
  await openInEditor(page, { name: out.name, bytes: out.bytes });
  await expect(page.locator('.obox.symbol')).toHaveCount(1);
});

test('PDF sem formulário: detectar campos, preencher e baixar um PDF preenchível', async ({ page }) => {
  await openFromHome(page, 'pei-like.pdf');
  await page.locator('#status').getByRole('button', { name: 'Detectar campos' }).click();
  await expect(page.locator('#status')).toContainText('28 campo(s) encontrado(s)');
  await expect(page.locator('.obox.field')).toHaveCount(28);

  // Preenche o primeiro campo e marca “Sim”
  const first = page.locator('.obox.field').first();
  const b = (await first.boundingBox())!;
  await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('.obox.field.editing .fvalue').waitFor();
  await page.keyboard.type('Escola Municipal');
  await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: 'Campo sim' }).first().click();
  await expect(page.getByRole('checkbox', { name: 'Campo sim' }).first()).toHaveAttribute('aria-checked', 'true');

  const out = await downloadPdf(page);
  const form = (await PDFDocument.load(out.bytes)).getForm();
  expect(form.getFields()).toHaveLength(28);
  expect(form.getTextField('nome_completo_da_instituicao').getText()).toBe('Escola Municipal');
  expect(form.getCheckBox('sim').isChecked()).toBe(true);

  // Reaberto, o PDF já tem formulário: os campos aparecem preenchíveis pelo pdf.js
  await openInEditor(page, { name: out.name, bytes: out.bytes });
  await expect(page.locator('.obox.field')).toHaveCount(0);
  await expect(page.locator('.annotationLayer input[type="text"]').first()).toHaveValue('Escola Municipal');
  await expect(page.getByText('não tem campos de formulário')).toHaveCount(0);
});

test('criar um campo com a ferramenta Campos e dar nome a ele', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await tool(page, 'Campos').click();
  const p = await pointOnPage(page, 0.3, 0.6);
  await tapAt(page, p.x, p.y);
  await expect(page.locator('.obox.field')).toHaveCount(1);
  const name = page.getByLabel('Nome do campo');
  await name.fill('telefone');
  await name.press('Enter');
  await expect(page.locator('.obox.field')).toHaveAttribute('aria-label', 'Campo telefone');

  const out = await downloadPdf(page);
  expect((await PDFDocument.load(out.bytes)).getForm().getTextField('telefone')).toBeTruthy();
});

test('ferramenta “Assinar PDF” da página inicial abre o editor com a assinatura', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: /Assinar PDF/ }).click();
  await expect(page.getByRole('heading', { name: 'Assinar PDF' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Escolher PDF para assinar' }).click();
  await (await chooser).setFiles(fixture('flat-table.pdf'));
  await page.waitForURL(/#\/editor$/);
  await waitForDoc(page);
  await expect(page.getByRole('dialog', { name: 'Assinatura' })).toBeVisible();
});
