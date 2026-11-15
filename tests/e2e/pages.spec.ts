// M3 · Páginas: juntar, dividir, organizar, imagens → PDF, PDF → imagens, e páginas dentro do editor.
// Roda nos 3 perfis (computador, Android e iPhone emulados). No celular, as ações usam toque + botões.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { unzipSync } from 'fflate';
import { addText, downloadPdf, fixture, isTouch, openFromHome, pdfText, pointOnPage, tapAt, waitForDoc } from './helpers';

/** Escolhe arquivos no seletor da ferramenta. */
async function choose(page: Page, files: string[]) {
  await page.locator('main input[type="file"]').first().setInputFiles(files.map(fixture));
}

/** Clica no botão e devolve os bytes do arquivo baixado. */
async function downloadFrom(page: Page, name: string | RegExp) {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  const d = await dl;
  const chunks: Buffer[] = [];
  for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
  return { bytes: new Uint8Array(Buffer.concat(chunks)), name: d.suggestedFilename() };
}

async function texts(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (let n = 1; n <= doc.getPageCount(); n++) out.push((await pdfText(bytes, n)).trim());
  return out;
}

const pageCard = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Página ${n}\\b`) });

test('juntar 3 PDFs na ordem escolhida', async ({ page }) => {
  await page.goto('./#/ferramenta/juntar');
  await choose(page, ['numbered.pdf', 'letters.pdf', 'flat-table.pdf']);
  await expect(page.locator('.entry')).toHaveCount(3);
  await expect(page.getByText('9 páginas no total')).toBeVisible();
  // letters.pdf vai para o começo; flat-table sai
  await page.getByRole('button', { name: 'Subir letters.pdf' }).click();
  await page.getByRole('button', { name: 'Remover flat-table.pdf' }).click();
  await page.getByRole('button', { name: 'Juntar 2 PDFs' }).click();
  await expect(page.getByText('Pronto!')).toBeVisible();
  const { bytes, name } = await downloadFrom(page, 'Baixar');
  expect(name).toBe('letters-junto.pdf');
  expect(await texts(bytes)).toEqual(['Letra 1', 'Letra 2', 'Pagina 1', 'Pagina 2', 'Pagina 3', 'Pagina 4', 'Pagina 5']);
});

test('reordenar arrastando (mouse)', async ({ page }) => {
  test.skip(await isTouch(page), 'no celular a ordem muda pelos botões (testados nos outros casos)');
  await page.goto('./#/ferramenta/juntar');
  await choose(page, ['numbered.pdf', 'letters.pdf']);
  const grip = (await page.locator('.entry .grip').nth(1).boundingBox())!;
  const first = (await page.locator('.entry').first().boundingBox())!;
  await page.mouse.move(grip.x + 10, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip.x + 10, first.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.entry .name').first()).toHaveText('1. letters.pdf');
});

test('juntar, organizar (girar, mover, excluir, página em branco) e baixar', async ({ page }) => {
  await page.goto('./#/ferramenta/juntar');
  await choose(page, ['numbered.pdf', 'letters.pdf']);
  await page.getByRole('button', { name: 'Juntar 2 PDFs' }).click();
  await page.getByRole('button', { name: 'Organizar páginas' }).click();
  await expect(page).toHaveURL(/#\/ferramenta\/organizar$/);
  await expect(page.locator('.grid .card')).toHaveCount(7);

  // Exclui as páginas 1 e 2
  await pageCard(page, 1).click();
  await pageCard(page, 2).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await expect(page.locator('.grid .card')).toHaveCount(5);
  // A última (Letra 2) vai uma posição para trás e é girada
  await pageCard(page, 5).click();
  await page.getByRole('button', { name: 'Mover para trás' }).click();
  await page.getByRole('button', { name: 'Girar para a direita' }).click();
  await expect(pageCard(page, 4)).toHaveAttribute('aria-label', /girada 90°/);
  // Página em branco depois dela
  await page.getByRole('button', { name: 'Inserir página em branco' }).click();
  await expect(page.locator('.grid .card')).toHaveCount(6);

  await page.getByRole('button', { name: 'Gerar PDF' }).click();
  const { bytes } = await downloadFrom(page, 'Baixar');
  expect(await texts(bytes)).toEqual(['Pagina 3', 'Pagina 4', 'Pagina 5', 'Letra 2', '', 'Letra 1']);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 0, 0, 90, 0, 0]);
});

test('objetos do editor acompanham as páginas organizadas', async ({ page }) => {
  await openFromHome(page, 'flat-table.pdf');
  await addText(page, 'Escrito na um');
  const edited = await downloadPdf(page);

  await page.goto('./#/ferramenta/organizar');
  await page.locator('main input[type="file"]').first().setInputFiles({ name: edited.name, mimeType: 'application/pdf', buffer: Buffer.from(edited.bytes) });
  await pageCard(page, 2).click();
  await page.getByRole('button', { name: 'Mover para trás' }).click();
  await page.getByRole('button', { name: 'Gerar PDF' }).click();
  await page.getByRole('button', { name: 'Abrir no editor' }).click();
  await waitForDoc(page);
  await expect(page.locator('#status')).toContainText('1 objeto continua editável');

  const out = await downloadPdf(page);
  const pages = await texts(out.bytes);
  expect(pages[0]).not.toContain('Escrito na um');
  expect(pages[1]).toContain('Escrito na um');
});

test('dividir por intervalos (ZIP) e extrair páginas', async ({ page }) => {
  await page.goto('./#/ferramenta/dividir');
  await choose(page, ['numbered.pdf']);
  await page.getByLabel('Intervalos', { exact: true }).fill('1-2, 4');
  await page.getByRole('button', { name: 'Dividir em 2 arquivos' }).click();
  const zip = await downloadFrom(page, 'Baixar tudo (ZIP)');
  expect(zip.name).toBe('numbered-dividido.zip');
  const files = unzipSync(zip.bytes);
  expect(Object.keys(files).sort()).toEqual(['numbered-p1-2.pdf', 'numbered-p4.pdf']);
  expect(await texts(files['numbered-p1-2.pdf'])).toEqual(['Pagina 1', 'Pagina 2']);
  expect(await texts(files['numbered-p4.pdf'])).toEqual(['Pagina 4']);

  // Intervalo inválido avisa e não deixa continuar
  await page.getByRole('button', { name: 'Recomeçar' }).click();
  await choose(page, ['numbered.pdf']);
  await page.getByLabel('Intervalos', { exact: true }).fill('2, 9');
  await expect(page.getByText('A página 9 não existe')).toBeVisible();

  // Escolher páginas → um PDF só
  await page.getByText('Escolher páginas').click();
  await pageCard(page, 2).click();
  await pageCard(page, 5).click();
  await page.getByRole('button', { name: 'Extrair páginas' }).click();
  const one = await downloadFrom(page, 'Baixar');
  expect(one.name).toBe('numbered-extraidas.pdf');
  expect(await texts(one.bytes)).toEqual(['Pagina 2', 'Pagina 5']);
  await expect(page.getByRole('button', { name: 'Abrir no editor' })).toBeVisible();
});

test('uma página por arquivo', async ({ page }) => {
  await page.goto('./#/ferramenta/dividir');
  await choose(page, ['letters.pdf']);
  await page.getByText('Uma página por arquivo').click();
  await page.getByRole('button', { name: 'Dividir em 2 arquivos' }).click();
  const zip = await downloadFrom(page, 'Baixar tudo (ZIP)');
  expect(Object.keys(unzipSync(zip.bytes)).sort()).toEqual(['letters-p1.pdf', 'letters-p2.pdf']);
});

test('imagens para PDF', async ({ page }) => {
  await page.goto('./#/ferramenta/imagens-para-pdf');
  await page.locator('main input[type="file"][multiple]').setInputFiles([fixture('image.png'), fixture('wide.png')]);
  await expect(page.locator('.card')).toHaveCount(2);
  // A imagem larga vai primeiro; margem grande
  await page.getByRole('button', { name: 'Mover a imagem 2 para antes' }).click();
  await page.getByText('Grande').click();
  await page.getByRole('button', { name: 'Gerar PDF' }).click();
  const { bytes, name } = await downloadFrom(page, 'Baixar');
  expect(name).toBe('imagens.pdf');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
  // Orientação automática: as duas imagens são mais largas que altas → páginas A4 deitadas
  expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([842, 842]);

  // Arquivo que não é imagem é recusado com aviso
  await page.getByRole('button', { name: 'Recomeçar' }).click();
  await page.locator('main input[type="file"][multiple]').setInputFiles([fixture('letters.pdf')]);
  await expect(page.getByRole('alert')).toContainText('Não foi possível usar');
});

test('PDF para imagens (PNG e JPG)', async ({ page }) => {
  await page.goto('./#/ferramenta/pdf-para-imagens');
  await choose(page, ['numbered.pdf']);
  await page.getByText('PNG (sem perdas)').click();
  await page.getByText('Escolher', { exact: true }).click();
  await page.getByLabel('Páginas a converter').fill('1, 3');
  await page.getByRole('button', { name: 'Converter 2 páginas' }).click();
  const zip = await downloadFrom(page, 'Baixar tudo (ZIP)');
  const files = unzipSync(zip.bytes);
  expect(Object.keys(files).sort()).toEqual(['numbered-pagina-1.png', 'numbered-pagina-3.png']);
  const png = files['numbered-pagina-3.png'];
  expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  // Página 3 é paisagem: largura > altura (cabeçalho IHDR)
  const dv = new DataView(png.buffer, png.byteOffset);
  expect(dv.getUint32(16)).toBeGreaterThan(dv.getUint32(20));

  await page.getByRole('button', { name: 'Recomeçar' }).click();
  await choose(page, ['letters.pdf']);
  await page.getByText('JPG (menor)').click(); // o formato escolhido antes continua valendo
  await page.getByRole('button', { name: 'Converter 2 páginas' }).click();
  const jpgs = unzipSync((await downloadFrom(page, 'Baixar tudo (ZIP)')).bytes);
  const jpg = Object.values(jpgs)[0];
  expect(Object.keys(jpgs)).toHaveLength(2);
  expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]);
});

/** Abre o “Organizar páginas” do editor (no celular fica no menu ⋮). */
async function openEditorOrganizer(page: Page) {
  const direct = page.locator('aside.thumbs').getByRole('button', { name: 'Organizar páginas' });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole('button', { name: 'Mais opções' }).click();
    await page.getByRole('menuitem', { name: 'Organizar páginas' }).click();
  }
  await expect(page.getByRole('dialog', { name: 'Organizar páginas' })).toBeVisible();
}

test('organizar páginas dentro do editor: objetos acompanham e dá para desfazer', async ({ page }) => {
  await openFromHome(page, 'numbered.pdf');
  // Escreve na página 2
  await page.evaluate(() => document.querySelectorAll('.pdfViewer .page')[1].scrollIntoView());
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  const p = await pointOnPage(page, 0.3, 0.3, 1);
  await tapAt(page, p.x, Math.max(p.y, 200));
  await page.locator('.tbox.editing .tcontent').waitFor();
  await page.keyboard.type('Nota da dois');
  await page.keyboard.press('Escape');

  await openEditorOrganizer(page);
  const dialog = page.getByRole('dialog', { name: 'Organizar páginas' });
  await dialog.getByRole('button', { name: /^Página 1\b/ }).click();
  await dialog.getByRole('button', { name: 'Excluir' }).click();
  await dialog.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.locator('#status')).toContainText('agora são 4');
  await expect(page.locator('.title small')).toContainText('4 páginas');

  const out = await downloadPdf(page);
  const pages = await texts(out.bytes);
  expect(pages).toHaveLength(4);
  expect(pages[0]).toContain('Pagina 2');
  expect(pages[0]).toContain('Nota da dois');

  // Desfazer volta as 5 páginas, com o texto na página 2
  await page.locator('#status').getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('.title small')).toContainText('5 páginas');
  const back = await texts((await downloadPdf(page)).bytes);
  expect(back[1]).toContain('Nota da dois');
});

test('texto em página girada sai em pé no PDF', async ({ page }) => {
  await openFromHome(page, 'rotated.pdf');
  await addText(page, 'Em pe', 0.3, 0.3);
  const box = (await page.locator('.tbox').boundingBox())!;
  expect(box.width).toBeGreaterThan(box.height); // a caixa aparece deitada na tela, como o texto
  const { bytes } = await downloadPdf(page);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pg = await pdf.getPage(1);
  const item = (await pg.getTextContent()).items.find((i) => 'str' in i && i.str === 'Em pe') as { transform: number[] };
  // Texto girado 90° no PDF; a página tem /Rotate 90 → para quem lê, fica em pé
  expect(item.transform[0]).toBeCloseTo(0);
  expect(item.transform[1]).toBeGreaterThan(0);
  expect(pg.rotate).toBe(90);
});
