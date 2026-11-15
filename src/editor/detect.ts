// Detecção de campos em PDFs sem formulário (PLANO.md, item 1.8). Só regras geométricas, sem IA:
//  A. célula de tabela com rótulo terminado em “:” e espaço livre à direita;
//  B. célula alta com o rótulo no topo e espaço livre embaixo;
//  C. célula vazia (com quadradinho pequeno = caixa de seleção);
//  D. rótulo “Algo:” fora de tabela, com espaço livre à direita (ou sobre uma linha);
//  E. sequência de sublinhados “______”;
//  F. linha horizontal solta (linha de assinatura).
// O texto vem do pdf.js (getTextContent) e as linhas das operações de desenho (getOperatorList).
import { fieldName, type FieldType, type Obj, type Rect } from './model';
import type { PDFDocumentProxy } from '../pdf/pdfjs';

export interface TextRun { str: string; x0: number; x1: number; y: number; size: number } // y = linha de base
export interface HLine { y: number; x0: number; x1: number }
export interface VLine { x: number; y0: number; y1: number }
export interface Box { x0: number; y0: number; x1: number; y1: number } // y1 = topo
export interface PageGeometry { view: number[]; texts: TextRun[]; h: HLine[]; v: VLine[]; avoid?: Box[] }
export interface Suggestion { rect: Rect; type: FieldType; name: string; size?: number; rule: string }
export interface PageSuggestion extends Suggestion { page: number }

const TOL = 2.5;

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: number[]): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ======================= extração (pdf.js) =======================

interface PageLike {
  view: number[];
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
}

/** Junta pedaços de texto da mesma linha que estão encostados (o pdf.js costuma quebrar palavras). */
export function mergeRuns(items: TextRun[]): TextRun[] {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.size, b.size) * 0.3 ? b.y - a.y : a.x0 - b.x0));
  const out: TextRun[] = [];
  for (const t of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? t.x0 - prev.x1 : Infinity;
    if (prev && Math.abs(prev.y - t.y) <= Math.min(prev.size, t.size) * 0.3 && gap > -prev.size && gap < prev.size * 0.8) {
      prev.str += (gap > prev.size * 0.15 && !prev.str.endsWith(' ') && !t.str.startsWith(' ') ? ' ' : '') + t.str;
      prev.x1 = Math.max(prev.x1, t.x1);
      prev.size = Math.max(prev.size, t.size);
    } else {
      out.push({ ...t });
    }
  }
  return out.map((t) => ({ ...t, str: t.str.replace(/\s+/g, ' ').trim() })).filter((t) => t.str);
}

export async function extractGeometry(page: PageLike, OPS: Record<string, number>): Promise<PageGeometry> {
  const [tc, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);

  // ---- texto ----
  const items: TextRun[] = [];
  for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0) continue; // texto girado: ignora
    const size = Math.hypot(c, d) || it.height || 10;
    items.push({ str: it.str, x0: e, x1: e + (it.width ?? 0), y: f, size });
  }

  // ---- linhas e retângulos ----
  const h: HLine[] = [], v: VLine[] = [];
  const addH = (x0: number, x1: number, y: number) => { if (Math.abs(x1 - x0) > 4) h.push({ y, x0: Math.min(x0, x1), x1: Math.max(x0, x1) }); };
  const addV = (y0: number, y1: number, x: number) => { if (Math.abs(y1 - y0) > 4) v.push({ x, y0: Math.min(y0, y1), y1: Math.max(y0, y1) }); };
  const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];

  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0])) ctm = mul(ctm, args[0] as number[]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      const paint = args[0] as number;
      const buf = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      const stroked = STROKE.has(paint), filled = FILL.has(paint);
      if (!buf || (!stroked && !filled)) continue;
      // Divide o caminho em subcaminhos de pontos já na página
      const subs: { pts: [number, number][]; curved: boolean; closed: boolean }[] = [];
      let cur: (typeof subs)[number] | null = null;
      for (let k = 0; k < buf.length;) {
        const op = buf[k++];
        if (op === 0) { cur = { pts: [apply(ctm, buf[k], buf[k + 1])], curved: false, closed: false }; subs.push(cur); k += 2; }
        else if (op === 1) { cur?.pts.push(apply(ctm, buf[k], buf[k + 1])); k += 2; }
        else if (op === 2) { if (cur) { cur.curved = true; cur.pts.push(apply(ctm, buf[k + 4], buf[k + 5])); } k += 6; }
        else if (op === 3) { if (cur) { cur.curved = true; cur.pts.push(apply(ctm, buf[k + 2], buf[k + 3])); } k += 4; }
        else if (op === 4) { if (cur) cur.closed = true; }
        else break;
      }
      for (const s of subs) {
        if (s.curved || s.pts.length < 2) continue;
        const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const axis = s.pts.every((p, j) => j === 0 || Math.abs(p[0] - s.pts[j - 1][0]) < 0.5 || Math.abs(p[1] - s.pts[j - 1][1]) < 0.5);
        const isRect = axis && (s.pts.length === 4 || s.pts.length === 5) && (s.closed || s.pts.length === 5);
        if (isRect) {
          const w = x1 - x0, ht = y1 - y0;
          if (w <= 3 && ht > 4) addV(y0, y1, (x0 + x1) / 2);         // borda desenhada como retângulo fino
          else if (ht <= 3 && w > 4) addH(x0, x1, (y0 + y1) / 2);
          else if (w > 3 && ht > 3 && (stroked || (w > 8 && ht > 8))) {
            addH(x0, x1, y0); addH(x0, x1, y1); addV(y0, y1, x0); addV(y0, y1, x1);
          }
        } else if (stroked) {
          const pts = s.closed ? [...s.pts, s.pts[0]] : s.pts;
          for (let j = 1; j < pts.length; j++) {
            const [ax, ay] = pts[j - 1], [bx, by] = pts[j];
            if (Math.abs(ay - by) < 0.8) addH(ax, bx, (ay + by) / 2);
            else if (Math.abs(ax - bx) < 0.8) addV(ay, by, (ax + bx) / 2);
          }
        }
      }
    }
  }
  return { view: page.view, texts: mergeRuns(items), h: mergeH(h), v: mergeV(v) };
}

function lastWhere<T>(a: T[], ok: (x: T) => boolean): T | undefined {
  for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return a[i];
  return undefined;
}

/** Junta segmentos colineares que se tocam (tabelas costumam ter a borda em vários pedaços). */
export function mergeH(lines: HLine[]): HLine[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out: HLine[] = [];
  for (const l of sorted) {
    const m = lastWhere(out, (o) => Math.abs(o.y - l.y) <= 1.5 && l.x0 <= o.x1 + 2);
    if (m) { m.x1 = Math.max(m.x1, l.x1); m.x0 = Math.min(m.x0, l.x0); }
    else out.push({ ...l });
  }
  return out;
}

export function mergeV(lines: VLine[]): VLine[] {
  const sorted = [...lines].sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const out: VLine[] = [];
  for (const l of sorted) {
    const m = lastWhere(out, (o) => Math.abs(o.x - l.x) <= 1.5 && l.y0 <= o.y1 + 2);
    if (m) { m.y1 = Math.max(m.y1, l.y1); m.y0 = Math.min(m.y0, l.y0); }
    else out.push({ ...l });
  }
  return out;
}

// ======================= regras =======================

/** Células: retângulos mínimos fechados por duas linhas horizontais e duas verticais. */
export function findCells(H: HLine[], V: VLine[]): Box[] {
  const cells: Box[] = [];
  const tops = [...H].sort((a, b) => b.y - a.y);
  for (const top of tops) {
    const vs = V.filter((v) => v.x >= top.x0 - TOL && v.x <= top.x1 + TOL && v.y1 >= top.y - TOL && v.y0 < top.y - 4)
      .sort((a, b) => a.x - b.x);
    for (let i = 0; i < vs.length - 1; i++) {
      const left = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const right = vs[j];
        if (right.x - left.x < 5) continue;
        const floor = Math.max(left.y0, right.y0) - TOL;
        let bottom: HLine | null = null;
        for (const b of H) {
          if (b.y < top.y - 4 && b.y >= floor && b.x0 <= left.x + TOL && b.x1 >= right.x - TOL && (!bottom || b.y > bottom.y)) bottom = b;
        }
        if (!bottom) continue;
        const cell = { x0: left.x, x1: right.x, y0: bottom.y, y1: top.y };
        if (!cells.some((c) => near(c, cell))) cells.push(cell);
        break;
      }
    }
  }
  return cells;
}

const near = (a: Box, b: Box) => Math.abs(a.x0 - b.x0) < TOL && Math.abs(a.x1 - b.x1) < TOL && Math.abs(a.y0 - b.y0) < TOL && Math.abs(a.y1 - b.y1) < TOL;
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a: Box, b: Box): Box => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
/** Fração da menor caixa coberta pela interseção. */
export const overlap = (a: Box, b: Box) => area(inter(a, b)) / Math.max(1e-6, Math.min(area(a), area(b)));
const textBox = (t: TextRun): Box => ({ x0: t.x0, x1: t.x1, y0: t.y - t.size * 0.22, y1: t.y + t.size * 0.78 });
const centerIn = (t: TextRun, c: Box) => {
  const cx = (t.x0 + t.x1) / 2, cy = t.y + t.size * 0.28;
  return cx > c.x0 && cx < c.x1 && cy > c.y0 && cy < c.y1;
};
const toRect = (b: Box): Rect => ({ x: b.x0, y: b.y1, w: b.x1 - b.x0, h: b.y1 - b.y0 });
const isLabel = (s: string) => /[:?]\s*$/.test(s);
const fontFor = (h: number) => Math.max(7, Math.min(11, Math.round(h * 0.6)));

export function detectFields(g: PageGeometry): Suggestion[] {
  const [px0, py0, px1, py1] = g.view;
  const pw = px1 - px0, ph = py1 - py0;
  const out: Suggestion[] = [];
  const texts = g.texts;
  const used = new Set<TextRun>(); // rótulos que já geraram campo

  const add = (b: Box, type: FieldType, label: string, rule: string, single = true, textSize?: number) => {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (w < (type === 'check' ? 5 : 24) || h < (type === 'check' ? 5 : 8)) return;
    const fit = textSize ? Math.max(7, Math.min(11, Math.round(textSize), Math.floor(h * 0.75))) : fontFor(h);
    const size = type === 'text' ? (single && h < 30 ? fit : 10) : undefined;
    out.push({ rect: toRect(b), type, name: fieldName(label), size, rule });
  };

  /** Rótulo de uma área vazia: texto à esquerda na mesma altura e/ou acima (cabeçalho da coluna). */
  const labelFor = (c: Box): string => {
    let row: TextRun | null = null, col: TextRun | null = null;
    for (const t of texts) {
      const cy = t.y + t.size * 0.28;
      if (t.x1 <= c.x0 + 2 && cy > c.y0 && cy < c.y1 && (!row || t.x1 > row.x1)) row = t;
    }
    for (const t of texts) {
      const cx = (t.x0 + t.x1) / 2;
      if (cx > c.x0 && cx < c.x1 && t.y > c.y1 && t.y - c.y1 < 60 && (!col || t.y < col.y)) col = t;
    }
    if (row && (isLabel(row.str) || !col)) return row.str; // “Nome:” já basta
    return [row?.str, col?.str].filter(Boolean).join(' ') || 'campo';
  };

  // ---- células de tabela ----
  const cells = findCells(g.h, g.v).filter((c) => {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    return w >= 5 && h >= 5 && !(w > pw * 0.9 && h > ph * 0.6); // ignora a moldura da página
  });
  const inner = (c: Box) => cells.some((o) => o !== c && area(o) < area(c) * 0.95 && overlap(o, c) > 0.9);

  for (const c of cells) {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    const inside = texts.filter((t) => centerIn(t, c));
    if (!inside.length) {
      if (inner(c)) continue; // célula que contém outras (borda externa da tabela)
      if (w <= 26 && h <= 26 && Math.abs(w - h) <= 6) {
        add(c, 'check', labelRight(c, texts) ?? labelFor(c), 'C-check');
      } else if (w >= 24 && h >= 8) {
        add({ x0: c.x0 + 1.5, y0: c.y0 + 1.5, x1: c.x1 - 1.5, y1: c.y1 - 1.5 }, 'text', labelFor(c), 'C', h < 30);
      }
      continue;
    }
    inside.forEach((t) => used.add(t));
    const lowest = inside.reduce((a, b) => (b.y < a.y ? b : a));
    const label = inside.sort((a, b) => b.y - a.y || a.x0 - b.x0).map((t) => t.str).join(' ');
    const below = lowest.y - lowest.size * 0.3 - c.y0;
    const sameLine = inside.every((t) => Math.abs(t.y - lowest.y) < lowest.size * 0.5);
    const lastOnLine = inside.filter((t) => Math.abs(t.y - lowest.y) < lowest.size * 0.5).reduce((a, b) => (b.x1 > a.x1 ? b : a));
    const right = c.x1 - lastOnLine.x1;
    if (below >= 28 || (below >= 18 && isLabel(label))) {
      // B. rótulo no topo e espaço embaixo
      add({ x0: c.x0 + 1.5, y0: c.y0 + 1.5, x1: c.x1 - 1.5, y1: lowest.y - lowest.size * 0.3 - 1 }, 'text', label, 'B', false);
    } else if (sameLine && isLabel(lastOnLine.str) && right >= 30) {
      // A. rótulo à esquerda e espaço à direita
      add({ x0: lastOnLine.x1 + 4, y0: c.y0 + 1.5, x1: c.x1 - 1.5, y1: c.y1 - 1.5 }, 'text', label, 'A');
    }
  }

  const inCell = (t: TextRun) => cells.some((c) => centerIn(t, c));
  const cellEdge = (l: HLine) => cells.some((c) => (Math.abs(c.y0 - l.y) < TOL || Math.abs(c.y1 - l.y) < TOL) && l.x0 < c.x1 && l.x1 > c.x0);

  // ---- E. sublinhados “_____” ----
  for (const t of texts) {
    const re = /_{3,}/g;
    let m: RegExpExecArray | null;
    const per = (t.x1 - t.x0) / Math.max(1, t.str.length);
    while ((m = re.exec(t.str))) {
      const before = t.str.slice(0, m.index).replace(/_+/g, ' ').trim();
      const label = before || labelLeft(t, texts) || 'campo';
      const xs = t.x0 + per * m.index, xe = t.x0 + per * (m.index + m[0].length);
      add({ x0: xs, y0: t.y - t.size * 0.15, x1: xe, y1: t.y + t.size * 1.1 }, 'text', label, 'E', true, t.size);
      used.add(t);
    }
  }

  // ---- D. “Rótulo:” solto, com espaço à direita ----
  for (const t of texts) {
    if (used.has(t) || inCell(t) || !isLabel(t.str)) continue;
    const next = texts.filter((o) => o !== t && Math.abs(o.y - t.y) < t.size * 0.5 && o.x0 > t.x1).sort((a, b) => a.x0 - b.x0)[0];
    let x0 = t.x1 + 4;
    let x1 = next ? next.x0 - 6 : Math.min(px1 - pw * 0.06, px1 - 20);
    const under = g.h.find((l) => l.y <= t.y + 2 && l.y >= t.y - t.size * 0.6 && l.x1 > t.x1 + 30 && l.x0 <= t.x1 + 20 && !cellEdge(l));
    if (under) { x0 = Math.max(x0, under.x0); x1 = Math.min(x1, under.x1); }
    if (x1 - x0 < 40) continue;
    add({ x0, y0: t.y - t.size * 0.35, x1, y1: t.y + t.size * 1.05 }, 'text', t.str, 'D', true, t.size);
    used.add(t);
  }

  // ---- F. linha horizontal solta (assinatura, “Data ____”) ----
  for (const l of g.h) {
    if (l.x1 - l.x0 < 50 || cellEdge(l)) continue;
    if (g.v.some((v) => v.y0 < l.y + TOL && v.y1 > l.y - TOL && v.x > l.x0 - TOL && v.x < l.x1 + TOL)) continue;
    const ontop = texts.some((t) => t.x1 > l.x0 && t.x0 < l.x1 && t.y - l.y >= -2 && t.y - l.y < t.size * 1.2);
    if (ontop) continue; // texto escrito sobre a linha (sublinhado), não é campo
    const lbl = texts.find((t) => t.x1 <= l.x0 + 6 && Math.abs(t.y - l.y) < t.size * 0.9)
      ?? texts.find((t) => t.x0 < l.x1 && t.x1 > l.x0 && l.y - t.y > 0 && l.y - t.y < t.size * 2);
    add({ x0: l.x0, y0: l.y + 1, x1: l.x1, y1: l.y + 17 }, 'text', lbl?.str ?? 'assinatura', 'F');
  }

  // ---- sem repetições nem sobreposições ----
  const avoid = g.avoid ?? [];
  const final: Suggestion[] = [];
  for (const s of out) {
    const b = { x0: s.rect.x, x1: s.rect.x + s.rect.w, y0: s.rect.y - s.rect.h, y1: s.rect.y };
    const clash = (o: Box) => overlap(o, b) > 0.4;
    if (avoid.some(clash) || final.some((f) => clash({ x0: f.rect.x, x1: f.rect.x + f.rect.w, y0: f.rect.y - f.rect.h, y1: f.rect.y }))) continue;
    if (texts.some((t) => !used.has(t) && overlap(textBox(t), b) > 0.5 && s.type === 'text' && s.rule !== 'E')) continue;
    final.push(s);
  }
  // Ordem de leitura: de cima para baixo, da esquerda para a direita
  return final.sort((a, b) => (Math.abs(a.rect.y - b.rect.y) > 4 ? b.rect.y - a.rect.y : a.rect.x - b.rect.x));
}

/** Texto logo à direita de uma caixinha (“☐ Sim”). */
function labelRight(c: Box, texts: TextRun[]): string | null {
  const cy = (c.y0 + c.y1) / 2;
  const t = texts.filter((t) => t.x0 >= c.x1 - 1 && t.x0 - c.x1 < 30 && Math.abs(t.y + t.size * 0.3 - cy) < t.size).sort((a, b) => a.x0 - b.x0)[0];
  return t?.str ?? null;
}

/** Texto à esquerda na mesma linha. */
function labelLeft(t: TextRun, texts: TextRun[]): string | null {
  const l = texts.filter((o) => o !== t && Math.abs(o.y - t.y) < t.size * 0.5 && o.x1 <= t.x0 + 2).sort((a, b) => b.x1 - a.x1)[0];
  return l?.str ?? null;
}

// ======================= documento inteiro =======================

/** Detecta em todas as páginas, sem repetir onde já há objetos do editor ou campos do PDF. */
export async function detectInDocument(doc: PDFDocumentProxy, objects: Obj[]): Promise<PageSuggestion[]> {
  const { pdfjsLib } = await import('../pdf/pdfjs');
  const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
  const all: PageSuggestion[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const g = await extractGeometry(page as unknown as PageLike, OPS);
    const annots = await page.getAnnotations().catch(() => [] as Array<{ subtype?: string; rect?: number[] }>);
    g.avoid = [
      ...annots.filter((a) => a.subtype === 'Widget' && a.rect).map((a) => ({ x0: a.rect![0], y0: a.rect![1], x1: a.rect![2], y1: a.rect![3] })),
      ...objects.filter((o) => o.page === n - 1).map((o) => ({ x0: o.rect.x, x1: o.rect.x + o.rect.w, y0: o.rect.y - o.rect.h, y1: o.rect.y })),
    ];
    for (const s of detectFields(g)) all.push({ ...s, page: n - 1 });
    page.cleanup();
  }
  return all;
}
