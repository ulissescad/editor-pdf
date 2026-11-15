import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { History } from '../../src/editor/history.ts';
import { PDFDocument as PDFDoc, PDFName, PDFDict } from '@cantoo/pdf-lib';
import {
  DEFAULT_STYLE, clampRect, fieldName, makeField, makeImage, makeSymbol, makeText, minHeight, parseProject, today, uniqueName,
  type ImageAsset, type Project, type TextObj,
} from '../../src/editor/model.ts';
import { extractProject, projectFor, stampObjects } from '../../src/pdf/write.ts';
import { makeFlatTable, makeForm, makePng } from '../fixtures/make-fixtures.mjs';
import { baseFonts } from '../pdf-inspect.ts';

async function text(bytes: Uint8Array, page = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  return (await (await pdf.getPage(page)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
}
const count = (s: string, sub: string) => s.split(sub).length - 1;

/** Quantas imagens são desenhadas na página (operações do pdf.js). */
async function imageDraws(bytes: Uint8Array, page = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const { fnArray } = await (await pdf.getPage(page)).getOperatorList();
  return fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
}

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
    expect(ok?.project.objects).toHaveLength(1);
  });
  it('nomes de campo a partir de rótulos', () => {
    expect(fieldName('Nome Completo da Instituição:')).toBe('nome_completo_da_instituicao');
    expect(fieldName('Professor(a) Regente: ')).toBe('professor_a_regente');
    expect(fieldName('???')).toBe('campo');
    const taken = new Set(['nome']);
    expect(uniqueName('nome', taken)).toBe('nome_2');
    expect(uniqueName('nome', taken)).toBe('nome_3');
  });
  it('data de hoje no formato brasileiro', () => {
    expect(today(new Date(2026, 0, 5))).toBe('05/01/2026');
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
    expect((reopened?.project.objects[0] as TextObj).text).toBe('Olá, Conceição');
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

  it('imagem, símbolo e campo: gravados, e imagem/símbolo voltam editáveis ao reabrir', async () => {
    const png = new Uint8Array(makePng());
    const asset: ImageAsset = { id: 'img1', mime: 'image/png', bytes: png, w: 120, h: 60 };
    const assets = new Map([[asset.id, asset]]);
    const img = makeImage(0, { x: 300, y: 400, w: 120, h: 60 }, 'img1', true);
    const sym = makeSymbol(0, { x: 100, y: 300, w: 14, h: 14 }, 'check', '#1a3cc8');
    const field = { ...makeField(0, { x: 200, y: 718, w: 300, h: 20 }, 'text', 'nome_da_instituicao'), value: 'Escola Municipal' };
    const check = { ...makeField(0, { x: 60, y: 250, w: 12, h: 12 }, 'check', 'aceito'), value: 'sim' };
    const objects = [img, sym, field, check];
    const project = projectFor(objects, assets);
    expect(project.objects.map((o) => o.kind)).toEqual(['image', 'symbol']); // campos não vão para o projeto
    const out = await stampObjects(await makeFlatTable(), objects.map((obj) => ({ obj })), project, { assets });
    expect(out.fields).toBe(2);

    // Campos de verdade, já preenchidos
    const doc = await PDFDoc.load(out.bytes);
    expect(doc.getForm().getTextField('nome_da_instituicao').getText()).toBe('Escola Municipal');
    expect(doc.getForm().getCheckBox('aceito').isChecked()).toBe(true);
    // Imagem desenhada na página
    const xobj = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    expect(xobj?.keys().length).toBe(1);

    // Reabrir: imagem e símbolo voltam como objetos; o campo continua no PDF como campo preenchível
    const reopened = await extractProject(out.bytes);
    expect(reopened?.project.objects.map((o) => o.kind)).toEqual(['image', 'symbol']);
    expect(reopened?.assets).toHaveLength(1);
    expect(reopened?.assets[0].bytes).toEqual(png);
    const base = await PDFDoc.load(reopened!.base);
    expect(base.getForm().getTextField('nome_da_instituicao').getText()).toBe('Escola Municipal');
    expect(await text(reopened!.base)).toContain('01. DADOS DO ESTUDANTE');
    // Gravar de novo não duplica a imagem: a camada antiga foi removida ao reabrir
    const again = await stampObjects(reopened!.base, reopened!.project.objects.map((obj) => ({ obj })), reopened!.project,
      { assets: new Map(reopened!.assets.map((a) => [a.id, a])) });
    expect(await imageDraws(again.bytes)).toBe(1);
    expect(await imageDraws(reopened!.base)).toBe(0);
  });

  it('nomes de campos repetidos ou já existentes no PDF ganham sufixo', async () => {
    const a = makeField(0, { x: 200, y: 600, w: 100, h: 20 }, 'text', 'nome');
    const b = makeField(0, { x: 200, y: 560, w: 100, h: 20 }, 'text', 'nome');
    const out = await stampObjects(await makeForm(), [{ obj: a }, { obj: b }], { app: 'editor-pdf', version: 1, objects: [] });
    const names = (await PDFDoc.load(out.bytes)).getForm().getFields().map((f) => f.getName());
    expect(names).toEqual(expect.arrayContaining(['nome', 'nome_2', 'nome_3']));
  });

  it('fontes extras são embutidas (só os caracteres usados) e voltam ao reabrir', async () => {
    const loadFont = async (path: string) => new Uint8Array(readFileSync(`node_modules/@fontsource/${path}`));
    const modern = makeText(0, { x: 60, y: 600, w: 300, h: 20 }, { ...DEFAULT_STYLE, font: 'modern', bold: true, italic: true }, 'Ação moderna');
    const hand = makeText(0, { x: 60, y: 560, w: 300, h: 20 }, { ...DEFAULT_STYLE, font: 'hand', italic: true }, 'Letra à mão ✓');
    const objects = [modern, hand];
    const out = await stampObjects(await makeFlatTable(),
      objects.map((obj) => ({ obj, lines: [{ index: 0, text: obj.text }], baseline: 0.9 })),
      { app: 'editor-pdf', version: 1, objects }, { loadFont });
    const t = await text(out.bytes);
    expect(t).toContain('Ação moderna');
    expect(t).toContain('Letra à mão ?'); // ✓ não existe na fonte: vira “?”, como nas fontes padrão
    expect(out.replaced).toBe(1);
    const fonts = await baseFonts(out.bytes);
    expect(fonts.some((f) => f.startsWith('OpenSans-BoldItalic'))).toBe(true); // a variante certa
    expect(fonts.some((f) => f.startsWith('Caveat-Regular'))).toBe(true); // Caveat não tem itálico: usa a normal
    expect(out.bytes.length).toBeLessThan(80_000);
    const reopened = await extractProject(out.bytes);
    expect(reopened?.project.objects.map((o) => (o as TextObj).style.font)).toEqual(['modern', 'hand']);
    await expect(stampObjects(await makeFlatTable(), [{ obj: modern }], { app: 'editor-pdf', version: 1, objects: [] }))
      .rejects.toThrow('carregador');
  });

  it('PDF comum não é tratado como reeditável', async () => {
    expect(await extractProject(await makeFlatTable())).toBeNull();
  });
});
