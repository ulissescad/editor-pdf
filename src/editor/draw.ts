// Desenho vetorial das anotações (PLANO.md, itens 1.11 a 1.13). As mesmas funções geram os caminhos
// da tela (SVG) e do PDF (drawSvgPath / fluxos de aparência), então o resultado é igual nos dois.
// Os caminhos usam só M, L, C e Z, no quadro do conteúdo (pt, origem no canto superior esquerdo, y para baixo).
import type { InkObj, MarkupObj, MarkupType, Obj, Rect, ShapeObj, ShapeType } from './model';
import { contentMatrix, localSize } from './geom';
import { tk } from '../lib/i18n.svelte';

// ---------------- paletas e padrões ----------------
/** Cores de destaque (aplicadas com multiplicação e 50% de opacidade, como um marca-texto). */
export const HIGHLIGHT_COLORS = ['#ffe500', '#3ee07a', '#38bdf8', '#ff6fb5', '#ff9a3c'];
export const HIGHLIGHT_OPACITY = 0.5;
/** Cores de traço (caneta, formas, sublinhado e riscado). */
export const STROKE_COLORS = ['#000000', '#1a3cc8', '#c62828', '#2e7d32'];
export const NOTE_COLORS = ['#ffd84d', '#7fd6ff', '#9be27a', '#ff9ec7'];

export const MARKUP_DEFAULTS: Record<MarkupType, string> = { highlight: '#ffe500', underline: '#1a3cc8', strike: '#c62828' };
export const MARKUP_LABELS: Record<MarkupType, string> = { highlight: tk('Destacar'), underline: tk('Sublinhar'), strike: tk('Riscar') };
export const MARKUP_NAMES: Record<MarkupType, string> = { highlight: tk('Destaque'), underline: tk('Sublinhado'), strike: tk('Riscado') };

export const INK_WIDTHS = [{ label: tk('Fina'), value: 1 }, { label: tk('Média'), value: 2.5 }, { label: tk('Grossa'), value: 5 }];
/** Caneta marca-texto: traço largo e translúcido. */
export const MARKER = { width: 12, opacity: 0.45, color: '#ffe500' };

export const SHAPE_WIDTHS = [{ label: tk('Fina'), value: 1 }, { label: tk('Média'), value: 2 }, { label: tk('Grossa'), value: 4 }];
export const SHAPE_LABELS: Record<ShapeType, string> = {
  rect: tk('Retângulo'), ellipse: tk('Elipse'), line: tk('Linha'), arrow: tk('Seta'), whiteout: tk('Corretivo'),
};
export const WHITEOUT = '#ffffff';
/** Tipos que podem ser trocados entre si num objeto já criado (a geometria é compatível). */
export const shapeFamily = (s: ShapeType): ShapeType[] =>
  s === 'line' || s === 'arrow' ? ['line', 'arrow'] : ['rect', 'ellipse', 'whiteout'];
export const isLineShape = (s: ShapeType) => s === 'line' || s === 'arrow';

/** Objetos que multiplicam com a página (marca-texto): na tela ficam numa camada com mix-blend-mode. */
export const blends = (o: Obj) => (o.kind === 'markup' && o.type === 'highlight') || (o.kind === 'ink' && o.opacity !== undefined);

// ---------------- utilidades ----------------
const n2 = (v: number) => String(Math.round(v * 100) / 100);
const pt = (x: number, y: number) => `${n2(x)} ${n2(y)}`;

type Matrix = [number, number, number, number, number, number];
export const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];

/** Caixa (x, y = canto superior esquerdo, y para cima) que envolve os retângulos. */
export function unionRect(rects: Rect[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w);
    y0 = Math.min(y0, r.y - r.h); y1 = Math.max(y1, r.y);
  }
  return { x: x0, y: y1, w: x1 - x0, h: y1 - y0 };
}

// ---------------- caneta ----------------
/**
 * Caminho suave por uma lista plana de pontos [x0, y0, x1, y1…]: curvas que passam pelos pontos médios
 * (Bézier quadráticas escritas como cúbicas). Um ponto só vira um pontinho.
 */
export function smoothPath(p: number[]): string {
  const n = Math.floor(p.length / 2);
  if (!n) return '';
  const X = (i: number) => p[2 * i], Y = (i: number) => p[2 * i + 1];
  if (n === 1) return `M${pt(X(0), Y(0))} L${pt(X(0) + 0.01, Y(0))}`;
  if (n === 2) return `M${pt(X(0), Y(0))} L${pt(X(1), Y(1))}`;
  let cx = (X(0) + X(1)) / 2, cy = (Y(0) + Y(1)) / 2;
  let d = `M${pt(X(0), Y(0))} L${pt(cx, cy)}`;
  for (let i = 1; i < n - 1; i++) {
    const qx = X(i), qy = Y(i);
    const ex = (X(i) + X(i + 1)) / 2, ey = (Y(i) + Y(i + 1)) / 2;
    d += ` C${pt(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy))} ${pt(ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey))} ${pt(ex, ey)}`;
    cx = ex; cy = ey;
  }
  return `${d} L${pt(X(n - 1), Y(n - 1))}`;
}

/** Todos os traços da caneta num caminho só, no quadro w × h. */
export const inkPath = (paths: InkObj['paths'], w: number, h: number) =>
  paths.map((p) => smoothPath(p.map((v, i) => v * (i % 2 ? h : w)))).join(' ');

/** Descarta pontos muito próximos (menos de `min` pt do anterior), mantendo sempre o último. */
export function thinPoints(p: number[], min: number): number[] {
  if (p.length <= 4) return p.slice();
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length - 2; i += 2) {
    if (Math.hypot(p[i] - out[out.length - 2], p[i + 1] - out[out.length - 1]) >= min) out.push(p[i], p[i + 1]);
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}

/**
 * Traços em pt na página vista → caixa (com margem para a espessura) e pontos normalizados (0–1) nela.
 */
export function packInk(strokes: number[][], width: number): { box: { x: number; y: number; w: number; h: number }; paths: number[][] } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (let i = 0; i < s.length; i += 2) {
    x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]);
  }
  const m = width / 2 + 1;
  const box = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const paths = strokes.map((s) => s.map((v, i) => r(i % 2 ? (v - box.y) / box.h : (v - box.x) / box.w)));
  return { box, paths };
}

// ---------------- formas ----------------
const K = 0.5523; // controle da Bézier que aproxima um quarto de círculo

export interface ShapeGeometry { stroke?: string; fill?: string }

/** Caminhos de uma forma no quadro w × h (o traço fica por dentro da caixa). */
export function shapeGeometry(s: Pick<ShapeObj, 'shape' | 'width' | 'ends'>, w: number, h: number): ShapeGeometry {
  const sw = s.width;
  switch (s.shape) {
    case 'whiteout':
      return { fill: `M0 0 L${pt(w, 0)} L${pt(w, h)} L${pt(0, h)} Z` };
    case 'rect': {
      const i = Math.min(sw / 2, w / 2, h / 2);
      return { stroke: `M${pt(i, i)} L${pt(w - i, i)} L${pt(w - i, h - i)} L${pt(i, h - i)} Z` };
    }
    case 'ellipse': {
      const i = Math.min(sw / 2, w / 2, h / 2);
      const cx = w / 2, cy = h / 2, rx = w / 2 - i, ry = h / 2 - i, kx = rx * K, ky = ry * K;
      return {
        stroke: `M${pt(cx, cy - ry)} C${pt(cx + kx, cy - ry)} ${pt(cx + rx, cy - ky)} ${pt(cx + rx, cy)}`
          + ` C${pt(cx + rx, cy + ky)} ${pt(cx + kx, cy + ry)} ${pt(cx, cy + ry)}`
          + ` C${pt(cx - kx, cy + ry)} ${pt(cx - rx, cy + ky)} ${pt(cx - rx, cy)}`
          + ` C${pt(cx - rx, cy - ky)} ${pt(cx - kx, cy - ry)} ${pt(cx, cy - ry)} Z`,
      };
    }
    case 'line':
    case 'arrow': {
      const [u0, v0, u1, v1] = s.ends ?? [0, 0, 1, 1];
      const ax = u0 * w, ay = v0 * h, bx = u1 * w, by = v1 * h;
      if (s.shape === 'line') return { stroke: `M${pt(ax, ay)} L${pt(bx, by)}` };
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const hs = Math.min(arrowHead(sw), len * 0.6);
      const dx = (bx - ax) / len, dy = (by - ay) / len;
      const baseX = bx - dx * hs, baseY = by - dy * hs;
      const px = -dy * hs * 0.55, py = dx * hs * 0.55;
      return {
        stroke: `M${pt(ax, ay)} L${pt(baseX + dx * 0.5, baseY + dy * 0.5)}`,
        fill: `M${pt(bx, by)} L${pt(baseX + px, baseY + py)} L${pt(baseX - px, baseY - py)} Z`,
      };
    }
  }
}

/** Tamanho da ponta da seta para uma espessura de traço. */
export const arrowHead = (sw: number) => Math.max(8, sw * 4);

/**
 * Linha/seta de a até b (pt na página vista) → caixa com margem e as pontas normalizadas nela.
 */
export function packLine(a: [number, number], b: [number, number], width: number, arrow: boolean) {
  const m = (arrow ? arrowHead(width) * 0.6 : 0) + width / 2 + 1;
  const x0 = Math.min(a[0], b[0]) - m, y0 = Math.min(a[1], b[1]) - m;
  const w = Math.abs(a[0] - b[0]) + 2 * m, h = Math.abs(a[1] - b[1]) + 2 * m;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const ends: [number, number, number, number] = [r((a[0] - x0) / w), r((a[1] - y0) / h), r((b[0] - x0) / w), r((b[1] - y0) / h)];
  return { box: { x: x0, y: y0, w, h }, ends };
}

// ---------------- destacar, sublinhar, riscar ----------------
/** Espessura do sublinhado/riscado para uma linha de altura h. */
export const lineThickness = (h: number) => Math.max(0.6, h / 14);

/**
 * O que pintar de cada marcação, em retângulos no espaço do PDF: a linha inteira (destacar) ou uma faixa
 * fina embaixo (sublinhar) ou no meio (riscar), na direção do texto (`rot`).
 */
export function markupRects(m: Pick<MarkupObj, 'type' | 'quads' | 'rot'>): Rect[] {
  if (m.type === 'highlight') return m.quads.map((q) => ({ ...q }));
  return m.quads.map((q) => {
    const { w, h } = localSize(q, m.rot);
    const t = lineThickness(h);
    const yc = m.type === 'underline' ? h * 0.12 : h * 0.45; // a partir de baixo, no quadro do texto
    const M = contentMatrix(q, m.rot);
    const [ax, ay] = apply(M, 0, yc - t / 2);
    const [bx, by] = apply(M, w, yc + t / 2);
    return { x: Math.min(ax, bx), y: Math.max(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  });
}

/**
 * QuadPoints do PDF para cada linha: canto superior esquerdo, superior direito, inferior esquerdo e
 * inferior direito, na orientação do texto (a ordem que o Acrobat usa).
 */
export function quadPoints(m: Pick<MarkupObj, 'quads' | 'rot'>): number[] {
  return m.quads.flatMap((q) => {
    const { w, h } = localSize(q, m.rot);
    const M = contentMatrix(q, m.rot);
    return [...apply(M, 0, h), ...apply(M, w, h), ...apply(M, 0, 0), ...apply(M, w, 0)];
  });
}

// ---------------- nota ----------------
/** Ícone da nota (balão de comentário) num quadro 24 × 24: corpo preenchido com a cor e linhas de texto. */
export const NOTE_ICON = {
  body: 'M3 3 L21 3 L21 16 L11 16 L6 21 L6 16 L3 16 Z',
  lines: 'M7 7.5 L17 7.5 M7 11.5 L14 11.5',
  ink: '#3d3a2a',
};
