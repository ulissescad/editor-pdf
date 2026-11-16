// Comprimir (PLANO.md, item 2.6 e risco 2), modo “leve”: o texto e os vetores ficam intactos.
// - Fotos (JPEG, ou imagens sem perdas em RGB/cinza) são reduzidas para no máximo `dpi` em relação à
//   página e recodificadas em JPEG, só quando o resultado fica realmente menor;
// - fluxos sem compressão são comprimidos (Flate);
// - objetos que nada mais usa (sobras de edições antigas) saem;
// - o arquivo é salvo com object streams.
// A decodificação e codificação das imagens fica num “recodificador” (canvas no navegador), para que o
// resto seja testável no Node. O modo “forte” (páginas viram imagens) fica em raster.ts.
import {
  PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream,
  type PDFDocument, type PDFObject,
} from '@cantoo/pdf-lib';
import { unzlibSync, zlibSync } from 'fflate';

export type ImageSource =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number }
  | { kind: 'pixels'; rgba: Uint8ClampedArray; width: number; height: number };

/** Recodifica em JPEG, reduzindo o lado maior para `maxSide`. null = não deu para decodificar. */
export type Recoder = (src: ImageSource, maxSide: number, quality: number) =>
  Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

export interface CompressOptions {
  dpi: number;       // resolução máxima das imagens em relação ao maior lado da página
  quality: number;   // qualidade JPEG (0–1)
  minGain: number;   // só troca a imagem se ficar pelo menos esta fração menor (ex.: 0,1 = 10%)
  onProgress?: (done: number, total: number) => void;
}

export const LIGHT: Omit<CompressOptions, 'onProgress'> = { dpi: 150, quality: 0.72, minGain: 0.1 };

const name = (s: string) => PDFName.of(s);

// ---------- Leitura das imagens ----------

/** Desfaz o preditor PNG (/Predictor ≥ 10) de um fluxo já descomprimido. */
export function undoPngPredictor(data: Uint8Array, colors: number, bpc: number, columns: number): Uint8Array {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1, dst = r * rowLen, up = dst - rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[up + i] : 0;
      const c = r > 0 && i >= bpp ? out[up + i - bpp] : 0;
      let v: number;
      switch (type) {
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = raw;
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

/** Pixels RGB ou cinza (8 bits) → RGBA. */
export function toRgba(data: Uint8Array, comps: 1 | 3, width: number, height: number): Uint8ClampedArray | null {
  const n = width * height;
  if (data.length < n * comps) return null;
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0, s = 0, d = 0; p < n; p++, s += comps, d += 4) {
    out[d] = data[s];
    out[d + 1] = comps === 3 ? data[s + 1] : data[s];
    out[d + 2] = comps === 3 ? data[s + 2] : data[s];
    out[d + 3] = 255;
  }
  return out;
}

const filtersOf = (dict: PDFDict): string[] => {
  const f = dict.lookup(name('Filter'));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((v) => (v instanceof PDFName ? v.decodeText() : '?'));
  return [];
};

const num = (dict: PDFDict | undefined, key: string): number | undefined => {
  const v = dict?.lookup(name(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
};

/** Componentes de cor que sabemos recodificar (1 = cinza, 3 = RGB), ou null. */
function components(dict: PDFDict): 1 | 3 | null {
  const cs = dict.lookup(name('ColorSpace'));
  if (cs instanceof PDFName) {
    const n = cs.decodeText();
    return n === 'DeviceRGB' ? 3 : n === 'DeviceGray' ? 1 : null;
  }
  if (cs instanceof PDFArray && cs.size() === 2 && cs.lookup(0) === name('ICCBased')) {
    const icc = cs.lookup(1);
    const n = icc instanceof PDFStream ? num(icc.dict, 'N') : undefined;
    return n === 3 ? 3 : n === 1 ? 1 : null;
  }
  return null;
}

/** A imagem pode ser recodificada? Devolve a origem para o recodificador, ou null. */
export function imageSource(stream: PDFRawStream): ImageSource | null {
  const d = stream.dict;
  if (d.lookup(name('Subtype')) !== name('Image')) return null;
  if (d.lookup(name('ImageMask'))?.toString() === 'true') return null;
  if (num(d, 'BitsPerComponent') !== 8) return null;
  if (d.lookup(name('Decode')) || d.lookup(name('Mask')) instanceof PDFArray) return null; // cores invertidas / máscara por cor
  const width = num(d, 'Width'), height = num(d, 'Height');
  const comps = components(d);
  if (!width || !height || !comps) return null;
  const filters = filtersOf(d);
  if (filters.length !== 1) return null;
  if (filters[0] === 'DCTDecode') return { kind: 'jpeg', bytes: stream.contents, width, height };
  if (filters[0] !== 'FlateDecode') return null;
  let parms = d.lookup(name('DecodeParms'));
  if (parms instanceof PDFArray) parms = parms.lookup(0);
  const p = parms instanceof PDFDict ? parms : undefined;
  const predictor = num(p, 'Predictor') ?? 1;
  if (predictor !== 1 && predictor < 10) return null; // preditor TIFF: raro, fica como está
  let raw: Uint8Array;
  try { raw = unzlibSync(stream.contents); } catch {
    try { raw = decodePDFRawStream(stream).decode(); } catch { return null; }
  }
  if (predictor >= 10) raw = undoPngPredictor(raw, num(p, 'Colors') ?? comps, 8, num(p, 'Columns') ?? width);
  const rgba = toRgba(raw, comps, width, height);
  return rgba ? { kind: 'pixels', rgba, width, height } : null;
}

// ---------- Limpeza ----------

/** Objetos alcançáveis a partir do trailer (catálogo, informações, criptografia). */
export function reachable(doc: PDFDocument): Set<PDFRef> {
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = [];
  const t = doc.context.trailerInfo;
  for (const v of [t.Root, t.Info, t.Encrypt, t.ID]) if (v) stack.push(v as PDFObject);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      const v = doc.context.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    } else if (o instanceof PDFDict) {
      for (const v of o.values()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v);
    }
  }
  return seen;
}

/** Remove objetos que nada usa. Devolve quantos saíram. */
export function dropUnused(doc: PDFDocument): number {
  const keep = reachable(doc);
  let n = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!keep.has(ref)) { doc.context.delete(ref); n++; }
  }
  return n;
}

/** Comprime (Flate) os fluxos que estão sem compressão. Devolve quantos. */
export function deflatePlainStreams(doc: PDFDocument): number {
  let n = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.contents.length < 256) continue;
    if (obj.dict.has(name('Filter'))) continue;
    const type = obj.dict.lookup(name('Type'));
    if (type === name('Metadata') || type === name('XRef')) continue; // XMP fica legível (PDF/A)
    const packed = zlibSync(obj.contents, { level: 9 });
    if (packed.length >= obj.contents.length * 0.95) continue;
    const dict = obj.dict.clone(doc.context);
    dict.set(name('Filter'), name('FlateDecode'));
    doc.context.assign(ref, PDFRawStream.of(dict, packed));
    n++;
  }
  return n;
}

// ---------- Compressão leve ----------

/** Maior lado (pt) entre as páginas: define a resolução máxima útil das imagens. */
function largestPageSide(doc: PDFDocument): number {
  let side = 0;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    side = Math.max(side, width, height);
  }
  return side || 842;
}

export interface CompressStats { images: number; recoded: number; streams: number; dropped: number }

export async function compressImages(doc: PDFDocument, recode: Recoder, o: CompressOptions): Promise<CompressStats> {
  const maxSide = Math.ceil((largestPageSide(doc) / 72) * o.dpi);
  const images: Array<[PDFRef, PDFRawStream]> = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.lookup(name('Subtype')) === name('Image') && obj.contents.length > 24_000) {
      images.push([ref, obj]);
    }
  }
  let recoded = 0;
  for (const [n, [ref, stream]] of images.entries()) {
    o.onProgress?.(n, images.length);
    const src = imageSource(stream);
    if (!src) continue;
    // Já pequena e em JPEG: recodificar só perderia qualidade
    if (src.kind === 'jpeg' && Math.max(src.width, src.height) <= maxSide && stream.contents.length < src.width * src.height * 0.25) continue;
    let out: Awaited<ReturnType<Recoder>>;
    try { out = await recode(src, maxSide, o.quality); } catch { out = null; }
    if (!out || out.bytes.length > stream.contents.length * (1 - o.minGain)) continue;
    const dict = stream.dict.clone(doc.context);
    for (const k of ['Filter', 'DecodeParms', 'Length', 'Decode']) dict.delete(name(k));
    dict.set(name('Width'), PDFNumber.of(out.width));
    dict.set(name('Height'), PDFNumber.of(out.height));
    dict.set(name('BitsPerComponent'), PDFNumber.of(8));
    dict.set(name('Filter'), name('DCTDecode'));
    // O canvas sempre gera JPEG colorido: cinza vira RGB; ICC de 3 componentes continua valendo
    if (components(dict) !== 3) dict.set(name('ColorSpace'), name('DeviceRGB'));
    doc.context.assign(ref, PDFRawStream.of(dict, out.bytes));
    recoded++;
  }
  o.onProgress?.(images.length, images.length);
  return { images: images.length, recoded, streams: 0, dropped: 0 };
}

/** Compressão leve completa: imagens, fluxos sem compressão e objetos sem uso. */
export async function compressDoc(doc: PDFDocument, recode: Recoder, o: CompressOptions): Promise<CompressStats> {
  const stats = await compressImages(doc, recode, o);
  stats.dropped = dropUnused(doc);
  stats.streams = deflatePlainStreams(doc);
  return stats;
}
