// Comparar PDFs: ler o texto com o pdf.js, localizar as diferenças nas páginas e gerar os PDFs marcados.
import { BlendMode, rgb } from '@cantoo/pdf-lib';
import type { Rect } from '../editor/model';
import { toView, type PageGeo, type VRect } from '../editor/geom';
import { textRuns, type Measure, type TextRun } from '../editor/textsel';
import type { PDFDocumentProxy } from './pdfjs';
import { loadPdf } from './pages';
import { compareWords, pageWords, wordRects, type Change, type CompareOptions, type Word } from './textdiff';

export interface DocText { runs: TextRun[][]; geo: PageGeo[]; words: Word[] }

export async function readDocText(doc: PDFDocumentProxy, onPage?: (n: number, total: number) => void): Promise<DocText> {
  const out: DocText = { runs: [], geo: [], words: [] };
  for (let i = 0; i < doc.numPages; i++) {
    onPage?.(i + 1, doc.numPages);
    const page = await doc.getPage(i + 1);
    const tc = await page.getTextContent();
    const runs = textRuns(tc.items as never[], tc.styles as never);
    out.runs.push(runs);
    out.geo.push({ view: [...page.view], rotate: page.rotate });
    for (const w of pageWords(runs, i)) out.words.push(w);
    page.cleanup();
  }
  return out;
}

/** Uma marca na página: onde fica no PDF, onde aparece na tela e a qual diferença pertence. */
export interface Mark { rect: Rect; view: VRect; change: number }
export type Marks = Map<number, Mark[]>;

function marksOf(text: DocText, ranges: Array<[number, number]>, measure: Measure): Marks {
  const marks: Marks = new Map();
  ranges.forEach(([s, e], change) => {
    const byPage = new Map<number, Word[]>();
    for (const w of text.words.slice(s, e)) {
      const list = byPage.get(w.page);
      if (list) list.push(w); else byPage.set(w.page, [w]);
    }
    for (const [page, words] of byPage) {
      const list = marks.get(page) ?? [];
      for (const rect of wordRects(words, text.runs[page], measure)) {
        list.push({ rect, view: toView(rect, text.geo[page]), change });
      }
      marks.set(page, list);
    }
  });
  return marks;
}

export interface Comparison { changes: Change[]; removedWords: number; addedWords: number; marksA: Marks; marksB: Marks }

export function comparePdfs(a: DocText, b: DocText, measure: Measure, options: CompareOptions): Comparison {
  const changes = compareWords(a.words, b.words, options);
  return {
    changes,
    removedWords: changes.reduce((n, c) => n + c.a1 - c.a0, 0),
    addedWords: changes.reduce((n, c) => n + c.b1 - c.b0, 0),
    marksA: marksOf(a, changes.map((c) => [c.a0, c.a1]), measure),
    marksB: marksOf(b, changes.map((c) => [c.b0, c.b1]), measure),
  };
}

export const REMOVED_RGB: [number, number, number] = [0.94, 0.35, 0.35];
export const ADDED_RGB: [number, number, number] = [0.3, 0.8, 0.45];

/** Cópia do PDF com as diferenças destacadas por cima do texto. */
export async function markPdf(bytes: Uint8Array, marks: Marks, [r, g, b]: [number, number, number]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  for (const [index, list] of marks) {
    for (const { rect } of list) {
      pages[index].drawRectangle({
        x: rect.x, y: rect.y - rect.h, width: rect.w, height: rect.h,
        color: rgb(r, g, b), opacity: 0.55, blendMode: BlendMode.Multiply,
      });
    }
  }
  return doc.save({ useObjectStreams: true });
}
