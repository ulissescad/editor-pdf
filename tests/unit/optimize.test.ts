// M5 · Otimizar e proteger: senha (qpdf), números de página, marca d’água, recortar, propriedades,
// achatar, compressão leve e a busca da tarja. O que depende de canvas (compressão forte, pintura da
// tarja) é testado de ponta a ponta (tests/e2e/optimize.spec.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { ALL_ALLOWED, WrongPasswordError, encryptArgs, encryptionOf, protect, setQpdfLoader, unlock } from '../../src/pdf/qpdf.ts';
import {
  NUMBER_DEFAULTS, WATERMARK_DEFAULTS, addPageNumbers, addWatermark, numberAt, numberLabel, pageGeo, singlePage,
  uprightMatrix, watermarkPlacements,
} from '../../src/pdf/stamp.ts';
import { applyCrop, clampMargins, contentBounds, cropBoxFor, marginsFromBounds } from '../../src/pdf/crop.ts';
import { clearInfo, readInfo, writeInfo } from '../../src/pdf/meta.ts';
import { appearanceMatrix, flattenDoc } from '../../src/pdf/flatten.ts';
import {
  compressDoc, deflatePlainStreams, dropUnused, imageSource, toRgba, undoPngPredictor, LIGHT, type Recoder,
} from '../../src/pdf/compress.ts';
import { PATTERNS, findMatches, pageText, queryRegex } from '../../src/pdf/redact.ts';
import { loadPdf } from '../../src/pdf/pages.ts';
import { extractProject, projectFor, stampObjects } from '../../src/pdf/write.ts';
import { makeMarkup, makeText as makeTextObj, DEFAULT_STYLE } from '../../src/editor/model.ts';
import { textRuns } from '../../src/editor/textsel.ts';
import { makeForm, makeNumbered, makePng, makeRotated } from '../fixtures/make-fixtures.mjs';

const require = createRequire(import.meta.url);

async function pdfjsDoc(bytes: Uint8Array, password?: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
}

async function texts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await pdfjsDoc(bytes);
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    out.push(tc.items.map((i) => ('str' in i ? i.str : '')).join(' ').trim());
  }
  return out;
}

/** Onde cada texto aparece na página vista (pt, origem no canto superior esquerdo). */
async function placed(bytes: Uint8Array, pageNumber = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await (await pdfjsDoc(bytes)).getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return {
    width: vp.width, height: vp.height,
    items: tc.items.filter((i) => 'str' in i && i.str.trim()).map((i) => {
      const it = i as { str: string; transform: number[] };
      const [, , , , x, y] = pdfjs.Util.transform(vp.transform, it.transform);
      // Direção do texto na tela (0 = lendo da esquerda para a direita)
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      return { str: it.str, x, y, angle: Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI) };
    }),
  };
}

// ======================= Senha =======================

describe('senha (qpdf em WebAssembly)', () => {
  beforeAll(() => {
    setQpdfLoader((log) => (createQpdf as unknown as (o: object) => Promise<never>)({
      locateFile: () => require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'), noInitialRun: true, print: log, printErr: log,
    }));
  });

  it('protege com AES-256, reconhece o tipo de proteção e desbloqueia só com a senha certa', async () => {
    const form = await makeForm();
    expect(await encryptionOf(form)).toBe('none');
    const enc = await protect(form, 'segredo-1');
    expect(await encryptionOf(enc)).toBe('password');
    expect(new TextDecoder('latin1').decode(enc)).toMatch(/\/V\s+5/); // AES-256
    await expect(pdfjsDoc(enc)).rejects.toMatchObject({ name: 'PasswordException' });
    expect((await pdfjsDoc(enc, 'segredo-1')).numPages).toBe(1);

    await expect(unlock(enc, 'errada')).rejects.toBeInstanceOf(WrongPasswordError);
    const dec = await unlock(enc, 'segredo-1');
    expect(await encryptionOf(dec)).toBe('none');
    expect((await PDFDocument.load(dec)).getForm().getTextField('codigo').getText()).toBe('ABC-123');
  });

  it('restrições: a senha de abrir não serve para tirá-las e o leitor vê as permissões', async () => {
    expect(encryptArgs('a', 'b', { print: false, copy: false, modify: true })).toEqual(
      ['--encrypt', 'a', 'b', '256', '--print=none', '--extract=n', '--']);
    expect(encryptArgs('a', 'a', ALL_ALLOWED)).toEqual(['--encrypt', 'a', 'a', '256', '--']);

    const enc = await protect(await makeForm(), 'abrir', { print: false, copy: true, modify: true });
    const perms = await (await pdfjsDoc(enc, 'abrir')).getPermissions();
    expect(perms).not.toBeNull();
    expect(perms).not.toContain(4); // PermissionFlag.PRINT
    // Com a senha de abrir, desbloquear funciona (e tira as restrições)
    expect(await encryptionOf(await unlock(enc, 'abrir'))).toBe('none');
  });

  it('PDF só com restrições do dono: abre sem senha e é desbloqueado sem senha', async () => {
    const restricted = await protect(await makeForm(), 'x', { print: false, copy: false, modify: false });
    // Cria um PDF que abre sem senha mas tem restrições (senha de abrir vazia)
    const q = await (await import('../../src/pdf/qpdf.ts')).loadQpdf();
    q.FS.writeFile('/r-in.pdf', await makeForm());
    q.callMain(['--encrypt', '', 'dono', '256', '--print=none', '--', '/r-in.pdf', '/r-out.pdf']);
    const ownerOnly = q.FS.readFile('/r-out.pdf').slice();
    expect(await encryptionOf(ownerOnly)).toBe('restrictions');
    expect(await encryptionOf(await unlock(ownerOnly))).toBe('none');
    expect(await encryptionOf(restricted)).toBe('password');

    // As ferramentas que alteram o PDF no lugar também abrem esse tipo de arquivo
    const doc = await loadPdf(ownerOnly);
    await addPageNumbers(doc, NUMBER_DEFAULTS);
    const saved = await doc.save();
    expect((await texts(saved))[0]).toContain('Formulario de teste');
    expect((await texts(saved))[0]).toMatch(/\b1$/);
  });
});

// ======================= Números de página =======================

describe('números de página', () => {
  it('formatos, primeira página numerada e número inicial', () => {
    const o = { ...NUMBER_DEFAULTS };
    expect(numberLabel(0, 5, o)).toBe('1');
    expect(numberLabel(4, 5, { ...o, format: 'n-de' })).toBe('5 de 5');
    expect(numberLabel(1, 5, { ...o, format: 'pag-de' })).toBe('Página 2 de 5');
    expect(numberLabel(2, 5, { ...o, format: 'traco' })).toBe('– 3 –');
    // Capa sem número: começa na página 2 com o número 1
    const capa = { ...o, from: 2, start: 1, format: 'n-de' as const };
    expect(numberLabel(0, 5, capa)).toBeNull();
    expect(numberLabel(1, 5, capa)).toBe('1 de 4');
    expect(numberLabel(4, 5, capa)).toBe('4 de 4');
    expect(numberLabel(0, 3, { ...o, start: 10 })).toBe('10');
  });

  it('posição nos 6 lugares, a partir da margem', () => {
    const page: [number, number] = [600, 800];
    const t = { w: 40, ascent: 8 };
    expect(numberAt('bl', page, t, 20)).toEqual([20, 20]);
    expect(numberAt('bc', page, t, 20)).toEqual([280, 20]);
    expect(numberAt('br', page, t, 20)).toEqual([540, 20]);
    expect(numberAt('tr', page, t, 20)).toEqual([540, 772]);
  });

  it('grava os números embaixo e no centro, inclusive em páginas giradas e paisagem', async () => {
    const doc = await PDFDocument.load(await makeNumbered());
    await addPageNumbers(doc, { ...NUMBER_DEFAULTS, format: 'n-de' });
    const bytes = await doc.save();
    const t = await texts(bytes);
    expect(t[0]).toContain('1 de 5');
    expect(t[2]).toContain('3 de 5'); // página paisagem

    const rot = await PDFDocument.load(await makeRotated());
    await addPageNumbers(rot, { ...NUMBER_DEFAULTS, position: 'br' });
    const out = await rot.save();
    for (const n of [1, 2]) {
      const p = await placed(out, n);
      const num = p.items.find((i) => i.str === String(n))!;
      expect(num, `página ${n}`).toBeTruthy();
      expect(num.angle).toBe(0);                       // em pé na tela
      expect(num.x).toBeGreaterThan(p.width - 60);       // à direita
      expect(num.y).toBeGreaterThan(p.height - 40);      // embaixo (linha de base perto da margem)
    }
  });

  it('o quadro em pé da página leva (0,0) ao canto inferior esquerdo visto', () => {
    for (const rotate of [0, 90, 180, 270]) {
      const g = { view: [0, 0, 600, 800], rotate };
      const [a, b, c, d, e, f] = uprightMatrix(g);
      expect([a * 0 + c * 0 + e, b * 0 + d * 0 + f]).toEqual(
        rotate === 0 ? [0, 0] : rotate === 90 ? [600, 0] : rotate === 180 ? [600, 800] : [0, 800]);
    }
  });
});

// ======================= Marca d’água =======================

describe('marca d’água', () => {
  it('posições: uma no centro ou mosaico cobrindo a página', () => {
    const [c] = watermarkPlacements([600, 800], [200, 40], 0, false);
    expect(c).toEqual({ x: 200, y: 380, angle: 0 });
    const tiles = watermarkPlacements([600, 800], [120, 20], 45, true);
    expect(tiles.length).toBeGreaterThan(8);
    // O centro de cada cópia fica sobre a página (ou logo ao lado)
    const t = (45 * Math.PI) / 180;
    for (const p of tiles) {
      const cx = p.x + Math.cos(t) * 60 - Math.sin(t) * 10, cy = p.y + Math.sin(t) * 60 + Math.cos(t) * 10;
      expect(cx).toBeGreaterThan(-70); expect(cx).toBeLessThan(670);
      expect(cy).toBeGreaterThan(-70); expect(cy).toBeLessThan(870);
    }
  });

  it('texto na diagonal, por baixo do conteúdo, só nas páginas escolhidas', async () => {
    const doc = await PDFDocument.load(await makeNumbered(3));
    const { replaced } = await addWatermark(doc, { ...WATERMARK_DEFAULTS, text: 'Cópia não controlada 你', under: true }, [0, 2]);
    expect(replaced).toBe(1);
    const bytes = await doc.save();
    const t = await texts(bytes);
    expect(t[0]).toContain('Cópia não controlada ?');
    expect(t[1]).not.toContain('Cópia');
    expect(t[2]).toContain('Cópia');
    // Por baixo: o primeiro fluxo de conteúdo da página é o da marca
    const again = await PDFDocument.load(bytes);
    const contents = again.getPage(0).node.Contents() as PDFArray;
    const first = again.context.lookup(contents.get(0)) as PDFRawStream;
    const { decodePDFRawStream } = await import('@cantoo/pdf-lib');
    expect(new TextDecoder('latin1').decode(decodePDFRawStream(first).decode())).toMatch(/\bTj\b|\bTJ\b/);
    const p = await placed(bytes, 1);
    const mark = p.items.find((i) => i.str.startsWith('Cópia'))!;
    expect(mark.angle).toBeLessThan(-40); // sobe na diagonal (na tela, y para baixo)
  });

  it('imagem com transparência e prévia de uma página só', async () => {
    const src = await PDFDocument.load(await makeForm()); // tem widgets: a prévia não pode arrastar o arquivo todo
    const one = await singlePage(src, 0);
    await addWatermark(one, { ...WATERMARK_DEFAULTS, kind: 'image', image: { bytes: makePng(), mime: 'image/png', w: 120, h: 60 }, tile: true });
    const bytes = await one.save();
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/\/Subtype\s*\/Image/);
  });
});

// ======================= Recortar =======================

describe('recortar margens', () => {
  it('margens na página vista viram a caixa certa no PDF, com qualquer giro', () => {
    const m = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(cropBoxFor({ view: [0, 0, 600, 800], rotate: 0 }, m)).toEqual({ x: 40, y: 30, width: 540, height: 760 });
    // Girada 90°: a borda de cima vista é a borda esquerda do PDF
    expect(cropBoxFor({ view: [0, 0, 600, 800], rotate: 90 }, m)).toEqual({ x: 10, y: 40, width: 560, height: 740 });
    expect(cropBoxFor({ view: [0, 0, 600, 800], rotate: 180 }, m)).toEqual({ x: 20, y: 10, width: 540, height: 760 });
    expect(cropBoxFor({ view: [0, 0, 600, 800], rotate: 270 }, m)).toEqual({ x: 30, y: 20, width: 560, height: 740 });
    // Caixa que já não começa em 0
    expect(cropBoxFor({ view: [100, 50, 700, 850], rotate: 0 }, m)).toEqual({ x: 140, y: 80, width: 540, height: 760 });
  });

  it('não deixa o recorte engolir a página', () => {
    const m = clampMargins({ top: 500, right: 0, bottom: 500, left: 0 }, [600, 800]);
    expect(m.top + m.bottom).toBeCloseTo(800 - 36);
  });

  it('acha o conteúdo nos pixels e ignora pontinhos soltos', () => {
    const w = 100, h = 80;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    const ink = (x: number, y: number) => { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; };
    for (let y = 20; y < 50; y++) for (let x = 30; x < 70; x++) ink(x, y);
    ink(2, 2); // sujeira
    expect(contentBounds(px, w, h)).toEqual({ x: 30, y: 20, w: 40, h: 30 });
    expect(contentBounds(new Uint8ClampedArray(w * h * 4).fill(255), w, h)).toBeNull();
    expect(marginsFromBounds({ x: 30, y: 20, w: 40, h: 30 }, w, h, 2, 1)).toEqual({ left: 14, top: 9, right: 14, bottom: 14 });
  });

  it('grava a CropBox (a página vista fica menor)', async () => {
    const doc = await PDFDocument.load(await makeRotated());
    applyCrop(doc, (i) => (i === 0 ? { top: 50, right: 0, bottom: 0, left: 0 } : null));
    const bytes = await doc.save();
    const pdf = await pdfjsDoc(bytes);
    const v1 = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const v2 = (await pdf.getPage(2)).getViewport({ scale: 1 });
    expect([Math.round(v1.width), Math.round(v1.height)]).toEqual([842, 545]); // girada: 842 de largura vista
    expect([Math.round(v2.width), Math.round(v2.height)]).toEqual([595, 842]);
    expect(pageGeo((await PDFDocument.load(bytes)).getPage(0)).view).toEqual([50, 0, 595, 842]);
  });
});

// ======================= Propriedades =======================

describe('propriedades', () => {
  it('lê, grava (com acentos), apaga campos vazios e tira o XMP antigo', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle('Antigo');
    doc.setAuthor('Alguém');
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream('<x:xmpmeta/>', { Type: 'Metadata', Subtype: 'XML' })));
    const again = await PDFDocument.load(await doc.save());
    expect(readInfo(again).title).toBe('Antigo');
    writeInfo(again, { title: 'Relatório de Ação', author: '', subject: 'Teste', keywords: 'a, b', creator: 'Eu', producer: 'Editor' });
    const back = await PDFDocument.load(await again.save());
    const info = readInfo(back);
    expect(info).toMatchObject({ title: 'Relatório de Ação', author: '', subject: 'Teste', keywords: 'a, b', creator: 'Eu' });
    expect(info.modified).toBeInstanceOf(Date);
    expect(back.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    const meta = await (await pdfjsDoc(await back.save())).getMetadata();
    expect((meta.info as { Title?: string }).Title).toBe('Relatório de Ação');

    clearInfo(back);
    const empty = readInfo(await PDFDocument.load(await back.save(), { updateMetadata: false }));
    expect([empty.title, empty.producer, empty.creator]).toEqual(['', '', '']);
  });
});

// ======================= Achatar =======================

describe('achatar', () => {
  it('matriz da aparência leva a BBox ao retângulo', () => {
    expect(appearanceMatrix([100, 200, 300, 250], [0, 0, 200, 50])).toEqual([1, 0, 0, 1, 100, 200]);
    expect(appearanceMatrix([0, 0, 100, 100], [0, 0, 50, 50])).toEqual([2, 0, 0, 2, 0, 0]);
    // Aparência girada 90° pela /Matrix
    const m = appearanceMatrix([10, 10, 60, 110], [0, 0, 100, 50], [0, 1, -1, 0, 0, 0])!;
    expect(m.map((v) => Math.round(v * 100) / 100)).toEqual([1, 0, 0, 1, 60, 10]);
  });

  it('campos preenchidos e anotações viram conteúdo; o texto continua lá', async () => {
    const doc = await PDFDocument.load(await makeForm());
    const form = doc.getForm();
    form.getTextField('nome').setText('Maria Achatada');
    form.getCheckBox('aceito').check();
    const filled = await doc.save();
    // Um destaque e uma caixa de texto do editor (anotação de verdade + camada de objetos)
    const objs = [
      makeMarkup(0, { x: 50, y: 800, w: 150, h: 20 }, 'highlight', '#ffe500', [{ x: 50, y: 800, w: 150, h: 20 }], 'titulo'),
      makeTextObj(0, { x: 300, y: 500, w: 200, h: 30 }, DEFAULT_STYLE, 'Caixa do editor'),
    ];
    const { bytes: edited } = await stampObjects(filled, objs.map((obj) => ({ obj, lines: obj.kind === 'text' ? [{ index: 0, text: 'Caixa do editor' }] : undefined })), projectFor(objs, new Map()));
    expect(await extractProject(edited)).not.toBeNull();

    const flat = await PDFDocument.load(edited);
    const { fields, annotations } = flattenDoc(flat);
    expect(fields).toBe(4);
    expect(annotations).toBe(1);
    const bytes = await flat.save();
    const again = await PDFDocument.load(bytes);
    expect(again.getPage(0).node.lookup(PDFName.of('Annots'))).toBeUndefined();
    expect(again.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
    expect(await extractProject(bytes)).toBeNull(); // reabre como PDF comum
    const t = (await texts(bytes))[0];
    expect(t).toContain('Maria Achatada');
    expect(t).toContain('ABC-123');
    expect(t).toContain('Caixa do editor');
    const pdf = await pdfjsDoc(bytes);
    expect(await (await pdf.getPage(1)).getAnnotations()).toHaveLength(0);
    expect(await pdf.getFieldObjects()).toBeFalsy();
  });
});

// ======================= Compressão leve =======================

// JPEG válido de 1×1 px (cinza): o “recodificador” de teste devolve sempre este
const TINY_JPEG = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), (c) => c.charCodeAt(0));

describe('compressão leve', () => {
  it('desfaz o preditor PNG', () => {
    // 2 linhas × 3 bytes (1 componente): Sub na primeira, Up na segunda
    const enc = Uint8Array.from([1, 10, 5, 5, 2, 1, 1, 1]);
    expect([...undoPngPredictor(enc, 1, 8, 3)]).toEqual([10, 15, 20, 11, 16, 21]);
    expect([...toRgba(Uint8Array.from([7, 8]), 1, 2, 1)!]).toEqual([7, 7, 7, 255, 8, 8, 8, 255]);
  });

  it('lê imagens PNG embutidas pelo pdf-lib e troca as grandes por JPEG menor', async () => {
    const doc = await PDFDocument.create();
    // Imagem “foto” grande sem perdas (ruído não comprime em Flate)
    const w = 400, h = 300;
    const raw = new Uint8Array((w * 3 + 1) * h);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
    for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
    const { deflateSync } = await import('node:zlib');
    const png = pngFile(w, h, 2, deflateSync(raw));
    const img = await doc.embedPng(png);
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 446 });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Legenda da foto', { x: 50, y: 500, size: 14, font });
    // Sobra de uma edição antiga + fluxo sem compressão
    doc.context.register(doc.context.obj({ Lixo: 'sim' }));
    const plain = doc.context.register(doc.context.stream('q 0 0 1 rg '.repeat(200) + ' Q', {}));
    page.node.addContentStream(plain);
    const before = await doc.save({ useObjectStreams: false });

    const loaded = await PDFDocument.load(before);
    const imgs = loaded.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && imageSource(o as PDFRawStream));
    expect(imgs).toHaveLength(1);
    const src = imageSource(imgs[0][1] as PDFRawStream)!;
    expect(src.kind).toBe('pixels');
    expect([src.width, src.height]).toEqual([w, h]);

    let asked = 0;
    const recode: Recoder = async (s, maxSide) => { asked++; expect(maxSide).toBe(Math.ceil((842 / 72) * LIGHT.dpi)); return { bytes: TINY_JPEG, width: 1, height: 1 }; };
    const stats = await compressDoc(loaded, recode, LIGHT);
    expect(asked).toBe(1);
    expect(stats.recoded).toBe(1);
    expect(stats.dropped).toBeGreaterThanOrEqual(1);
    expect(stats.streams).toBeGreaterThanOrEqual(1);
    const after = await loaded.save({ useObjectStreams: true });
    expect(after.length).toBeLessThan(before.length * 0.6);
    expect((await texts(after))[0]).toContain('Legenda da foto');
    const s = new TextDecoder('latin1').decode(after);
    expect(s).toMatch(/\/DCTDecode/);
    expect(s).not.toContain('Lixo');
  });

  it('não mexe em imagens que não sabe recodificar e não troca se não ficar menor', async () => {
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(makePng(300, 200)); // com transparência (SMask) e cor lisa
    doc.addPage().drawImage(img, { x: 0, y: 0, width: 300, height: 200 });
    const loaded = await PDFDocument.load(await doc.save());
    const bigger: Recoder = async () => ({ bytes: new Uint8Array(10_000_000), width: 10, height: 10 });
    const stats = await compressDoc(loaded, bigger, LIGHT);
    expect(stats.recoded).toBe(0);
    expect(dropUnused(loaded)).toBe(0);
    expect(deflatePlainStreams(loaded)).toBe(0);
  });
});

/** PNG mínimo (sem bibliotecas) com os dados de pixel já comprimidos. */
function pngFile(w: number, h: number, colorType: number, idat: Uint8Array) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Uint8Array) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = colorType;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ======================= Busca da tarja =======================

async function sensitivePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const lines = ['Nome: Maria José da Silva', 'CPF: 123.456.789-09', 'E-mail: maria.jose@exemplo.com.br', 'Telefone: (61) 99876-5432'];
  lines.forEach((t, i) => page.drawText(t, { x: 60, y: 760 - i * 30, size: 14, font }));
  // CNPJ escrito em dois pedaços (como alguns geradores fazem)
  page.drawText('CNPJ: 12.345.678/', { x: 60, y: 600, size: 14, font });
  page.drawText('0001-90', { x: 60 + font.widthOfTextAtSize('CNPJ: 12.345.678/', 14), y: 600, size: 14, font });
  const rotated = doc.addPage([595, 842]);
  rotated.drawText('CPF 987.654.321-00', { x: 60, y: 700, size: 14, font });
  rotated.setRotation(degrees(90));
  return doc.save();
}

async function runsOf(bytes: Uint8Array, n = 1) {
  const tc = await (await (await pdfjsDoc(bytes)).getPage(n)).getTextContent();
  return textRuns(tc.items as never[], tc.styles as never);
}

describe('tarja: busca no texto', () => {
  it('monta o texto da página com espaços e quebras', async () => {
    const { text } = pageText(await runsOf(await sensitivePdf()));
    expect(text).toContain('Nome: Maria José da Silva\nCPF: 123.456.789-09');
    expect(text).toContain('CNPJ: 12.345.678/0001-90');
  });

  it('acha CPF, CNPJ (em dois pedaços), e-mail e telefone', async () => {
    const runs = await runsOf(await sensitivePdf());
    for (const id of ['cpf', 'email', 'telefone'] as const) expect(findMatches(runs, PATTERNS[id].re), id).toHaveLength(1);
    const cnpj = findMatches(runs, PATTERNS.cnpj.re);
    expect(cnpj).toHaveLength(1);
    expect(cnpj[0]).toHaveLength(1); // os dois pedaços na mesma linha viram um retângulo só
    // O retângulo do CPF cobre o número (y do topo acima da linha de base 730) e não o rótulo
    const [cpf] = findMatches(runs, PATTERNS.cpf.re)[0];
    expect(cpf.y).toBeGreaterThan(730);
    expect(cpf.y - cpf.h).toBeLessThan(730);
    expect(cpf.x).toBeGreaterThan(80);
  });

  it('busca sem diferenciar maiúsculas e acentos', async () => {
    const runs = await runsOf(await sensitivePdf());
    const re = queryRegex('maria jose')!;
    expect(findMatches(runs, re, { folded: true })).toHaveLength(1);
    expect(findMatches(runs, queryRegex('MARIA')!, { folded: true })).toHaveLength(2); // nome e e-mail
    expect(queryRegex('   ')).toBeNull();
    expect(findMatches(runs, queryRegex('(61)')!, { folded: true })).toHaveLength(1); // caracteres especiais escapados
  });

  it('funciona em página girada', async () => {
    const runs = await runsOf(await sensitivePdf(), 2);
    const m = findMatches(runs, PATTERNS.cpf.re);
    expect(m).toHaveLength(1);
    const q = m[0][0];
    // Texto escrito na horizontal do PDF: o retângulo é largo e baixo no espaço do PDF
    expect(q.w).toBeGreaterThan(q.h);
  });
});

// Garante que os tipos usados existem (evita import morto em refatorações)
void PDFDict;
