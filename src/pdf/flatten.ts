// Achatar (PLANO.md, item 2.12): campos de formulário e anotações viram conteúdo fixo da página.
// Cada anotação visível é desenhada com a própria aparência (/AP) na posição dela, como os leitores
// mostram, e depois sai da página. Campos sem aparência (ou com /NeedAppearances) ganham uma antes.
// Links continuam funcionando. O projeto do editor (anexo) sai: o PDF achatado reabre como um PDF comum.
import * as lib from '@cantoo/pdf-lib';
import {
  PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream, StandardFonts,
  concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFDocument, type PDFPage,
} from '@cantoo/pdf-lib';
import { takeProject } from './write';

const N = PDFName.of('N');
const AP = PDFName.of('AP');
const AS = PDFName.of('AS');
const ANNOTS = PDFName.of('Annots');

/** Anotações que não são desenho: ficam como estão. */
const KEEP = new Set(['Link', 'FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D']);

type Matrix = [number, number, number, number, number, number];

const nums = (arr: PDFArray | undefined): number[] =>
  arr ? arr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN)) : [];

/** Leva o /BBox (transformado pela /Matrix da aparência) ao /Rect da anotação (PDF 32000, 12.5.5). */
export function appearanceMatrix(rect: number[], bbox: number[], m: Matrix = [1, 0, 0, 1, 0, 0]): Matrix | null {
  const [rx0, ry0, rx1, ry1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
    .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const bx0 = Math.min(...xs), by0 = Math.min(...ys), bx1 = Math.max(...xs), by1 = Math.max(...ys);
  if (![rx0, ry0, rx1, ry1, bx0, by0, bx1, by1].every(Number.isFinite)) return null;
  const sx = bx1 - bx0 > 1e-6 ? (rx1 - rx0) / (bx1 - bx0) : 1;
  const sy = by1 - by0 > 1e-6 ? (ry1 - ry0) / (by1 - by0) : 1;
  return [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy];
}

/** Aparência normal da anotação (respeitando o estado /AS de caixas de seleção e botões de rádio). */
function normalAppearance(doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const ap = annot.lookupMaybe(AP, PDFDict);
  if (!ap) return null;
  let entry = ap.get(N);
  let value = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
  if (value instanceof PDFDict && !(value instanceof PDFStream)) {
    const state = annot.lookupMaybe(AS, PDFName);
    entry = state ? value.get(state) : undefined;
    value = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
  }
  if (!(value instanceof PDFStream)) return null;
  return entry instanceof PDFRef ? entry : doc.context.register(value);
}

export interface FlattenResult { bytes: Uint8Array; fields: number; annotations: number }

/** Gera aparências para campos que não têm (ou que o PDF pede para regerar). */
function prepareFields(doc: PDFDocument): number {
  let form: lib.PDFForm;
  try { form = doc.getForm(); } catch { return 0; }
  const fields = form.getFields();
  if (!fields.length) return 0;
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const regenerate = acro?.lookup(PDFName.of('NeedAppearances'))?.toString() === 'true';
  let font: lib.PDFFont | undefined;
  for (const field of fields) {
    const f = field as unknown as { needsAppearancesUpdate?: () => boolean; defaultUpdateAppearances?: (font: lib.PDFFont) => void };
    if (!f.defaultUpdateAppearances) continue;
    const isText = field instanceof lib.PDFTextField || field instanceof lib.PDFDropdown || field instanceof lib.PDFOptionList;
    if (!(regenerate && isText) && !f.needsAppearancesUpdate?.()) continue;
    try {
      font ??= doc.embedStandardFont(StandardFonts.Helvetica);
      f.defaultUpdateAppearances(font);
    } catch (err) {
      console.warn('Campo sem aparência:', field.getName(), err);
    }
  }
  return fields.length;
}

function flattenPage(doc: PDFDocument, page: PDFPage): number {
  const annots = page.node.lookupMaybe(ANNOTS, PDFArray);
  if (!annots) return 0;
  const ops: lib.PDFOperator[] = [];
  let count = 0;
  for (let i = annots.size() - 1; i >= 0; i--) {
    const annot = annots.lookup(i);
    if (!(annot instanceof PDFDict)) { annots.remove(i); continue; }
    const subtype = annot.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? '';
    if (KEEP.has(subtype)) continue;
    annots.remove(i);
    if (subtype !== 'Widget' && subtype !== 'Popup') count++; // campos são contados à parte
    const flags = annot.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
    if (subtype === 'Popup' || flags & 2 /* Hidden */ || flags & 32 /* NoView */) continue;
    const ref = normalAppearance(doc, annot);
    const stream = ref ? doc.context.lookup(ref) : undefined;
    if (!ref || !(stream instanceof PDFStream)) continue;
    const bbox = nums(stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray));
    const rect = nums(annot.lookupMaybe(PDFName.of('Rect'), PDFArray));
    if (bbox.length !== 4 || rect.length !== 4) continue;
    const m = nums(stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray));
    const matrix = appearanceMatrix(rect, bbox, m.length === 6 ? (m as Matrix) : undefined);
    if (!matrix) continue;
    stream.dict.set(PDFName.of('Type'), PDFName.of('XObject'));
    stream.dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
    const name = page.node.newXObject('Achatado', ref);
    // As anotações são lidas do fim para o começo; o desenho segue a ordem original (a última fica por cima)
    ops.unshift(pushGraphicsState(), concatTransformationMatrix(...matrix), drawObject(name), popGraphicsState());
  }
  if (!annots.size()) page.node.delete(ANNOTS);
  if (ops.length) page.pushOperators(...ops);
  return count;
}

/** Achata o documento já aberto no pdf-lib. */
export function flattenDoc(doc: PDFDocument): { fields: number; annotations: number } {
  const fields = prepareFields(doc);
  let annotations = 0;
  for (const page of doc.getPages()) annotations += flattenPage(doc, page);
  doc.catalog.delete(PDFName.of('AcroForm'));
  takeProject(lib, doc, true);
  return { fields, annotations };
}
