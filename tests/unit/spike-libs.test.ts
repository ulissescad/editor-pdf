// Testes de viabilidade do M0 (PLANO.md):
// 1) @cantoo/pdf-lib substitui o pdf-lib original nas operações que o editor usa;
// 2) qpdf em WebAssembly criptografa e descriptografa com AES-256, sem servidor.
import { describe, expect, it, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from '@cantoo/pdf-lib';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { makeForm } from '../fixtures/make-fixtures.mjs';

const require = createRequire(import.meta.url);
const QPDF_WASM = require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm');

async function openWithPdfjs(data: Uint8Array, password?: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: data.slice(), password, verbosity: 0 }).promise;
}

describe('@cantoo/pdf-lib', () => {
  it('desenha texto recortado (como as caixas do editor) e preserva campos de formulário', async () => {
    const doc = await PDFDocument.load(await makeForm());
    doc.getForm().getTextField('nome').setText('Maria');
    const page = doc.getPage(0);
    const font = await doc.embedFont(StandardFonts.TimesRomanBold);
    page.pushOperators(pushGraphicsState(), rectangle(50, 400, 300, 40), clip(), endPath());
    page.drawText('Conceição Ávila', { x: 52, y: 420, size: 13, font, color: rgb(0.1, 0.2, 0.8) });
    page.pushOperators(popGraphicsState());
    const bytes = await doc.save({ updateFieldAppearances: false });

    const again = await PDFDocument.load(bytes);
    expect(again.getForm().getTextField('nome').getText()).toBe('Maria');
    expect(again.getForm().getTextField('codigo').isReadOnly()).toBe(true);

    const pdf = await openWithPdfjs(bytes);
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text).toContain('Conceição Ávila');
  });

  it('anexa e recupera um arquivo (base do “PDF reeditável” do M1)', async () => {
    const doc = await PDFDocument.load(await makeForm());
    const json = JSON.stringify({ version: 1, objects: [] });
    await doc.attach(new TextEncoder().encode(json), 'editor-projeto.json', { mimeType: 'application/json' });
    const pdf = await openWithPdfjs(await doc.save());
    // pdf.js 6: a lista de anexos é um Map e o conteúdo é lido à parte
    const attachments = await pdf.getAttachments();
    expect(attachments?.has('editor-projeto.json')).toBe(true);
    const content = await pdf.getAttachmentContent('editor-projeto.json');
    expect(new TextDecoder().decode(content!)).toBe(json);
  });
});

// As tipagens do pacote são incompletas (módulo Emscripten); descrevemos só o que usamos.
interface Qpdf {
  callMain(args: string[]): number;
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array };
}
type QpdfFactory = (opts: Record<string, unknown>) => Promise<Qpdf>;

describe('qpdf (WebAssembly)', () => {
  let qpdf: Qpdf;
  beforeAll(async () => {
    qpdf = await (createQpdf as unknown as QpdfFactory)({
      locateFile: () => QPDF_WASM, noInitialRun: true, print: () => {}, printErr: () => {},
    });
  });

  const run = (args: string[]) => {
    try { return qpdf.callMain(args); } catch (e) { return (e as { status?: number }).status ?? 1; }
  };

  it('protege com senha (AES-256) e desbloqueia com a senha correta', async () => {
    qpdf.FS.writeFile('/in.pdf', await makeForm());
    expect(run(['--encrypt', 'senha-usuario', 'senha-dono', '256', '--', '/in.pdf', '/enc.pdf'])).toBe(0);
    const enc = qpdf.FS.readFile('/enc.pdf');

    // Sem senha não abre; com a senha abre (verificado com o pdf.js, como no site)
    await expect(openWithPdfjs(enc)).rejects.toMatchObject({ name: 'PasswordException' });
    const opened = await openWithPdfjs(enc, 'senha-usuario');
    expect(opened.numPages).toBe(1);

    // AES-256 = filtro padrão revisão 6 (V 5)
    const raw = new TextDecoder('latin1').decode(enc);
    expect(raw).toMatch(/\/V\s+5/);

    // Desbloquear: com a senha certa gera um PDF sem criptografia, que o pdf-lib edita normalmente
    expect(run(['--password=senha-usuario', '--decrypt', '/enc.pdf', '/dec.pdf'])).toBe(0);
    const dec = qpdf.FS.readFile('/dec.pdf');
    expect(new TextDecoder('latin1').decode(dec)).not.toContain('/Encrypt');
    const doc = await PDFDocument.load(dec);
    expect(doc.getForm().getTextField('codigo').getText()).toBe('ABC-123');

    // Senha errada falha
    expect(run(['--password=errada', '--decrypt', '/enc.pdf', '/x.pdf'])).not.toBe(0);
  });
});
