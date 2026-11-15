import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { History } from '../../src/editor/history.ts';
import { DEFAULT_STYLE, clampRect, makeText, minHeight, parseProject, type Project } from '../../src/editor/model.ts';
import { extractProject, stampObjects } from '../../src/pdf/write.ts';
import { makeFlatTable, makeForm } from '../fixtures/make-fixtures.mjs';
import { baseFonts } from '../pdf-inspect.ts';

async function text(bytes: Uint8Array, page = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  return (await (await pdf.getPage(page)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
}
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('History (desfazer/refazer)', () => {
  it('desfaz e refaz na ordem certa e ignora estados repetidos', () => {
    const h = new History<number[]>([]);
    expect(h.push([1])).toBe(true);
    expect(h.push([1])).toBe(false);
    h.push([1, 2]);
    expect(h.undo()).toEqual([1]);
    expect(h.undo()).toEqual([]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual([1]);
    h.push([9]); // nova ação apaga o “refazer”
    expect(h.canRedo).toBe(false);
  });
  it('respeita o limite de passos', () => {
    const h = new History<number>(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(3);
  });
});

describe('modelo de objetos', () => {
  it('caixa nova tem pelo menos uma linha de altura', () => {
    const o = makeText(0, { x: 10, y: 100, w: 50, h: 1 }, DEFAULT_STYLE);
    expect(o.rect.h).toBeCloseTo(minHeight(DEFAULT_STYLE));
  });
  it('mantém o retângulo dentro da página', () => {
    expect(clampRect({ x: 580, y: 900, w: 50, h: 20 }, [0, 0, 595, 842])).toEqual({ x: 545, y: 842, w: 50, h: 20 });
    expect(clampRect({ x: -10, y: 5, w: 50, h: 20 }, [0, 0, 595, 842])).toEqual({ x: 0, y: 20, w: 50, h: 20 });
  });
  it('rejeita projetos inválidos ou de outro app', () => {
    expect(parseProject('{}')).toBeNull();
    expect(parseProject('não é json')).toBeNull();
    expect(parseProject(JSON.stringify({ app: 'outro', version: 1, objects: [] }))).toBeNull();
    const ok = parseProject(JSON.stringify({ app: 'editor-pdf', version: 1, objects: [makeText(0, { x: 1, y: 50, w: 10, h: 10 }, DEFAULT_STYLE, 'a'), { lixo: 1 }] }));
    expect(ok?.objects).toHaveLength(1);
  });
});

describe('PDF reeditável (gravar → reabrir → gravar)', () => {
  const style = { ...DEFAULT_STYLE, font: 'serif' as const, bold: true, align: 'center' as const };

  it('grava o texto numa camada marcada, embute o projeto e reabre sem duplicar', async () => {
    const obj = makeText(0, { x: 60, y: 600, w: 300, h: 40 }, style, 'Olá, Conceição');
    const project: Project = { app: 'editor-pdf', version: 1, objects: [obj] };
    const lines = [{ index: 0, text: 'Olá, Conceição' }];
    const first = await stampObjects(await makeFlatTable(), [{ obj, lines, baseline: 0.9 }], project);
    expect(first.replaced).toBe(0);
    expect(count(await text(first.bytes), 'Olá, Conceição')).toBe(1);
    expect(await baseFonts(first.bytes)).toContain('Times-Bold');

    // Reabrir: projeto recuperado e base SEM o texto gravado
    const reopened = await extractProject(first.bytes);
    expect(reopened?.project.objects).toHaveLength(1);
    expect(reopened?.project.objects[0].text).toBe('Olá, Conceição');
    expect(await text(reopened!.base)).not.toContain('Olá, Conceição');
    expect(await text(reopened!.base)).toContain('01. DADOS DO ESTUDANTE'); // conteúdo original preservado
    expect(await extractProject(reopened!.base)).toBeNull(); // anexo removido

    // Gravar de novo com o texto alterado: só a versão nova aparece
    const edited = { ...obj, text: 'Olá, Conceição e Ávila' };
    const second = await stampObjects(reopened!.base, [{ obj: edited, lines: [{ index: 0, text: edited.text }], baseline: 0.9 }],
      { ...project, objects: [edited] });
    const t = await text(second.bytes);
    expect(count(t, 'Olá, Conceição e Ávila')).toBe(1);
    expect(count(t, 'Olá, Conceição')).toBe(1);
  });

  it('preserva os valores de formulário ao reabrir', async () => {
    const doc = await PDFDocument.load(await makeForm());
    doc.getForm().getTextField('nome').setText('Maria');
    const filled = await doc.save();
    const obj = makeText(0, { x: 60, y: 500, w: 200, h: 20 }, DEFAULT_STYLE, 'nota');
    const out = await stampObjects(filled, [{ obj, lines: [{ index: 0, text: 'nota' }], baseline: 0.9 }],
      { app: 'editor-pdf', version: 1, objects: [obj] });
    const reopened = await extractProject(out.bytes);
    const base = await PDFDocument.load(reopened!.base);
    expect(base.getForm().getTextField('nome').getText()).toBe('Maria');
  });

  it('troca por “?” caracteres que as fontes padrão do PDF não têm', async () => {
    const obj = makeText(0, { x: 60, y: 600, w: 300, h: 20 }, DEFAULT_STYLE, 'ok ✓');
    const out = await stampObjects(await makeFlatTable(), [{ obj, lines: [{ index: 0, text: 'ok ✓' }], baseline: 0.9 }],
      { app: 'editor-pdf', version: 1, objects: [obj] });
    expect(out.replaced).toBe(1);
    expect(await text(out.bytes)).toContain('ok ?');
  });

  it('PDF comum não é tratado como reeditável', async () => {
    expect(await extractProject(await makeFlatTable())).toBeNull();
  });
});
