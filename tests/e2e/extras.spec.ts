// M6 · Opcionais: digitalizar, comparar e receber arquivos de outros apps.
// Roda nos 3 perfis (computador, Android e iPhone emulados); o que depende de service worker e de
// recursos só do Chromium fica de fora no WebKit.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { fixture, pdfText, waitForDoc, watchNetwork } from './helpers';

type Pt = [number, number];

async function download(page: Page, name: RegExp) {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  const d = await dl;
  const chunks: Buffer[] = [];
  for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
  return { bytes: new Uint8Array(Buffer.concat(chunks)), name: d.suggestedFilename() };
}

const pdfInput = (name: string, bytes: Uint8Array) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });

// ---------------------------------------------------------------- Digitalizar

const PHOTO = { w: 1200, h: 1600 };
// Onde a folha está na foto: inclinada, como numa foto feita à mão
const SHEET: [Pt, Pt, Pt, Pt] = [[260, 180], [980, 260], [1060, 1380], [140, 1290]];

/** Foto sintética: fundo escuro, folha branca em perspectiva, faixa vermelha no topo e linhas de “texto”. */
async function photo(page: Page): Promise<Buffer> {
  await page.goto('./');
  const url = await page.evaluate(({ w, h, q }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(0, 0, w, h);
    const at = (u: number, v: number) => {
      const top = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u];
      const bot = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u];
      return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
    };
    const poly = (color: string, u0: number, u1: number, v0: number, v1: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) ctx.lineTo(...(at(u, v) as [number, number]));
      ctx.closePath();
      ctx.fill();
    };
    poly('#e9e6df', 0, 1, 0, 1);
    poly('#c0261f', 0.1, 0.9, 0.05, 0.13);
    for (let i = 0; i < 12; i++) poly('#222', 0.1, 0.9, 0.2 + i * 0.06, 0.225 + i * 0.06);
    return c.toDataURL('image/jpeg', 0.92);
  }, { w: PHOTO.w, h: PHOTO.h, q: SHEET });
  return Buffer.from(url.split(',')[1], 'base64');
}

/** Arrasta um canto até o ponto (em pixels da foto). */
async function dragCorner(page: Page, name: string, [x, y]: Pt) {
  const handle = page.getByRole('button', { name: `Canto ${name}` });
  await handle.scrollIntoViewIfNeeded();
  const b = (await handle.boundingBox())!;
  const s = (await page.locator('.stage').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + (x / PHOTO.w) * s.width, s.y + (y / PHOTO.h) * s.height, { steps: 6 });
  await page.mouse.up();
}

async function markSheet(page: Page) {
  await dragCorner(page, 'superior esquerdo', SHEET[0]);
  await dragCorner(page, 'superior direito', SHEET[1]);
  await dragCorner(page, 'inferior direito', SHEET[2]);
  await dragCorner(page, 'inferior esquerdo', SHEET[3]);
}

test.describe('Digitalizar', () => {
  test('foto inclinada vira uma página A4 reta e limpa', async ({ page }) => {
    const net = watchNetwork(page);
    const jpg = await photo(page);
    await page.goto('./#/ferramenta/digitalizar');
    await page.locator('main input[type="file"]').first().setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await expect(page.getByRole('heading', { name: 'Marque os 4 cantos do documento' })).toBeVisible();
    await markSheet(page);
    await page.getByRole('button', { name: 'Usar esta página' }).click();

    // A imagem final: papel branco até as bordas, nada do fundo escuro, faixa vermelha reta no topo
    const img = page.locator('.card img');
    await expect(img).toHaveCount(1);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.src.startsWith('blob:') && el.complete && el.naturalWidth > 0)).toBe(true);
    const seen = await img.evaluate((el: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = el.naturalWidth; c.height = el.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(el, 0, 0);
      const at = (u: number, v: number) => [...ctx.getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data].slice(0, 3);
      return {
        ratio: c.height / c.width,
        corners: [at(0.03, 0.03), at(0.97, 0.03), at(0.97, 0.97), at(0.03, 0.97)],
        band: [at(0.15, 0.09), at(0.5, 0.09), at(0.85, 0.09)],
        above: [at(0.15, 0.025), at(0.85, 0.025)],
      };
    });
    for (const p of [...seen.corners, ...seen.above]) expect(Math.min(...p)).toBeGreaterThan(200);
    for (const [r, g] of seen.band) expect(r - g).toBeGreaterThan(80);

    await page.getByRole('radio', { name: 'A4' }).check({ force: true });
    await page.getByRole('button', { name: 'Gerar PDF' }).click();
    await expect(page.getByText('Pronto!')).toBeVisible({ timeout: 30_000 });
    const out = await download(page, /^Baixar/);
    expect(out.name).toBe('digitalizado.pdf');
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    const size = doc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(595.28, 1);
    expect(size.height).toBeCloseTo(841.89, 1);
    const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjects.keys()).toHaveLength(1);
    expect(net.external()).toEqual([]);
    expect(net.cspErrors).toEqual([]);
  });

  test('várias fotos: ajusta uma a uma, reordena, gira e remove', async ({ page }) => {
    const jpg = await photo(page);
    await page.goto('./#/ferramenta/digitalizar');
    const file = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: jpg });
    await page.locator('main input[type="file"]').first().setInputFiles([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    for (let i = 0; i < 3; i++) {
      await expect(page.getByRole('button', { name: 'Usar esta página' })).toBeEnabled();
      await page.getByRole('button', { name: 'Usar esta página' }).click();
      await expect(page.locator('p.notice.info')).toHaveCount(0, { timeout: 20_000 });
    }
    await expect(page.locator('.card')).toHaveCount(3);
    await page.getByRole('button', { name: 'Remover a página 2' }).click();
    await expect(page.locator('.card')).toHaveCount(2);
    const before = await page.locator('.card img').first().evaluate((el: HTMLImageElement) => el.naturalHeight > el.naturalWidth);
    expect(before).toBe(true);
    await page.getByRole('button', { name: 'Girar a página 1' }).click();
    await expect.poll(() => page.locator('.card img').first().evaluate((el: HTMLImageElement) => el.naturalWidth > el.naturalHeight)).toBe(true);
    await page.getByRole('button', { name: 'Gerar PDF' }).click();
    await expect(page.getByText('2 páginas.')).toBeVisible({ timeout: 30_000 });
    const doc = await PDFDocument.load((await download(page, /^Baixar/)).bytes);
    const [first, second] = doc.getPages().map((p) => p.getSize());
    expect(first.width).toBeGreaterThan(first.height);   // a girada
    expect(second.height).toBeGreaterThan(second.width);
  });

  test('cantos cruzados são recusados; o teclado também move os cantos', async ({ page }) => {
    const jpg = await photo(page);
    await page.goto('./#/ferramenta/digitalizar');
    await page.locator('main input[type="file"]').first().setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpg });
    const use = page.getByRole('button', { name: 'Usar esta página' });
    await expect(use).toBeEnabled();
    await dragCorner(page, 'superior esquerdo', [1150, 1550]);
    await expect(page.getByRole('alert')).toContainText('cruzaram');
    await expect(use).toBeDisabled();
    await dragCorner(page, 'superior esquerdo', [60, 60]);
    await expect(use).toBeEnabled();

    const handle = page.getByRole('button', { name: 'Canto superior esquerdo' });
    const left = () => handle.evaluate((el: HTMLElement) => parseFloat(el.style.left));
    const x0 = await left();
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    expect(await left()).toBeGreaterThan(x0);
  });

  test('não aceita arquivo que não é imagem e “Cancelar” descarta a foto', async ({ page }) => {
    const jpg = await photo(page);
    await page.goto('./#/ferramenta/digitalizar');
    const input = page.locator('main input[type="file"]').first();
    await input.setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('oi') });
    await expect(page.getByRole('alert')).toContainText('nota.txt');
    await input.setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: 'Escolher fotos' })).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- Comparar

async function textPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 50, y: 760 - i * 20, size: 12, font }));
  }
  return doc.save();
}

const OLD = [
  ['Contrato de prestação de serviços', 'O valor total é de R$ 1.000,00 por mês.', 'O prazo é de doze meses.'],
  ['Cláusula final', 'Esta frase será removida do documento.', 'Foro da comarca de Curitiba.'],
];
const NEW = [
  ['Contrato de prestação de serviços', 'O valor total é de R$ 2.500,00 por mês.', 'O prazo é de doze meses.'],
  ['Cláusula final', 'Foro da comarca de Curitiba.', 'Uma frase nova foi incluída.'],
];

async function pickBoth(page: Page, a: Uint8Array, b: Uint8Array) {
  await page.goto('./#/ferramenta/comparar');
  await page.locator('main section.slot input[type="file"]').nth(0).setInputFiles(pdfInput('v1.pdf', a));
  await expect(page.getByText('v1.pdf')).toBeVisible();
  await page.locator('main section.slot input[type="file"]').nth(1).setInputFiles(pdfInput('v2.pdf', b));
  await expect(page.getByText('v2.pdf')).toBeVisible();
}

test.describe('Comparar PDFs', () => {
  test('mostra o que mudou, marca nas páginas e baixa os PDFs marcados', async ({ page }) => {
    const net = watchNetwork(page);
    const [a, b] = [await textPdf(OLD), await textPdf(NEW)];
    await pickBoth(page, a, b);
    await page.getByRole('button', { name: 'Comparar', exact: true }).click();
    await expect(page.getByText('3 diferenças')).toBeVisible({ timeout: 20_000 });

    const items = page.getByRole('list', { name: 'Lista de diferenças' }).getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).locator('del')).toHaveText('1.000,00');
    await expect(items.nth(0).locator('ins')).toHaveText('2.500,00');
    await expect(items.nth(1).locator('del')).toHaveText('Esta frase será removida do documento.');
    await expect(items.nth(1).locator('ins')).toHaveCount(0);
    await expect(items.nth(2).locator('ins')).toHaveText('Uma frase nova foi incluída.');

    // A marca da primeira diferença fica sobre a linha certa da página (y = 740 de 842, medido de baixo)
    const mark = page.locator('.mark.b.now');
    await expect(mark).toHaveCount(1);
    const [m, sheet] = await Promise.all([mark.boundingBox(), page.locator('figure.page:not(.hide) .sheet').last().boundingBox()]);
    const middle = (m!.y + m!.height / 2 - sheet!.y) / sheet!.height;
    expect(Math.abs(middle - (842 - 744) / 842)).toBeLessThan(0.012);

    // Ir para a última diferença leva à página 2
    await items.nth(2).getByRole('button').click();
    await expect(page.getByText('Diferença 3 de 3')).toBeVisible();
    await expect(page.locator('figure.page:not(.hide) figcaption').last()).toContainText('página 2');
    await expect(page.locator('.mark.b.now')).toHaveCount(1);

    const marked = await download(page, /Baixar versão nova marcada/);
    expect(marked.name).toBe('v2-nova-marcada.pdf');
    expect((await PDFDocument.load(marked.bytes)).getPageCount()).toBe(2);
    expect(await pdfText(marked.bytes, 1)).toContain('2.500,00');
    expect(marked.bytes.length).toBeGreaterThan(0);
    expect(net.external()).toEqual([]);
    expect(net.cspErrors).toEqual([]);
  });

  test('no celular, mostra uma versão por vez e troca conforme a diferença', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Só no layout de celular');
    await pickBoth(page, await textPdf(OLD), await textPdf(NEW));
    await page.getByRole('button', { name: 'Comparar', exact: true }).click();
    await expect(page.locator('figure.page:not(.hide)')).toHaveCount(1, { timeout: 20_000 });
    await page.getByRole('list', { name: 'Lista de diferenças' }).getByRole('button').nth(1).click();
    await expect(page.locator('figure.page:not(.hide) figcaption')).toHaveText('Versão antiga · página 2');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('arquivos iguais e opção de ignorar maiúsculas', async ({ page }) => {
    const a = await textPdf([['Texto Igual em Ação']]);
    await pickBoth(page, a, await textPdf([['texto igual em acao']]));
    await page.getByRole('button', { name: 'Comparar', exact: true }).click();
    await expect(page.getByText(/1 diferença|\d diferenças/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Comparar outros' }).click();
    await page.getByRole('checkbox', { name: 'Ignorar maiúsculas e acentos' }).check();
    await page.getByRole('button', { name: 'Comparar', exact: true }).click();
    await expect(page.getByText('Nenhuma diferença no texto.')).toBeVisible({ timeout: 20_000 });
  });

  test('avisa quando um PDF não tem texto', async ({ page }) => {
    const doc = await PDFDocument.create();
    const png = await doc.embedPng(readFileSync(fixture('image.png')));
    doc.addPage([300, 300]).drawImage(png, { x: 0, y: 0, width: 300, height: 300 });
    await pickBoth(page, await textPdf(OLD), await doc.save());
    await page.getByRole('button', { name: 'Comparar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('não tem texto');
  });
});

// ---------------------------------------------------------------- Receber arquivos de outros apps

test.describe('Receber arquivos', () => {
  test('o manifest e o service worker declaram o compartilhamento e a abertura de PDFs', async ({ request }) => {
    const manifest = await (await request.get('manifest.webmanifest')).json();
    expect(manifest.share_target).toMatchObject({ action: './compartilhar', method: 'POST', enctype: 'multipart/form-data' });
    expect(manifest.share_target.params.files[0].name).toBe('file');
    expect(manifest.file_handlers[0].accept['application/pdf']).toEqual(['.pdf']);
    expect(await (await request.get('sw.js')).text()).toContain('share-target.js');
    expect((await request.get('share-target.js')).ok()).toBe(true);
  });

  /** Simula o sistema: um POST multipart de navegação para ./compartilhar, como faz o Android. */
  async function share(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
    await page.goto('./');
    await expect(page.getByText('Pronto para usar offline')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.evaluate(() => {
      const form = document.createElement('form');
      form.id = 'share'; form.method = 'post'; form.enctype = 'multipart/form-data'; form.action = 'compartilhar';
      form.innerHTML = '<input type="file" name="file" multiple>';
      document.body.append(form);
    });
    await page.locator('#share input').setInputFiles(files);
    await page.evaluate(() => (document.getElementById('share') as HTMLFormElement).submit());
  }

  const leftovers = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.includes('recebidos')).length);

  test.describe('compartilhamento', () => {
    test.skip(({ browserName }) => browserName === 'webkit', 'O iOS não tem share target');

    test('um PDF compartilhado abre no editor e não fica guardado', async ({ page }) => {
      await share(page, [{ name: 'recebido.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('text.pdf')) }]);
      await page.waitForURL(/#\/editor$/);
      await waitForDoc(page);
      await expect(page.getByText('recebido.pdf').first()).toBeVisible();
      expect(await leftovers(page)).toBe(0);
    });

    test('vários PDFs vão para Juntar', async ({ page }) => {
      const pdf = readFileSync(fixture('numbered.pdf'));
      await share(page, [
        { name: 'a.pdf', mimeType: 'application/pdf', buffer: pdf },
        { name: 'b.pdf', mimeType: 'application/pdf', buffer: pdf },
      ]);
      await page.waitForURL(/#\/ferramenta\/juntar$/);
      await expect(page.getByText('a.pdf')).toBeVisible();
      await expect(page.getByText('b.pdf')).toBeVisible();
    });

    test('imagens vão para Imagens para PDF', async ({ page }) => {
      await share(page, [{ name: 'foto.png', mimeType: 'image/png', buffer: readFileSync(fixture('image.png')) }]);
      await page.waitForURL(/#\/ferramenta\/imagens-para-pdf$/);
      await expect(page.locator('.card')).toHaveCount(1);
    });

    test('arquivo sem uso mostra um aviso', async ({ page }) => {
      await share(page, [{ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('oi') }]);
      await page.waitForURL(/#\/recebido$/);
      await expect(page.getByRole('heading', { name: 'Nenhum arquivo para abrir' })).toBeVisible();
    });
  });

  test('“Abrir com” entrega o PDF ao editor', async ({ page }) => {
    const b64 = readFileSync(fixture('text.pdf')).toString('base64');
    await page.addInitScript(() => {
      // No Chromium a propriedade original é só de leitura
      Object.defineProperty(window, 'launchQueue', {
        configurable: true,
        value: { setConsumer(fn: unknown) { (window as unknown as { __launch: unknown }).__launch = fn; } },
      });
    });
    await page.goto('./');
    await page.evaluate((data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'aberto.pdf', { type: 'application/pdf' });
      (window as unknown as { __launch: (p: unknown) => void }).__launch({ files: [{ getFile: async () => file }] });
    }, b64);
    await page.waitForURL(/#\/editor$/);
    await waitForDoc(page);
    await expect(page.getByText('aberto.pdf').first()).toBeVisible();
  });
});
