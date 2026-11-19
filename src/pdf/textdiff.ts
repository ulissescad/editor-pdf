// Comparar PDFs (PLANO.md, item 2.15): palavras de cada página e diferenças entre duas sequências.
// O diff usa âncoras (palavras que aparecem uma só vez dos dois lados) e, entre elas, o algoritmo de Myers:
// é rápido em documentos grandes e não se perde quando um trecho inteiro muda. Funções puras, testadas em tests/unit.
import type { Rect } from '../editor/model';
import { evenMeasure, selectBetween, type Caret, type Measure, type TextRun } from '../editor/textsel';
import { pageText } from './redact';

export interface Word {
  text: string;
  page: number;   // 0-based
  gap: boolean;   // havia espaço antes (para remontar o texto como no documento: “R$”, “5%”)
  from: Caret;
  to: Caret;      // logo depois do último caractere
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const JOINER = /[-.,/:'’‐‑]/;   // dentro de uma palavra: 1.000,00 · e-mail · 10:30 · d’água
const HYPHEN = /[-­‐]/;
const LOWER = /\p{Ll}/u;

/** Palavras (e sinais de pontuação soltos) da página. “compa-⏎ração” conta como uma palavra só. */
export function pageWords(runs: TextRun[], page: number): Word[] {
  const { text, at } = pageText(runs);
  const chars = [...text];
  const words: Word[] = [];
  const emit = (idx: number[]) => {
    const first = at[idx[0]], last = at[idx[idx.length - 1]];
    if (!first || !last) return;
    const gap = idx[0] === 0 || /\s/.test(chars[idx[0] - 1]);
    words.push({ text: idx.map((i) => chars[i]).join(''), page, gap, from: first, to: { run: last.run, idx: last.idx + 1 } });
  };
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (/\s/.test(c) || c === '­') { i++; continue; }
    if (!WORD_CHAR.test(c)) { emit([i++]); continue; }
    const idx: number[] = [];
    for (;;) {
      while (i < chars.length && WORD_CHAR.test(chars[i])) idx.push(i++);
      const next = chars[i], after = chars[i + 1];
      if (next === undefined) break;
      if (HYPHEN.test(next) && after === '\n' && chars[i + 2] && LOWER.test(chars[i + 2])) { i += 2; continue; }
      if (JOINER.test(next) && after && WORD_CHAR.test(after)) { idx.push(i++); continue; }
      break;
    }
    emit(idx);
  }
  return words;
}

export interface CompareOptions { ignoreCase?: boolean }

/** Forma usada para comparar: variações de aspas, traços e ligaduras não contam como diferença. */
export function wordKey(text: string, { ignoreCase = false }: CompareOptions = {}): string {
  const s = text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-');
  return ignoreCase ? s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : s;
}

/** Trecho diferente: [a0, a1) saiu de A e [b0, b1) entrou em B. */
export interface Hunk { a0: number; a1: number; b0: number; b1: number }

/** Pares (i, j) de itens únicos nos dois lados, na maior sequência que mantém a ordem. */
function anchors(A: Int32Array, B: Int32Array, a0: number, a1: number, b0: number, b1: number): Array<[number, number]> {
  const seen = new Map<number, { na: number; nb: number; ia: number; ib: number }>();
  for (let i = a0; i < a1; i++) {
    const e = seen.get(A[i]);
    if (e) e.na++; else seen.set(A[i], { na: 1, nb: 0, ia: i, ib: -1 });
  }
  for (let j = b0; j < b1; j++) {
    const e = seen.get(B[j]);
    if (e) { e.nb++; e.ib = j; }
  }
  const pairs: Array<[number, number]> = [];
  for (const e of seen.values()) if (e.na === 1 && e.nb === 1) pairs.push([e.ia, e.ib]); // Map mantém a ordem de A
  // Maior subsequência crescente em j (paciência)
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([, j], p) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < j) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[p] = tails[lo - 1];
    tails[lo] = p;
  });
  const out: Array<[number, number]> = [];
  for (let p = tails.length ? tails[tails.length - 1] : -1; p >= 0; p = prev[p]) out.push(pairs[p]);
  return out.reverse();
}

/** Myers O(ND). Se os trechos forem diferentes demais (mais de maxD edições), viram uma troca só. */
function myers(A: Int32Array, B: Int32Array, a0: number, a1: number, b0: number, b1: number, maxD: number, out: Hunk[]) {
  const N = a1 - a0, M = b1 - b0;
  const limit = Math.min(N + M, maxD);
  const off = limit + 1;
  const V = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(V.slice(off - d - 1, off + d + 2)); // estado antes desta rodada (k de −d−1 a d+1)
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[a0 + x] === B[b0 + y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) {
        const edits: Hunk[] = [];
        let cx = N, cy = M;
        for (let D = d; D > 0; D--) {
          const v = trace[D], o = D + 1, kk = cx - cy;
          const pk = kk === -D || (kk !== D && v[o + kk - 1] < v[o + kk + 1]) ? kk + 1 : kk - 1;
          const px = v[o + pk], py = px - pk;
          edits.push(pk === kk + 1
            ? { a0: a0 + px, a1: a0 + px, b0: b0 + py, b1: b0 + py + 1 }
            : { a0: a0 + px, a1: a0 + px + 1, b0: b0 + py, b1: b0 + py });
          cx = px; cy = py;
        }
        out.push(...edits.reverse());
        return;
      }
    }
  }
  out.push({ a0, a1, b0, b1 });
}

function walk(A: Int32Array, B: Int32Array, a0: number, a1: number, b0: number, b1: number, maxD: number, out: Hunk[]) {
  while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) { a0++; b0++; }
  while (a0 < a1 && b0 < b1 && A[a1 - 1] === B[b1 - 1]) { a1--; b1--; }
  if (a0 === a1 && b0 === b1) return;
  if (a0 === a1 || b0 === b1) { out.push({ a0, a1, b0, b1 }); return; }
  const pairs = anchors(A, B, a0, a1, b0, b1);
  if (!pairs.length) { myers(A, B, a0, a1, b0, b1, maxD, out); return; }
  let pa = a0, pb = b0;
  for (const [i, j] of pairs) {
    walk(A, B, pa, i, pb, j, maxD, out);
    pa = i + 1; pb = j + 1;
  }
  walk(A, B, pa, a1, pb, b1, maxD, out);
}

/**
 * Uma inserção ou remoção pode ser descrita de mais de um jeito quando o texto se repete nas pontas:
 * “. Frase nova” e “Frase nova .” dão o mesmo resultado. Prefere o que começa numa palavra.
 */
function slideToWords(hunks: Hunk[], a: string[], b: string[]) {
  hunks.forEach((h, i) => {
    const inserted = h.a0 === h.a1, removed = h.b0 === h.b1;
    if (inserted === removed) return;
    const limit = hunks[i + 1]?.a0 ?? a.length;
    const list = inserted ? b : a;
    let [s, e] = inserted ? [h.b0, h.b1] : [h.a0, h.a1];
    while (h.a1 < limit && e < list.length && list[s] === list[e] && !WORD_CHAR.test(list[s])) {
      s++; e++; h.a0++; h.a1++; h.b0++; h.b1++;
    }
  });
}

/** Diferenças entre duas listas. Trechos separados só por pontuação viram um só. */
export function diffKeys(a: string[], b: string[], maxD = 2000): Hunk[] {
  const ids = new Map<string, number>();
  const intern = (list: string[]) => Int32Array.from(list, (s) => {
    let id = ids.get(s);
    if (id === undefined) ids.set(s, id = ids.size);
    return id;
  });
  const A = intern(a), B = intern(b);
  const raw: Hunk[] = [];
  walk(A, B, 0, A.length, 0, B.length, maxD, raw);
  slideToWords(raw, a, b);
  const out: Hunk[] = [];
  for (const h of raw) {
    const p = out[out.length - 1];
    const gap = p ? h.a0 - p.a1 : Infinity;
    if (p && (gap === 0 || (gap === 1 && !WORD_CHAR.test(a[p.a1])))) { p.a1 = h.a1; p.b1 = h.b1; }
    else out.push({ ...h });
  }
  return out;
}

/** O texto começa com pontuação que fica colada no que vem antes? */
export const startsTight = (text: string) => /^[.,;:!?%)\]}»”]/.test(text);

/** Junta palavras em texto corrido, com os espaços do documento (ou, sem essa informação, pela pontuação). */
export function joinWords(words: Array<{ text: string; gap?: boolean }>): string {
  let s = '';
  for (const { text, gap } of words) {
    const tight = !s || (gap === undefined ? startsTight(text) || /[([{«“]$/.test(s) : !gap);
    s += (tight ? '' : ' ') + text;
  }
  return s;
}

export interface Change extends Hunk {
  pageA: number; pageB: number;
  removed: string; added: string;
  before: string; after: string;  // algumas palavras em volta, para situar
}

const CONTEXT = 6;

export function compareWords(a: Word[], b: Word[], options: CompareOptions = {}): Change[] {
  const hunks = diffKeys(a.map((w) => wordKey(w.text, options)), b.map((w) => wordKey(w.text, options)));
  return hunks.map((h) => ({
    ...h,
    pageA: (a[h.a0] ?? a[h.a0 - 1])?.page ?? 0,
    pageB: (b[h.b0] ?? b[h.b0 - 1])?.page ?? 0,
    removed: joinWords(a.slice(h.a0, h.a1)),
    added: joinWords(b.slice(h.b0, h.b1)),
    before: joinWords(b.slice(Math.max(0, h.b0 - CONTEXT), h.b0)),
    after: joinWords(b.slice(h.b1, h.b1 + CONTEXT)),
  }));
}

/** Retângulos (espaço do PDF) das palavras: as vizinhas na mesma linha viram um retângulo só. */
export function wordRects(words: Word[], runs: TextRun[], measure: Measure = evenMeasure): Rect[] {
  const out: Rect[] = [];
  for (const w of words) {
    for (const q of selectBetween(runs, w.from, w.to, measure)?.quads ?? []) {
      const p = out[out.length - 1];
      const sameLine = p && Math.abs(p.y - q.y) < p.h * 0.4 && Math.abs(p.h - q.h) < p.h * 0.4;
      if (p && sameLine && q.x >= p.x && q.x - (p.x + p.w) < p.h) {
        const top = Math.max(p.y, q.y), bottom = Math.min(p.y - p.h, q.y - q.h);
        p.w = q.x + q.w - p.x; p.y = top; p.h = top - bottom;
      } else out.push({ ...q });
    }
  }
  return out;
}
