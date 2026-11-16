// M5 · Otimizar e proteger: comprimir, senha, marca d’água, números, recortar, tarja, achatar e propriedades.
// Roda nos 3 perfis (computador, Android e iPhone emulados). Cada roteiro baixa o resultado e confere o PDF.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { fixture, pdfText, watchNetwork } from './helpers';

type Input = string | { name: string; bytes: Uint8Array };

async function choose(page: Page, file: Input) {
  const input = page.locator('main input[type="file"]').first();
  if (typeof file === 'string') await input.setInputFiles(fixture(file));
  else await input.setInputFiles({ name: file.name, mimeType: 'application/pdf', buffer: Buffer.from(file.bytes) });
}

async function download(page: Page) {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Baixar/ }).click();
  const d = await dl;
  const chunks: Buffer[] = [];
  for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
  return { bytes: new Uint8Array(Buffer.concat(chunks)), name: d.suggestedFilename() };
}

async function texts(bytes: Uint8Array) {
  const n = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push((await pdfText(bytes, i)).trim());
  return out;
}

async function pdfjs(bytes: Uint8Array, password?: string) {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return lib.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
}

const done = (page: Page) => expect(page.getByText('Pronto!')).toBeVisible({ timeout: 30_000 });

// ---------------------------------------------------------------- Comprimir

/** PDF de fotos: JPEGs grandes e com pouca compressão (como os de celular), gerados no navegador. */
async function photoPdf(page: Page): Promise<Uint8Array> {
  await page.goto('./');
  const jpgs = await page.evaluate(async () => {
    const out: number[][] = [];
    for (let k = 0; k < 2; k++) {
      const c = document.createElement('canvas');
      c.width = 2400; c.height = 1800;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, k ? '#3a6' : '#58c'); g.addColorStop(1, k ? '#fc4' : '#e74');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 50)}%)`;
        ctx.beginPath();
        ctx.arc((i * 523) % c.width, (i * 311) % c.height, 20 + (i % 90), 0, Math.PI * 2);
        ctx.fill();
      }
      // Granulado de foto
      const img = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 40;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
      out.push([...new Uint8Array(await blob.arrayBuffer())]);
    }
    return out;
  });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, bytes] of jpgs.entries()) {
    const img = await doc.embedJpg(Uint8Array.from(bytes));
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 20, y: 300, width: 555, height: 416 });
    page.drawText(`Foto ${i + 1} da obra`, { x: 40, y: 260, size: 16, font });
  }
  return doc.save();
}

test('comprimir (leve): PDF de fotos fica 40% menor ou mais, com o texto intacto', async ({ page }) => {
  test.setTimeout(120_000);
  const original = await photoPdf(page);
  await page.goto('./#/ferramenta/comprimir');
  await choose(page, { name: 'fotos.pdf', bytes: original });
  await expect(page.getByText('Leve (recomendada)')).toBeVisible();
  await page.getByRole('button', { name: 'Comprimir PDF' }).click();
  await done(page);
  await expect(page.getByText(/% menor/)).toBeVisible();
  const { bytes, name } = await download(page);
  expect(name).toBe('fotos-comprimido.pdf');
  expect(bytes.length).toBeLessThanOrEqual(original.length * 0.6);
  expect(await texts(bytes)).toEqual(['Foto 1 da obra', 'Foto 2 da obra']);
  // As fotos continuam lá (renderiza sem erro e com imagem)
  const pdf = await pdfjs(bytes);
  const ops = await (await pdf.getPage(1)).getOperatorList();
  expect(ops.fnArray.length).toBeGreaterThan(3);
});

test('comprimir: nunca entrega arquivo maior (PDF só de texto, modo forte)', async ({ page }) => {
  await page.goto('./#/ferramenta/comprimir');
  await choose(page, 'text.pdf');
  await page.getByText('Forte', { exact: true }).click();
  await expect(page.getByText(/texto deixa de ser selecionável/)).toBeVisible();
  await page.getByRole('button', { name: 'Comprimir PDF' }).click();
  await done(page);
  await expect(page.getByText('Este PDF já está otimizado.')).toBeVisible();
  const { bytes, name } = await download(page);
  expect(name).toBe('text.pdf');
  expect((await texts(bytes))[0]).toContain('Primeira linha');
});

// ---------------------------------------------------------------- Senha

test('proteger com senha e restrições; desbloquear só com a senha certa', async ({ page }) => {
  await page.goto('./#/ferramenta/proteger');
  await choose(page, 'form.pdf');
  const go = page.getByRole('button', { name: 'Proteger PDF' });
  await expect(go).toBeDisabled();
  await page.getByLabel('Senha para abrir').fill('Segredo 123');
  await page.getByLabel('Repita a senha').fill('Segredo 12');
  await expect(page.getByText('As senhas não são iguais.')).toBeVisible();
  await page.getByLabel('Repita a senha').fill('Segredo 123');
  await page.getByText('Imprimir', { exact: true }).click(); // desmarca
  await go.click();
  await done(page);
  await expect(page.getByText(/sem permissão para imprimir/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir no editor' })).toHaveCount(0);
  const { bytes: locked, name } = await download(page);
  expect(name).toBe('form-protegido.pdf');
  await expect(pdfjs(locked)).rejects.toMatchObject({ name: 'PasswordException' });
  const opened = await pdfjs(locked, 'Segredo 123');
  expect(await opened.getPermissions()).not.toContain(4); // imprimir

  // Outra ferramenta recusa o PDF com senha e leva ao “Desbloquear”
  await page.goto('./#/ferramenta/marca-dagua');
  await choose(page, { name: 'form-protegido.pdf', bytes: locked });
  await expect(page.getByText(/é protegido por senha/)).toBeVisible();
  await page.getByRole('button', { name: 'Desbloquear este PDF' }).click();
  await expect(page).toHaveURL(/#\/ferramenta\/desbloquear$/);
  const pw = page.getByLabel('Senha do PDF');
  await pw.fill('segredo 123');
  await pw.press('Enter');
  await expect(page.getByText('Senha incorreta.', { exact: false })).toBeVisible();
  await pw.fill('Segredo 123');
  await page.getByRole('button', { name: 'Desbloquear PDF' }).click();
  await done(page);
  const { bytes: open, name: openName } = await download(page);
  expect(openName).toBe('form-protegido-desbloqueado.pdf');
  expect((await pdfjs(open)).numPages).toBe(1);
  expect((await PDFDocument.load(open)).getForm().getTextField('codigo').getText()).toBe('ABC-123');
});

test('desbloquear: PDF sem senha avisa que não há nada a fazer', async ({ page }) => {
  await page.goto('./#/ferramenta/desbloquear');
  await choose(page, 'numbered.pdf');
  await expect(page.getByText('Este PDF não tem senha nem restrições.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desbloquear PDF' })).toBeDisabled();
});

// ---------------------------------------------------------------- Marca d’água e números

test('marca d’água de texto só nas páginas escolhidas, com prévia', async ({ page }) => {
  await page.goto('./#/ferramenta/marca-dagua');
  await choose(page, 'numbered.pdf');
  await page.locator('#wm-text').fill('RASCUNHO');
  await page.getByText('Mosaico').click();
  await page.getByText('Escolher', { exact: true }).click();
  await page.getByLabel('Quais páginas').fill('1-2');
  await expect(page.getByLabel(/Prévia da página 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar marca d’água' }).click();
  await done(page);
  await expect(page.getByText('Marca d’água aplicada em 2 páginas.')).toBeVisible();
  const { bytes, name } = await download(page);
  expect(name).toBe('numbered-marca-dagua.pdf');
  const t = await texts(bytes);
  expect(t[0]).toContain('Pagina 1');
  expect(t[0]).toContain('RASCUNHO');
  expect(t[1]).toContain('RASCUNHO');
  expect(t[2]).not.toContain('RASCUNHO');
});

test('números de página “1 de N” com capa sem número', async ({ page }) => {
  await page.goto('./#/ferramenta/numerar');
  await choose(page, 'numbered.pdf');
  await page.getByLabel('Formato').selectOption('n-de');
  await page.getByLabel('Começar na página').fill('2');
  await expect(page.getByText('A página 2 recebe “1 de 4”.')).toBeVisible();
  await page.getByLabel('Embaixo, à direita').check({ force: true });
  await page.getByRole('button', { name: 'Numerar páginas' }).click();
  await done(page);
  const { bytes } = await download(page);
  const t = await texts(bytes);
  expect(t[0]).toBe('Pagina 1');
  expect(t[1]).toContain('1 de 4');
  expect(t[4]).toContain('4 de 4');
});

// ---------------------------------------------------------------- Recortar

test('recortar margens fixas e automático', async ({ page }) => {
  await page.goto('./#/ferramenta/recortar');
  await choose(page, 'numbered.pdf');
  await page.getByLabel('Margem a cortar (mm)').fill('20');
  await expect(page.locator('.keep')).toBeVisible();
  await page.getByRole('button', { name: 'Recortar páginas' }).click();
  await done(page);
  const { bytes } = await download(page);
  const doc = await PDFDocument.load(bytes);
  const crop = doc.getPage(0).getCropBox();
  const mm20 = (20 * 72) / 25.4;
  expect(crop.x).toBeCloseTo(mm20, 1);
  expect(crop.width).toBeCloseTo(595 - 2 * mm20, 1);
  expect(await texts(bytes)).toContain('Pagina 1');

  // Automático: a página fica só em volta do texto (“Pagina 1”, no alto à esquerda)
  await page.getByRole('button', { name: 'Recomeçar' }).click();
  await choose(page, 'numbered.pdf');
  await page.getByText('Automático (tira o branco)').click();
  await page.getByRole('button', { name: 'Recortar páginas' }).click();
  await done(page);
  const auto = await PDFDocument.load((await download(page)).bytes);
  const box = auto.getPage(0).getCropBox();
  expect(box.width).toBeLessThan(250);
  expect(box.height).toBeLessThan(80);
  expect(box.y).toBeGreaterThan(700);
});

// ---------------------------------------------------------------- Tarja

test('tarja: busca e área desenhada; o texto coberto não pode ser recuperado', async ({ page }) => {
  await page.goto('./#/ferramenta/tarjar');
  await choose(page, 'numbered.pdf');
  // Busca: “pagina 2” (sem acento e minúsculas) acha “Pagina 2”
  await page.getByLabel('Procurar no texto e tarjar').fill('pagina 2');
  await page.getByRole('button', { name: 'Marcar', exact: true }).click();
  await expect(page.getByText('1 ocorrência marcada em 1 página')).toBeVisible();
  await expect(page.getByText('Página 2 de 5')).toBeVisible(); // foi para a página da ocorrência
  // Área desenhada na página 4 (sobre o título)
  await page.getByRole('button', { name: 'Próxima página' }).click();
  await page.getByRole('button', { name: 'Próxima página' }).click();
  await expect(page.getByText('Página 4 de 5')).toBeVisible();
  // A página inteira cabe na tela (até 70% da altura): centraliza e desenha sobre o título
  await page.locator('.draw').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const area = (await page.locator('.draw').boundingBox())!;
  expect(area.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.71);
  const drag = async (to: number) => {
    await page.mouse.move(area.x + area.width * 0.05, area.y + area.height * 0.06);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.4, area.y + area.height * 0.1, { steps: 5 });
    await page.mouse.move(area.x + area.width * to, area.y + area.height * 0.14, { steps: 5 });
    await page.mouse.up();
  };
  await drag(0.6);
  await expect(page.locator('.draw .bar')).toHaveCount(1);
  // Tocar numa tarja permite removê-la; desenha de novo
  await page.locator('.draw .bar').first().click();
  await page.getByRole('button', { name: 'Remover tarja' }).click();
  await expect(page.locator('.draw .bar')).toHaveCount(0);
  await drag(0.7);
  await expect(page.locator('.draw .bar')).toHaveCount(1);

  await page.getByRole('button', { name: 'Aplicar 2 tarjas' }).click();
  await done(page);
  const { bytes, name } = await download(page);
  expect(name).toBe('numbered-tarjado.pdf');
  const t = await texts(bytes);
  expect(t).toEqual(['Pagina 1', '', 'Pagina 3', '', 'Pagina 5']);
  // Nenhum resquício do texto tarjado em lugar nenhum do arquivo (nem no título)
  const all = (await texts(bytes)).join(' ');
  expect(all).not.toMatch(/Pagina [24]/);
  const meta = await (await pdfjs(bytes)).getMetadata();
  expect((meta.info as { Title?: string }).Title ?? '').toBe('');
});

test('tarja: CPF e e-mail pelos botões de padrão', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  p.drawText('Aluno: Joao Teste', { x: 60, y: 760, size: 14, font });
  p.drawText('CPF: 123.456.789-09', { x: 60, y: 730, size: 14, font });
  p.drawText('Contato: joao@exemplo.com', { x: 60, y: 700, size: 14, font });
  await page.goto('./#/ferramenta/tarjar');
  await choose(page, { name: 'dados.pdf', bytes: await doc.save() });
  await page.getByRole('button', { name: 'Todos os CPFs' }).click();
  await expect(page.getByText('CPF: 1 ocorrência')).toBeVisible();
  await page.getByRole('button', { name: 'Todos os E-mails' }).click();
  await expect(page.getByText('E-mail: 1 ocorrência')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar 2 tarjas' }).click();
  await done(page);
  const { bytes } = await download(page);
  expect((await texts(bytes))[0]).toBe('');
  // A página virou imagem: o nome (fora da tarja) aparece na imagem, mas nada vira texto
  const ops = await (await (await pdfjs(bytes)).getPage(1)).getOperatorList();
  expect(ops.fnArray.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------- Achatar e propriedades

test('achatar: campos preenchidos viram parte da página', async ({ page }) => {
  const form = await PDFDocument.load(await (await import('node:fs/promises')).readFile(fixture('form.pdf')));
  form.getForm().getTextField('nome').setText('Ana Achatada');
  await page.goto('./#/ferramenta/achatar');
  await choose(page, { name: 'ficha.pdf', bytes: await form.save() });
  await expect(page.getByText(/4 campos de formulário/)).toBeVisible();
  await page.getByRole('button', { name: 'Achatar PDF' }).click();
  await done(page);
  const { bytes, name } = await download(page);
  expect(name).toBe('ficha-achatado.pdf');
  const out = await PDFDocument.load(bytes);
  expect(out.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
  expect(out.getPage(0).node.get(PDFName.of('Annots'))).toBeUndefined();
  const t = (await texts(bytes))[0];
  expect(t).toContain('Ana Achatada');
  expect(t).toContain('ABC-123');
});

test('achatar: PDF sem campos nem anotações avisa', async ({ page }) => {
  await page.goto('./#/ferramenta/achatar');
  await choose(page, 'numbered.pdf');
  await expect(page.getByText(/já está “achatado”/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Achatar PDF' })).toBeDisabled();
});

test('propriedades: editar e depois remover tudo', async ({ page }) => {
  await page.goto('./#/ferramenta/propriedades');
  await choose(page, 'numbered.pdf');
  const save = page.getByRole('button', { name: 'Salvar propriedades' });
  await expect(save).toBeDisabled(); // nada mudou ainda
  await page.getByLabel('Título').fill('Relatório de Ação');
  await page.getByLabel('Autor').fill('Coordenação');
  await save.click();
  await done(page);
  const { bytes, name } = await download(page);
  expect(name).toBe('numbered.pdf');
  const meta = (await (await pdfjs(bytes)).getMetadata()).info as Record<string, string>;
  expect(meta.Title).toBe('Relatório de Ação');
  expect(meta.Author).toBe('Coordenação');

  await page.getByRole('button', { name: 'Recomeçar' }).click();
  await choose(page, { name: 'r.pdf', bytes });
  await expect(page.getByLabel('Título')).toHaveValue('Relatório de Ação');
  await page.getByText('Remover todas as propriedades').click();
  await page.getByRole('button', { name: 'Remover propriedades' }).click();
  await done(page);
  const cleared = (await (await pdfjs((await download(page)).bytes)).getMetadata()).info as Record<string, string>;
  expect(cleared.Title ?? '').toBe('');
  expect(cleared.Author ?? '').toBe('');
});

// ---------------------------------------------------------------- Privacidade

test('ferramentas do M5 (inclusive o qpdf em WebAssembly) não fazem requisições externas nem violam a CSP', async ({ page }) => {
  const net = watchNetwork(page);
  await page.goto('./#/ferramenta/proteger');
  await choose(page, 'letters.pdf');
  await page.getByLabel('Senha para abrir').fill('x');
  await page.getByLabel('Repita a senha').fill('x');
  await page.getByRole('button', { name: 'Proteger PDF' }).click();
  await done(page);
  expect(net.requests.some((u) => /\.wasm$/.test(u))).toBe(true);
  await page.goto('./#/ferramenta/comprimir');
  await choose(page, 'letters.pdf');
  await page.getByRole('button', { name: 'Comprimir PDF' }).click();
  await done(page);
  expect(net.external()).toEqual([]);
  expect(net.cspErrors).toEqual([]);
});
