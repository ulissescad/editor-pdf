// Recortar margens (PLANO.md, item 2.10): muda a caixa visível da página (/CropBox). O conteúdo de fora
// fica escondido em qualquer leitor. As margens são dadas na página como se vê (em cima = em cima na tela),
// inclusive em páginas giradas. Funções puras testadas em tests/unit; a detecção automática recebe os
// pixels já desenhados (pdf.js), então funciona também com PDFs digitalizados.
import type { PDFDocument } from '@cantoo/pdf-lib';
import { fromView, viewSize, type PageGeo } from '../editor/geom';
import { pageGeo } from './stamp';

/** Margens em pt, na página vista. */
export interface Margins { top: number; right: number; bottom: number; left: number }

export const NO_MARGINS: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

export const MM = 72 / 25.4;

/** Menor pedaço que sobra da página (pt): recortes maiores que a página são limitados. */
const MIN_SIDE = 36;

/** Limita as margens para sobrar pelo menos um pedaço da página. */
export function clampMargins(m: Margins, [vw, vh]: [number, number]): Margins {
  const fit = (a: number, b: number, total: number): [number, number] => {
    a = Math.max(0, a); b = Math.max(0, b);
    const over = a + b - (total - MIN_SIDE);
    if (over <= 0) return [a, b];
    const k = (total - MIN_SIDE) / (a + b);
    return [a * k, b * k];
  };
  const [left, right] = fit(m.left, m.right, vw);
  const [top, bottom] = fit(m.top, m.bottom, vh);
  return { top, right, bottom, left };
}

/** Nova caixa visível no espaço do PDF (x, y = canto inferior esquerdo), a partir das margens. */
export function cropBoxFor(g: PageGeo, margins: Margins): { x: number; y: number; width: number; height: number } {
  const size = viewSize(g);
  const m = clampMargins(margins, size);
  const r = fromView({ x: m.left, y: m.top, w: size[0] - m.left - m.right, h: size[1] - m.top - m.bottom }, g);
  return { x: r.x, y: r.y - r.h, width: r.w, height: r.h };
}

/**
 * Limites do conteúdo numa imagem RGBA da página (fundo branco): o menor retângulo com pixels mais
 * escuros que `threshold`. Devolve null se a página estiver em branco. Ignora pontinhos isolados
 * (sujeira de digitalização) exigindo `minInk` pixels escuros na linha/coluna.
 */
export function contentBounds(data: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 235, minInk = 2) {
  const rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      // Mistura com o branco (pixels transparentes = papel)
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) { rows[y]++; cols[x]++; }
    }
  }
  const first = (arr: Uint32Array) => arr.findIndex((v) => v >= minInk);
  const last = (arr: Uint32Array) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= minInk) return i; return -1; };
  const top = first(rows), bottom = last(rows), left = first(cols), right = last(cols);
  if (top < 0 || left < 0) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** Margens (pt) que deixam só o conteúdo encontrado, com uma folga. `scale` = pixels por pt. */
export function marginsFromBounds(b: { x: number; y: number; w: number; h: number } | null, imgW: number, imgH: number, scale: number, pad: number): Margins {
  if (!b) return NO_MARGINS;
  return {
    left: Math.max(0, b.x / scale - pad),
    top: Math.max(0, b.y / scale - pad),
    right: Math.max(0, (imgW - b.x - b.w) / scale - pad),
    bottom: Math.max(0, (imgH - b.y - b.h) / scale - pad),
  };
}

/** Aplica as margens de cada página (null = não mexe na página). */
export function applyCrop(doc: PDFDocument, marginsOf: (index: number) => Margins | null) {
  doc.getPages().forEach((page, i) => {
    const m = marginsOf(i);
    if (!m || (!m.top && !m.right && !m.bottom && !m.left)) return;
    const box = cropBoxFor(pageGeo(page), m);
    page.setCropBox(box.x, box.y, box.width, box.height);
  });
}
