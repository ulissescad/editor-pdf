// M4 · Anotar: seleção de texto pela geometria, desenho vetorial e anotações no PDF.
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from '@cantoo/pdf-lib';
import {
  makeInk, makeMarkup, makeNote, makeShape, makeText, parseProject, DEFAULT_STYLE, type Obj,
} from '../../src/editor/model.ts';
import {
  inkPath, markupRects, packInk, packLine, quadPoints, shapeGeometry, smoothPath, thinPoints, unionRect,
} from '../../src/editor/draw.ts';
import { caretAt, selectBetween, textRuns, wordAt, type TextRun } from '../../src/editor/textsel.ts';
import { extractProject, projectFor, stampObjects } from '../../src/pdf/write.ts';
import { makeText as makeTextPdf } from '../fixtures/make-fixtures.mjs';

async function pdfjsDoc(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
}

/** Trechos de texto de uma página, como o editor obtém no navegador. */
async function runsOf(bytes: Uint8Array, page = 1): Promise<TextRun[]> {
  const tc = await (await (await pdfjsDoc(bytes)).getPage(page)).getTextContent();
  return textRuns(tc.items as never[], tc.styles as never);
}

const ONLY_MLCZ = /^[MLCZ0-9.\s-]*$/;

describe('seleção de texto pela geometria', () => {
  it('acha o cursor no texto e ignora toques longe dele', async () => {
    const runs = await runsOf(await makeTextPdf());
    expect(runs.length).toBeGreaterThanOrEqual(4);
    // Linha 1: base em y = 760, começa em x = 60, fonte 16
    const c = caretAt(runs, 61, 765, undefined, 6);
    expect(c).toEqual({ run: 0, idx: 0 });
    expect(caretAt(runs, 300, 400, undefined, 6)).toBeNull(); // meio da página, sem texto
    expect(caretAt(runs, 300, 400)).not.toBeNull();          // sem tolerância: o mais próximo
  });

  it('arrastar de uma linha a outra marca o fim da primeira e o começo da segunda', async () => {
    const runs = await runsOf(await makeTextPdf());
    const a = caretAt(runs, 61, 765)!;      // começo da linha 1
    const b = caretAt(runs, 100, 741)!;     // no meio da linha 2
    const sel = selectBetween(runs, b, a)!; // ordem invertida também vale
    expect(sel.quads).toHaveLength(2);
    expect(sel.rot).toBe(0);
    expect(sel.text.startsWith('Primeira linha do texto')).toBe(true);
    expect(sel.text).toMatch(/dedo\. Seg/);
    // A linha 1 inteira: de x = 60 até o fim do texto, e da descendente à ascendente da fonte
    const [q1, q2] = sel.quads;
    expect(q1.x).toBeCloseTo(60, 0);
    expect(q1.y).toBeGreaterThan(770);
    expect(q1.y - q1.h).toBeLessThan(758);
    expect(q2.y).toBeLessThan(q1.y - q1.h + 10);
  });

  it('um toque marca a palavra inteira', async () => {
    const runs = await runsOf(await makeTextPdf());
    const c = caretAt(runs, 85, 765)!; // dentro de “Primeira”
    const sel = wordAt(runs, c)!;
    expect(sel.text).toBe('Primeira');
    expect(sel.quads).toHaveLength(1);
  });

  it('texto em página girada corre na vertical do PDF (rot 90)', () => {
    // Texto que sobe pela página: direção (0, 1), como numa página com /Rotate 90 lida em pé
    const runs = textRuns([{ str: 'vertical', transform: [0, 12, -12, 0, 300, 100], width: 48, fontName: 'f' }], { f: {} });
    expect(runs[0].rot).toBe(90);
    const sel = selectBetween(runs, { run: 0, idx: 0 }, { run: 0, idx: 8 })!;
    expect(sel.rot).toBe(90);
    const q = sel.quads[0];
    expect(q.h).toBeCloseTo(48, 0);      // comprimento do texto na vertical
    expect(q.w).toBeCloseTo(12, 0);      // altura da linha na horizontal
    expect(q.x).toBeCloseTo(300 - 12 * 0.8, 1);
  });
});

describe('desenho vetorial', () => {
  it('caminhos usam só M, L, C e Z (iguais no SVG e no PDF)', () => {
    expect(smoothPath([0, 0, 10, 5, 20, 0, 30, 8])).toMatch(ONLY_MLCZ);
    expect(smoothPath([5, 5])).toBe('M5 5 L5.01 5'); // um toque vira um ponto
    for (const shape of ['rect', 'ellipse', 'line', 'arrow', 'whiteout'] as const) {
      const g = shapeGeometry({ shape, width: 2, ends: [0.1, 0.1, 0.9, 0.9] }, 100, 50);
      for (const d of [g.stroke, g.fill]) if (d) expect(d).toMatch(ONLY_MLCZ);
    }
  });

  it('formas: traço por dentro da caixa, seta com ponta preenchida, corretivo só preenchido', () => {
    expect(shapeGeometry({ shape: 'rect', width: 4 }, 100, 50).stroke).toBe('M2 2 L98 2 L98 48 L2 48 Z');
    const arrow = shapeGeometry({ shape: 'arrow', width: 2, ends: [0, 0, 1, 0] }, 100, 20);
    expect(arrow.fill).toMatch(/^M100 0 /);
    const wo = shapeGeometry({ shape: 'whiteout', width: 2 }, 100, 50);
    expect(wo.stroke).toBeUndefined();
    expect(wo.fill).toBe('M0 0 L100 0 L100 50 L0 50 Z');
  });

  it('caneta: pontos normalizados na caixa (com margem da espessura) e pontos repetidos descartados', () => {
    const { box, paths } = packInk([[10, 10, 50, 30]], 4);
    expect(box).toEqual({ x: 7, y: 7, w: 46, h: 26 });
    expect(paths[0].every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(inkPath(paths, box.w, box.h)).toBe('M3 3 L43 23'); // volta ao lugar no quadro da caixa
    expect(thinPoints([0, 0, 0.1, 0, 0.2, 0, 5, 5, 5.1, 5], 1)).toEqual([0, 0, 5, 5, 5.1, 5]);
  });

  it('linha e seta: pontas normalizadas, margem maior para a ponta da seta', () => {
    const line = packLine([10, 10], [110, 10], 2, false);
    const arrow = packLine([10, 10], [110, 10], 2, true);
    expect(arrow.box.w).toBeGreaterThan(line.box.w);
    const [u0, v0, u1, v1] = line.ends;
    expect(line.box.x + u0 * line.box.w).toBeCloseTo(10);
    expect(line.box.y + v1 * line.box.h).toBeCloseTo(10);
    expect(u1).toBeGreaterThan(u0);
    expect(v0).toBeCloseTo(0.5);
  });

  it('sublinhado embaixo e riscado no meio da linha, na direção do texto', () => {
    const q = { x: 100, y: 700, w: 200, h: 20 };
    const [u] = markupRects({ type: 'underline', quads: [q] });
    const [s] = markupRects({ type: 'strike', quads: [q] });
    expect(u.w).toBeCloseTo(200);
    expect(u.y).toBeLessThan(685);           // perto da base da linha
    expect(s.y - s.h / 2).toBeCloseTo(689, 0); // no meio
    // Texto girado 90°: a faixa fica na vertical, do lado “de baixo” do texto (x maior)
    const qv = { x: 100, y: 700, w: 20, h: 200 };
    const [uv] = markupRects({ type: 'underline', quads: [qv], rot: 90 });
    expect(uv.h).toBeCloseTo(200);
    expect(uv.x).toBeGreaterThan(115);
    expect(markupRects({ type: 'highlight', quads: [q] })).toEqual([q]);
  });

  it('QuadPoints na ordem do Acrobat: sup. esquerdo, sup. direito, inf. esquerdo, inf. direito', () => {
    expect(quadPoints({ quads: [{ x: 10, y: 50, w: 30, h: 10 }] })).toEqual([10, 50, 40, 50, 10, 40, 40, 40]);
    expect(unionRect([{ x: 10, y: 50, w: 30, h: 10 }, { x: 0, y: 30, w: 5, h: 5 }])).toEqual({ x: 0, y: 50, w: 40, h: 25 });
  });
});

describe('projeto com anotações', () => {
  it('aceita os tipos novos e rejeita dados inválidos', () => {
    const objs: Obj[] = [
      makeMarkup(0, { x: 10, y: 50, w: 30, h: 10 }, 'highlight', '#ffe500', [{ x: 10, y: 50, w: 30, h: 10 }], 'oi'),
      makeInk(0, { x: 10, y: 50, w: 30, h: 10 }, [[0, 0, 1, 1]], '#000000', 2),
      makeShape(0, { x: 10, y: 50, w: 30, h: 10 }, 'arrow', '#c62828', 2, [0, 0, 1, 1]),
      makeNote(0, { x: 10, y: 50, w: 20, h: 20 }, '#ffd84d', 'nota'),
    ];
    const bad = [
      { ...objs[0], color: 'red' },
      { ...objs[1], paths: [['x']] },
      { ...objs[2], shape: 'star' },
      { ...objs[3], text: 3 },
    ];
    const parsed = parseProject(JSON.stringify({ app: 'editor-pdf', version: 1, objects: [...objs, ...bad] }))!;
    expect(parsed.project.objects.map((o) => o.kind)).toEqual(['markup', 'ink', 'shape', 'note']);
  });
});

describe('gravação das anotações', () => {
  async function stamped() {
    const base = await makeTextPdf();
    const quads = [{ x: 60, y: 774, w: 200, h: 18 }];
    const objs: Obj[] = [
      makeMarkup(0, unionRect(quads), 'highlight', '#ffe500', quads, 'Primeira linha'),
      makeMarkup(0, unionRect(quads), 'strike', '#c62828', quads),
      makeNote(0, { x: 400, y: 780, w: 20, h: 20 }, '#ffd84d', 'Comentário com acentuação ✓'),
      makeInk(0, { x: 100, y: 500, w: 100, h: 50 }, [[0, 0, 0.5, 1, 1, 0]], '#1a3cc8', 2),
      makeInk(0, { x: 100, y: 400, w: 100, h: 50 }, [[0, 0.5, 1, 0.5]], '#ffe500', 12, 0.45),
      makeShape(0, { x: 300, y: 500, w: 100, h: 50 }, 'whiteout', '#ffffff', 2),
      makeShape(0, { x: 300, y: 400, w: 100, h: 50 }, 'arrow', '#c62828', 2, [0, 0, 1, 1]),
      makeText(0, { x: 60, y: 300, w: 200, h: 20 }, DEFAULT_STYLE, 'texto comum'),
    ];
    const { bytes } = await stampObjects(base, objs.map((obj) => ({ obj })), projectFor(objs, new Map()));
    return { bytes, objs };
  }

  it('destaque, riscado e nota viram anotações de verdade, com aparência e o texto marcado', async () => {
    const { bytes } = await stamped();
    const annots = await (await (await pdfjsDoc(bytes)).getPage(1)).getAnnotations();
    const bySub = Object.fromEntries(annots.map((a) => [a.subtype, a]));
    expect(Object.keys(bySub).sort()).toEqual(['Highlight', 'StrikeOut', 'Text']);
    for (const a of annots) expect(a.hasAppearance).toBe(true);
    expect(bySub.Highlight.contentsObj.str).toBe('Primeira linha');
    expect(bySub.Text.contentsObj.str).toBe('Comentário com acentuação ✓');
    expect([...bySub.Highlight.quadPoints]).toEqual([60, 774, 260, 774, 60, 756, 260, 756]);

    // O destaque multiplica com a página (marca-texto) e a anotação leva a marca do editor
    const doc = await PDFDocument.load(bytes);
    const arr = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const hl = [...Array(arr.size()).keys()].map((i) => arr.lookup(i, PDFDict))
      .find((d) => d.get(PDFName.of('Subtype')) === PDFName.of('Highlight'))!;
    expect(hl.get(PDFName.of('EditorPDF'))).toBe(PDFName.of('Objetos'));
    const ap = hl.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFStream);
    const gs = ap.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict).lookup(PDFName.of('GS0'), PDFDict);
    expect(gs.get(PDFName.of('BM'))).toBe(PDFName.of('Multiply'));
  });

  it('caneta e formas são desenho vetorial; o corretivo é um preenchimento branco', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { bytes } = await stamped();
    const ops = await (await (await pdfjsDoc(bytes)).getPage(1)).getOperatorList();
    const OPS = pdfjs.OPS;
    // pdf.js agrupa os caminhos em constructPath; basta conferir que há traços e preenchimentos
    expect(ops.fnArray.filter((f) => f === OPS.constructPath).length).toBeGreaterThanOrEqual(4);
    const fills = ops.fnArray.map((f, i) => (f === OPS.setFillRGBColor ? ops.argsArray[i] : null)).filter(Boolean);
    expect(fills.some((c) => /#?ffffff|255,255,255/i.test(String(c)))).toBe(true);
  });

  it('reabrir devolve todos os objetos editáveis, sem as anotações nem a camada (não duplica)', async () => {
    const { bytes, objs } = await stamped();
    const back = (await extractProject(bytes))!;
    expect(back.project.objects.map((o) => o.kind)).toEqual(objs.map((o) => o.kind));
    const base = await PDFDocument.load(back.base);
    expect(base.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0);
    // Gravar de novo produz o mesmo número de anotações
    const again = await stampObjects(back.base, back.project.objects.map((obj) => ({ obj })), back.project);
    const annots = await (await (await pdfjsDoc(again.bytes)).getPage(1)).getAnnotations();
    expect(annots).toHaveLength(3);
  });

  it('anotações de outros programas não são removidas ao reabrir', async () => {
    const { bytes } = await stamped();
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const foreign = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50] }));
    page.node.addAnnot(foreign);
    const back = (await extractProject(await doc.save()))!;
    const base = await PDFDocument.load(back.base);
    const left = base.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(left.size()).toBe(1);
    expect(left.get(0)).toBeInstanceOf(PDFRef);
    expect(left.lookup(0, PDFDict).get(PDFName.of('Subtype'))).toBe(PDFName.of('Square'));
  });

  it('nota em página girada: a aparência gira junto (Matrix)', async () => {
    const base = await makeTextPdf();
    const note = makeNote(1, { x: 300, y: 300, w: 20, h: 20 }, '#ffd84d', 'em pé', 90);
    const { bytes } = await stampObjects(base, [{ obj: note }], projectFor([note], new Map()));
    const doc = await PDFDocument.load(bytes);
    const arr = doc.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray);
    const ap = arr.lookup(0, PDFDict).lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFStream);
    expect(ap.dict.lookup(PDFName.of('Matrix'), PDFArray).asArray().map(String)).toEqual(['0', '1', '-1', '0', '0', '0']);
  });
});
