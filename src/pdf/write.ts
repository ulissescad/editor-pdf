// Gravação do PDF final e leitura de PDFs gerados por este editor (PLANO.md, itens 1.3 e 1.6).
//
// Os objetos do editor são desenhados numa camada própria em cada página: um fluxo de conteúdo marcado
// com /EditorPDF /Objetos. O projeto (JSON) vai junto como anexo. Ao reabrir o PDF, removemos essa camada
// e o anexo e recriamos os objetos editáveis, sem duplicar nada.
import type { PDFDocument as PDFDocumentType, PDFPage } from '@cantoo/pdf-lib';
import { LINE, PAD, PROJECT_FILE, parseProject, pdfFontName, type Obj, type Project } from '../editor/model';

const loadLib = () => import('@cantoo/pdf-lib');
const MARK_KEY = 'EditorPDF';
const MARK_VALUE = 'Objetos';

export interface StampLine { index: number; text: string }
export interface StampInput { obj: Obj; lines: StampLine[]; baseline: number }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/**
 * Recebe o PDF com os campos já preenchidos (pdf.js saveDocument) e grava os objetos.
 * Retorna os bytes finais e quantos caracteres não existiam nas fontes padrão (trocados por “?”).
 */
export async function stampObjects(bytes: Uint8Array, items: StampInput[], project: Project): Promise<{ bytes: Uint8Array; replaced: number }> {
  const lib = await loadLib();
  const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, PDFName } = lib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fonts = new Map<string, { font: Awaited<ReturnType<PDFDocumentType['embedFont']>>; chars: Set<number> }>();
  const touched = new Set<PDFPage>();
  let replaced = 0;

  for (const { obj, lines, baseline } of items) {
    if (!obj.text.trim() || obj.page >= doc.getPageCount()) continue;
    const name = pdfFontName(obj.style);
    if (!fonts.has(name)) {
      const font = await doc.embedFont(StandardFonts[name as keyof typeof StandardFonts]);
      fonts.set(name, { font, chars: new Set(font.getCharacterSet()) });
    }
    const { font, chars } = fonts.get(name)!;
    const page = doc.getPage(obj.page);
    touched.add(page);
    const { x, y, w, h } = obj.rect;
    const { size, color, align } = obj.style;
    const innerW = w - 2 * PAD;
    // Recorta no retângulo da caixa: o que não aparece na tela também não aparece no PDF
    page.pushOperators(pushGraphicsState(), rectangle(x, y - h, w, h), clip(), endPath());
    for (const line of lines) {
      const safe = [...line.text].map((ch) => (chars.has(ch.codePointAt(0)!) ? ch : (replaced++, '?'))).join('');
      const tw = font.widthOfTextAtSize(safe, size);
      const dx = align === 'center' ? (innerW - tw) / 2 : align === 'right' ? innerW - tw : 0;
      page.drawText(safe, {
        x: x + PAD + dx,
        y: y - PAD - line.index * size * LINE - baseline * size,
        size, font, color: rgb(...hexToRgb(color)),
      });
    }
    page.pushOperators(popGraphicsState());
  }

  // Marca a camada criada nesta gravação em cada página tocada
  for (const page of touched) {
    const ref = (page as unknown as { contentStreamRef?: import('@cantoo/pdf-lib').PDFRef }).contentStreamRef;
    const stream = ref && doc.context.lookup(ref);
    const dict = (stream as { dict?: import('@cantoo/pdf-lib').PDFDict } | undefined)?.dict;
    dict?.set(PDFName.of(MARK_KEY), PDFName.of(MARK_VALUE));
  }

  if (project.objects.length) {
    await doc.attach(new TextEncoder().encode(JSON.stringify(project)), PROJECT_FILE, {
      mimeType: 'application/json',
      description: 'Objetos editáveis do Editor de PDF',
    });
  }
  return { bytes: await doc.save({ updateFieldAppearances: false }), replaced };
}

/**
 * Se o PDF foi gerado por este editor, devolve o projeto e o PDF “base” (sem a camada de objetos
 * e sem o anexo), pronto para continuar editando. Caso contrário, devolve null.
 */
export async function extractProject(bytes: Uint8Array): Promise<{ project: Project; base: Uint8Array } | null> {
  const s = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4_000_000)));
  if (!s.includes(MARK_KEY) && !s.includes('EmbeddedFiles')) return null; // atalho: PDF comum
  const lib = await loadLib();
  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString, PDFString, PDFRawStream, PDFRef, decodePDFRawStream } = lib;
  let doc: PDFDocumentType;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { return null; }

  // 1) Anexo com o projeto
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const ef = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const arr = ef?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!arr) return null;
  let project: Project | null = null;
  let specRef: unknown = null;
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const key = arr.lookup(i);
    const name = key instanceof PDFHexString || key instanceof PDFString ? key.decodeText() : '';
    if (name !== PROJECT_FILE) continue;
    const spec = arr.lookup(i + 1, PDFDict);
    const file = spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F'));
    if (file instanceof PDFRawStream) project = parseProject(new TextDecoder().decode(decodePDFRawStream(file).decode()));
    specRef = arr.get(i + 1);
    arr.remove(i + 1);
    arr.remove(i);
    break;
  }
  if (!project) return null;

  // Remove a referência ao anexo também da lista /AF do catálogo
  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af && specRef instanceof PDFRef) {
    for (let i = af.size() - 1; i >= 0; i--) if (af.get(i) === specRef) af.remove(i);
  }

  // 2) Remove a camada de objetos de cada página
  const isMarked = (ref: unknown) => {
    const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    const dict = (obj as { dict?: import('@cantoo/pdf-lib').PDFDict } | undefined)?.dict;
    return dict?.get(PDFName.of(MARK_KEY)) === PDFName.of(MARK_VALUE);
  };
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of('Contents'));
    const list = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
    if (list instanceof PDFArray) {
      for (let i = list.size() - 1; i >= 0; i--) if (isMarked(list.get(i))) list.remove(i);
    }
  }

  return { project, base: await doc.save({ updateFieldAppearances: false }) };
}
