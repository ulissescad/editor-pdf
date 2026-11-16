// Seleção de texto pela geometria (PLANO.md, item 1.11 e risco 4). Arrastar sobre as linhas marca o
// texto, com o dedo ou o mouse, sem depender da seleção nativa do navegador (ruim no celular sobre o pdf.js).
// Tudo no espaço do PDF: funciona igual com zoom e em páginas giradas. Funções puras, testadas em tests/unit.
import type { Rect } from './model';
import { normRot, type Rotation } from './geom';
import { unionRect } from './draw';

/** Um trecho de texto do pdf.js (um item do getTextContent), com a geometria pronta para o toque. */
export interface TextRun {
  str: string;
  o: [number, number];    // origem: início da linha de base, no espaço do PDF
  dir: [number, number];  // vetor unitário na direção do texto
  w: number;              // comprimento na direção do texto (pt)
  asc: number;            // altura acima da linha de base (pt)
  desc: number;           // profundidade abaixo da linha de base (pt, ≥ 0)
  rot: Rotation;          // direção do texto arredondada a 90°
  family: string;         // família genérica (para medir os caracteres)
  offs?: number[];        // início de cada caractere em fração de w; offs[str.length] = 1
}

/** Mede a largura de cada caractere de um texto (qualquer unidade: só as proporções importam). */
export type Measure = (str: string, family: string) => number[];

interface TextItemLike { str?: string; transform?: number[]; width?: number; fontName?: string }
interface StyleLike { ascent?: number; descent?: number; vertical?: boolean; fontFamily?: string }

/** Trechos de texto de uma página, a partir do getTextContent() do pdf.js. */
export function textRuns(items: TextItemLike[], styles: Record<string, StyleLike>): TextRun[] {
  const runs: TextRun[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform || !it.width) continue;
    const [a, b, c, d, e, f] = it.transform;
    const len = Math.hypot(a, b);
    if (!len) continue;
    const st = styles[it.fontName ?? ''] ?? {};
    if (st.vertical) continue; // escrita vertical: fora do escopo
    const size = Math.hypot(c, d) || len;
    const ascent = st.ascent && st.ascent > 0.3 && st.ascent < 1.5 ? st.ascent : 0.8;
    const descent = st.descent && st.descent < 0 && st.descent > -0.8 ? -st.descent : 0.2;
    const dir: [number, number] = [a / len, b / len];
    runs.push({
      str: it.str, o: [e, f], dir, w: it.width, asc: size * ascent, desc: size * descent,
      rot: normRot((Math.atan2(dir[1], dir[0]) * 180) / Math.PI), family: st.fontFamily ?? 'sans-serif',
    });
  }
  return runs;
}

/** Medida simples (todos os caracteres com a mesma largura), para quando não há canvas. */
export const evenMeasure: Measure = (s) => [...s].map(() => 1);

function offsets(r: TextRun, measure: Measure): number[] {
  if (r.offs) return r.offs;
  const chars = [...r.str];
  let widths = measure(r.str, r.family);
  if (widths.length !== chars.length || widths.some((v) => !(v >= 0))) widths = chars.map(() => 1);
  const total = widths.reduce((s, v) => s + v, 0) || chars.length;
  const offs = [0];
  let acc = 0;
  for (const v of widths) { acc += v; offs.push(acc / total); }
  offs[offs.length - 1] = 1;
  r.offs = offs;
  return offs;
}

const charCount = (r: TextRun) => [...r.str].length;

/** Posição do cursor: antes do caractere `idx` do trecho `run`. */
export interface Caret { run: number; idx: number }

/** Distância do ponto à caixa do trecho (0 se estiver dentro) e a posição ao longo do texto. */
function locate(r: TextRun, x: number, y: number) {
  const dx = x - r.o[0], dy = y - r.o[1];
  const u = dx * r.dir[0] + dy * r.dir[1];      // ao longo do texto
  const v = -dx * r.dir[1] + dy * r.dir[0];     // para cima, perpendicular ao texto
  const du = u < 0 ? -u : u > r.w ? u - r.w : 0;
  const dv = v < -r.desc ? -r.desc - v : v > r.asc ? v - r.asc : 0;
  return { u, dist: Math.hypot(du, dv * 1.5) }; // na vertical, pesa mais: prefere a linha certa
}

/**
 * Cursor mais próximo do ponto (espaço do PDF). Com `tol`, só aceita trechos a até `tol` pt;
 * sem `tol`, pega o mais próximo de todos (para o fim do arraste).
 */
export function caretAt(runs: TextRun[], x: number, y: number, measure: Measure = evenMeasure, tol?: number): Caret | null {
  let best = -1, bestDist = Infinity, bestU = 0;
  runs.forEach((r, i) => {
    const { u, dist } = locate(r, x, y);
    if (dist < bestDist) { best = i; bestDist = dist; bestU = u; }
  });
  if (best < 0 || (tol !== undefined && bestDist > tol)) return null;
  const r = runs[best];
  const offs = offsets(r, measure);
  const f = bestU / r.w;
  const n = charCount(r);
  let idx = n;
  for (let k = 0; k < n; k++) if (f < (offs[k] + offs[k + 1]) / 2) { idx = k; break; }
  return { run: best, idx };
}

export interface TextSelection { quads: Rect[]; text: string; rot: Rotation }

/** Retângulo (espaço do PDF) do trecho entre os caracteres s e e de um run. */
function segmentRect(r: TextRun, s: number, e: number, measure: Measure): Rect {
  const offs = offsets(r, measure);
  const u0 = offs[s] * r.w, u1 = offs[e] * r.w;
  const px = -r.dir[1], py = r.dir[0];
  const corners = [[u0, -r.desc], [u1, -r.desc], [u0, r.asc], [u1, r.asc]].map(([u, v]) =>
    [r.o[0] + r.dir[0] * u + px * v, r.o[1] + r.dir[1] * u + py * v]);
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: Math.max(...ys), w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** Intervalo do retângulo ao longo do texto e na perpendicular, para a direção `rot`. */
function axes(q: Rect, rot: Rotation) {
  const xr: [number, number] = [q.x, q.x + q.w], yr: [number, number] = [q.y - q.h, q.y];
  return rot % 180 ? { along: yr, across: xr } : { along: xr, across: yr };
}

/** Texto entre dois cursores (em qualquer ordem): um retângulo por linha, o texto e a direção. */
export function selectBetween(runs: TextRun[], a: Caret, b: Caret, measure: Measure = evenMeasure): TextSelection | null {
  if (a.run > b.run || (a.run === b.run && a.idx > b.idx)) [a, b] = [b, a];
  type Line = { q: Rect; text: string; rot: Rotation };
  const lines: Line[] = [];
  for (let i = a.run; i <= b.run; i++) {
    const r = runs[i];
    const s = i === a.run ? a.idx : 0;
    const e = i === b.run ? b.idx : charCount(r);
    if (e <= s) continue;
    const text = [...r.str].slice(s, e).join('');
    if (!text.trim()) continue;
    const q = segmentRect(r, s, e, measure);
    const last = lines[lines.length - 1];
    if (last && last.rot === r.rot) {
      const A = axes(last.q, r.rot), B = axes(q, r.rot);
      const overlap = Math.min(A.across[1], B.across[1]) - Math.max(A.across[0], B.across[0]);
      const height = Math.min(A.across[1] - A.across[0], B.across[1] - B.across[0]);
      const gap = Math.max(B.along[0] - A.along[1], A.along[0] - B.along[1]);
      if (overlap >= height * 0.5 && gap <= height * 1.5) {
        last.q = unionRect([last.q, q]);
        last.text += (gap > height * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(text) ? ' ' : '') + text;
        continue;
      }
    }
    lines.push({ q, text, rot: r.rot });
  }
  if (!lines.length) return null;
  return {
    quads: lines.map((l) => l.q),
    text: lines.map((l) => l.text.trim()).join(' ').replace(/\s+/g, ' '),
    rot: lines[0].rot,
  };
}

const WORD = /[\p{L}\p{N}'’-]/u;

/** A palavra em volta do cursor (um toque sem arrastar marca a palavra tocada). */
export function wordAt(runs: TextRun[], c: Caret, measure: Measure = evenMeasure): TextSelection | null {
  const chars = [...runs[c.run].str];
  let i = Math.min(c.idx, chars.length - 1);
  if (!WORD.test(chars[i]) && i > 0 && WORD.test(chars[i - 1])) i--; // tocou logo depois da palavra
  if (!WORD.test(chars[i])) return null;
  let s = i, e = i + 1;
  while (s > 0 && WORD.test(chars[s - 1])) s--;
  while (e < chars.length && WORD.test(chars[e])) e++;
  return selectBetween(runs, { run: c.run, idx: s }, { run: c.run, idx: e }, measure);
}

/** Medida pelo canvas do navegador, com cache por família e caractere. */
export function canvasMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map<string, number>();
  return (str, family) => [...str].map((ch) => {
    const key = family + '\u0000' + ch;
    let v = cache.get(key);
    if (v === undefined) {
      if (ctx) { ctx.font = `100px ${family}`; v = ctx.measureText(ch).width; } else v = 1;
      cache.set(key, v);
    }
    return v;
  });
}
