// M3 · Páginas: geometria de páginas giradas, plano de páginas e montagem de PDFs (juntar, dividir, organizar).
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import {
  contentMatrix, fromView, localSize, normRot, toView, turnOf, userToView, viewSize, viewToUser, type PageGeo,
} from '../../src/editor/geom.ts';
import { groupLabel, parseRanges, remapObjects, allPages, type PageSpec } from '../../src/pdf/plan.ts';
import { Assembler, EncryptedError, assemble, imageLayout, imagesToPdf, loadPdf } from '../../src/pdf/pages.ts';
import { extractProject, projectFor, stampObjects } from '../../src/pdf/write.ts';
import { DEFAULT_STYLE, makeImage, makeSymbol, makeText, type ImageAsset, type Obj, type TextObj } from '../../src/editor/model.ts';
import { makeFlatTable, makeForm, makeNumbered, makePng, makeRotated } from '../fixtures/make-fixtures.mjs';

const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');

async function texts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await (await pdfjs()).getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    out.push(tc.items.map((i) => ('str' in i ? i.str : '')).join(' ').trim());
  }
  return out;
}

const ROTS = [0, 90, 180, 270] as const;
const GEO = (rotate: number): PageGeo => ({ view: [10, 20, 605, 862], rotate });

describe('geometria de páginas giradas', () => {
  it('normaliza ângulos', () => {
    expect(normRot(-90)).toBe(270);
    expect(normRot(450)).toBe(90);
    expect(normRot(360)).toBe(0);
  });

  it('ida e volta entre o PDF e a página vista, em qualquer giro', () => {
    for (const r of ROTS) {
      const g = GEO(r);
      const [vx, vy] = userToView(100, 300, g);
      expect(viewToUser(vx, vy, g)).toEqual([100, 300]);
      const rect = { x: 50, y: 400, w: 120, h: 30 };
      expect(fromView(toView(rect, g), g)).toEqual(rect);
    }
    expect(viewSize(GEO(90))).toEqual([842, 595]);
  });

  it('coincide com a conversão do pdf.js (viewport em escala 1)', async () => {
    const pdf = await (await pdfjs()).getDocument({ data: await makeRotated(), verbosity: 0 }).promise;
    const page = await pdf.getPage(2);
    for (const r of ROTS) {
      const vp = page.getViewport({ scale: 1, rotation: r });
      const [ex, ey] = vp.convertToViewportPoint(123, 456);
      const [vx, vy] = userToView(123, 456, { view: page.view, rotate: r });
      expect(vx).toBeCloseTo(ex, 6);
      expect(vy).toBeCloseTo(ey, 6);
    }
  });

  it('a matriz do conteúdo cabe no retângulo e deixa o objeto em pé na página com o mesmo giro', () => {
    const rect = { x: 100, y: 500, w: 40, h: 200 };
    for (const r of ROTS) {
      const [a, b, c, d, e, f] = contentMatrix(rect, r);
      const { w, h } = localSize(rect, r);
      const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(rect.x);
      expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(rect.x + rect.w);
      expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(rect.y - rect.h);
      expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(rect.y);
      // “Para cima” no conteúdo (0, 1) vira “para cima” na tela quando a página tem o mesmo giro
      const g = GEO(r);
      const [x0, y0] = userToView(e, f, g);
      const [x1, y1] = userToView(c + e, d + f, g);
      expect(x1 - x0).toBeCloseTo(0);
      expect(y1 - y0).toBeCloseTo(-1);
      expect(turnOf(r, r)).toBe(0);
    }
    expect(turnOf(0, 90)).toBe(90);
    expect(turnOf(90, 0)).toBe(270);
  });
});

describe('plano de páginas', () => {
  it('lê intervalos', () => {
    expect(parseRanges('1-3, 5', 8)).toEqual({ groups: [[0, 1, 2], [4]] });
    expect(parseRanges('7-', 8)).toEqual({ groups: [[6, 7]] });
    expect(parseRanges('-2', 8)).toEqual({ groups: [[0, 1]] });
    expect(parseRanges('3-1', 8)).toEqual({ groups: [[2, 1, 0]] });
    expect(parseRanges('2 a 4', 8)).toEqual({ groups: [[1, 2, 3]] });
    expect(parseRanges('9', 8)).toHaveProperty('error');
    expect(parseRanges('abc', 8)).toHaveProperty('error');
    expect(parseRanges(' ', 8)).toHaveProperty('error');
  });

  it('rótulos para nomes de arquivo', () => {
    expect(groupLabel([0, 1, 2])).toBe('1-3');
    expect(groupLabel([4])).toBe('5');
    expect(groupLabel([1, 3])).toBe('2_4');
  });

  it('objetos acompanham as páginas: reordenar, excluir e duplicar', () => {
    const a = makeText(0, { x: 10, y: 100, w: 50, h: 20 }, DEFAULT_STYLE, 'A');
    const b = makeText(1, { x: 10, y: 100, w: 50, h: 20 }, DEFAULT_STYLE, 'B');
    const c = makeSymbol(2, { x: 10, y: 100, w: 12, h: 12 }, 'check', '#000000');
    const specs: PageSpec[] = [{ src: 0, index: 1 }, { blank: true, width: 595, height: 842 }, { src: 0, index: 1 }, { src: 0, index: 0, rotate: 90 }];
    const out = remapObjects([[a, b, c]], specs);
    expect(out.map((o) => [o.page, (o as TextObj).text ?? o.kind])).toEqual([[0, 'B'], [2, 'B'], [3, 'A']]);
    expect(new Set(out.map((o) => o.id)).size).toBe(3); // a cópia ganhou id novo
    expect(out[0].id).toBe(b.id);
    expect(a.page).toBe(0); // não altera os originais
  });
});

describe('montar PDFs', () => {
  it('junta arquivos na ordem pedida', async () => {
    const one = await makeNumbered(3, 'Um');
    const two = await makeNumbered(2, 'Dois');
    const out = await assemble([one, two], [...allPages(1, 2), ...allPages(0, 3)]);
    expect(await texts(out)).toEqual(['Dois 1', 'Dois 2', 'Um 1', 'Um 2', 'Um 3']);
  });

  it('reordena, gira, exclui, duplica e insere página em branco', async () => {
    const out = await assemble([await makeNumbered()], [
      { src: 0, index: 4 }, { src: 0, index: 0, rotate: 90 }, { blank: true, width: 595, height: 842 }, { src: 0, index: 0 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0, 0]);
    expect(await texts(out)).toEqual(['Pagina 5', 'Pagina 1', '', 'Pagina 1']);
  });

  it('soma o giro ao giro que a página já tinha', async () => {
    const out = await assemble([await makeRotated()], [{ src: 0, index: 0, rotate: 270 }, { src: 0, index: 1, rotate: -90 }]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 270]);
  });

  it('mantém os formulários funcionando e renomeia campos repetidos', async () => {
    const form = await makeForm();
    const out = await assemble([form, form], [...allPages(0, 1), ...allPages(1, 1)]);
    const doc = await PDFDocument.load(out);
    const names = doc.getForm().getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(['aceito', 'aceito_2', 'codigo', 'codigo_2', 'nome', 'nome_2', 'turno', 'turno_2']);
    expect(doc.getForm().getTextField('codigo_2').getText()).toBe('ABC-123');
    // O pdf.js (o mesmo do editor) enxerga os campos
    const pdf = await (await pdfjs()).getDocument({ data: out.slice(), verbosity: 0 }).promise;
    const fields = await pdf.getFieldObjects() as Map<string, unknown[]> | Record<string, unknown[]>;
    const keys = fields instanceof Map ? [...fields.keys()] : Object.keys(fields ?? {});
    expect(keys).toEqual(expect.arrayContaining(['nome', 'nome_2']));
  });

  it('extrair uma página não carrega o resto do arquivo (nem pelos campos)', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([595, 842]);
    const p2 = doc.addPage([595, 842]);
    p1.drawText('Leve', { x: 50, y: 700, size: 20, font });
    // Página 2 “pesada”: milhares de retângulos
    for (let i = 0; i < 6000; i++) p2.drawRectangle({ x: (i * 7) % 560, y: (i * 13) % 800, width: 3 + (i % 5), height: 2, color: rgb((i % 7) / 7, 0.3, 0.5) });
    // Um campo com widgets nas duas páginas
    const tf = doc.getForm().createTextField('nome');
    tf.addToPage(p1, { x: 50, y: 600, width: 200, height: 20 });
    tf.addToPage(p2, { x: 50, y: 600, width: 200, height: 20 });
    const full = await doc.save();

    const page1 = await assemble([full], [{ src: 0, index: 0 }]);
    expect(page1.length).toBeLessThan(full.length / 4);
    const out = await PDFDocument.load(page1);
    const field = out.getForm().getTextField('nome');
    expect(field.acroField.getWidgets()).toHaveLength(1);
  });

  it('objetos do editor acompanham as páginas e continuam editáveis', async () => {
    const base = await makeFlatTable();
    const objs: Obj[] = [
      makeText(0, { x: 60, y: 700, w: 200, h: 20 }, DEFAULT_STYLE, 'Texto da um'),
      makeText(1, { x: 60, y: 700, w: 200, h: 20 }, DEFAULT_STYLE, 'Texto da dois'),
    ];
    const edited = (await stampObjects(base, objs.map((obj) => ({ obj })), projectFor(objs, new Map()))).bytes;
    const out = await assemble([edited], [{ src: 0, index: 1 }, { src: 0, index: 0 }, { src: 0, index: 1 }]);
    expect((await texts(out)).map((t) => t.includes('Texto da dois'))).toEqual([true, false, true]);
    const reopened = await extractProject(out);
    expect(reopened).not.toBeNull();
    const byPage = reopened!.project.objects.map((o) => [o.page, (o as TextObj).text]).sort();
    expect(byPage).toEqual([[0, 'Texto da dois'], [1, 'Texto da um'], [2, 'Texto da dois']]);
    // O PDF base (sem a camada) não tem mais os textos: nada fica duplicado ao gravar de novo
    expect((await texts(reopened!.base)).some((t) => t.includes('Texto da'))).toBe(false);
  });

  it('juntar dois PDFs do editor mantém as imagens dos dois, mesmo com ids iguais', async () => {
    const png = new Uint8Array(makePng());
    const asset = (id: string): ImageAsset => ({ id, mime: 'image/png', bytes: png, w: 120, h: 60 });
    const make = async (label: string) => {
      const img = makeImage(0, { x: 50, y: 600, w: 120, h: 60 }, 'img1');
      const txt = makeText(0, { x: 50, y: 700, w: 200, h: 20 }, DEFAULT_STYLE, label);
      const assets = new Map([['img1', asset('img1')]]);
      return (await stampObjects(await makeNumbered(1, label), [{ obj: img }, { obj: txt }], projectFor([img, txt], assets), { assets })).bytes;
    };
    const out = await assemble([await make('A'), await make('B')], [{ src: 0, index: 0 }, { src: 1, index: 0 }]);
    const reopened = (await extractProject(out))!;
    const images = reopened.project.objects.filter((o) => o.kind === 'image');
    expect(images).toHaveLength(2);
    expect(images.map((o) => o.page).sort()).toEqual([0, 1]);
    const ids = new Set(reopened.assets.map((a) => a.id));
    for (const o of images) expect(ids.has((o as { imageId: string }).imageId)).toBe(true);
  });

  it('PDF com senha de abertura é recusado; só com senha do dono abre', async () => {
    const make = async (userPassword: string) => {
      const doc = await PDFDocument.load(await makeNumbered(1));
      doc.encrypt({ userPassword, ownerPassword: 'dono' });
      return doc.save();
    };
    await expect(loadPdf(await make('segredo'))).rejects.toBeInstanceOf(EncryptedError);
    const owner = await loadPdf(await make(''));
    expect(owner.getPageCount()).toBe(1);
    const out = await assemble([await make('')], [{ src: 0, index: 0 }]);
    expect(await texts(out)).toEqual(['Pagina 1']);
  });

  it('informa tamanho e giro das páginas', async () => {
    const a = await Assembler.load([await makeRotated()]);
    expect(a.pageSize(0, 0)).toEqual({ width: 842, height: 595, rotate: 90 });
    expect(a.pageSize(0, 1)).toEqual({ width: 595, height: 842, rotate: 0 });
  });
});

describe('texto em página girada', () => {
  it('sai em pé para quem lê (gira com a página)', async () => {
    const base = await makeRotated();
    const obj = makeText(0, { x: 100, y: 600, w: 30, h: 200 }, DEFAULT_STYLE, 'Em pe', 90);
    const { bytes } = await stampObjects(base, [{ obj }], projectFor([obj], new Map()));
    const pdf = await (await pdfjs()).getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    const page = await pdf.getPage(1);
    const item = (await page.getTextContent()).items.find((i) => 'str' in i && i.str === 'Em pe') as { transform: number[] };
    expect(item).toBeTruthy();
    // Texto girado 90° no sentido anti-horário no PDF: com a página girada 90° (horário), fica em pé
    const [a, b] = item.transform;
    expect(a).toBeCloseTo(0);
    expect(b).toBeGreaterThan(0);
    // E dentro do retângulo do objeto
    const [, , , , e, f] = item.transform;
    expect(e).toBeGreaterThan(100);
    expect(e).toBeLessThan(130);
    expect(f).toBeGreaterThan(400);
    expect(f).toBeLessThan(600);
  });

  it('campo criado em página girada fica girado junto (MK /R)', async () => {
    const base = await makeRotated();
    const field: Obj = { id: 'f1', kind: 'field', page: 0, rect: { x: 100, y: 600, w: 20, h: 200 }, type: 'text', name: 'nome', value: 'Ana', size: 10, multiline: false, rot: 90 };
    const { bytes } = await stampObjects(base, [{ obj: field }], projectFor([field], new Map()));
    const doc = await PDFDocument.load(bytes);
    const widget = doc.getForm().getTextField('nome').acroField.getWidgets()[0];
    const r = widget.getRectangle();
    expect([r.x, r.y, r.width, r.height].map(Math.round)).toEqual([100, 400, 20, 200]);
    expect(widget.getAppearanceCharacteristics()?.getRotation()).toBe(90);
  });
});

describe('imagens para PDF', () => {
  const opts = { size: 'a4' as const, orientation: 'auto' as const, margin: 20 };
  it('centraliza e escolhe a orientação pela imagem', () => {
    const tall = imageLayout({ w: 1000, h: 2000 }, opts);
    expect(tall.page).toEqual([595.28, 841.89]);
    expect(tall.h).toBeCloseTo(841.89 - 40);
    const wide = imageLayout({ w: 3000, h: 1000 }, opts);
    expect(wide.page).toEqual([841.89, 595.28]);
    expect(wide.w).toBeCloseTo(841.89 - 40);
    expect(wide.x).toBeCloseTo(20);
    expect(imageLayout({ w: 3000, h: 1000 }, { ...opts, orientation: 'portrait' }).page).toEqual([595.28, 841.89]);
    const same = imageLayout({ w: 400, h: 200 }, { ...opts, size: 'image', margin: 0 });
    expect(same.page).toEqual([300, 150]);
  });

  it('gera uma página por imagem', async () => {
    const png = new Uint8Array(makePng());
    const out = await imagesToPdf([{ mime: 'image/png', bytes: png, w: 120, h: 60 }, { mime: 'image/png', bytes: png, w: 120, h: 60 }], opts);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(842); // imagem deitada → página deitada
  });
});

describe('girar sem perder a página original', () => {
  it('rotação aplicada com degrees', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().setRotation(degrees(180));
    const out = await assemble([await doc.save()], [{ src: 0, index: 0, rotate: 180 }]);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(0);
  });
});
