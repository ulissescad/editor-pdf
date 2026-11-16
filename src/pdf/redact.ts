// Tarja (PLANO.md, item 2.11): achar no texto da página o que deve ser tarjado (palavras digitadas ou
// padrões como CPF e e-mail) e devolver os retângulos. Só regras, nada de IA (R2). Funções puras, testadas
// em tests/unit; a pintura e a montagem do PDF ficam em raster.ts.
import type { Rect } from '../editor/model';
import { evenMeasure, selectBetween, type Caret, type Measure, type TextRun } from '../editor/textsel';

/** Padrões prontos (Brasil). */
export const PATTERNS = {
  cpf: { label: 'CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}\s?-?\s?\d{2}\b/g },
  cnpj: { label: 'CNPJ', re: /\b\d{2}\.?\d{3}\.?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2}\b/g },
  email: { label: 'E-mail', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  telefone: { label: 'Telefone', re: /(?:\(\s?\d{2}\s?\)|\b\d{2})\s?9?\d{4}\s?-?\s?\d{4}\b/g },
} as const;
export type PatternId = keyof typeof PATTERNS;

/** Letra sem acento e minúscula (mesmo comprimento: um caractere vira um caractere). */
const fold = (ch: string) => (ch.normalize('NFD')[0] ?? ch).toLowerCase();

/** Texto da página para busca: os trechos na ordem, com espaço entre palavras e quebra entre linhas. */
export interface PageText { text: string; at: Array<Caret | null> }

export function pageText(runs: TextRun[]): PageText {
  const chars: string[] = [];
  const at: Array<Caret | null> = [];
  runs.forEach((r, ri) => {
    if (ri > 0) {
      const p = runs[ri - 1];
      const size = Math.max(r.asc + r.desc, 1);
      const perp = [-p.dir[1], p.dir[0]];
      const across = Math.abs((r.o[0] - p.o[0]) * perp[0] + (r.o[1] - p.o[1]) * perp[1]);
      const gap = (r.o[0] - p.o[0]) * p.dir[0] + (r.o[1] - p.o[1]) * p.dir[1] - p.w;
      const sep = r.rot !== p.rot || across > size * 0.5 ? '\n' : gap > size * 0.15 ? ' ' : '';
      if (sep && !/\s$/.test(p.str) && !/^\s/.test(r.str)) { chars.push(sep); at.push(null); }
    }
    [...r.str].forEach((ch, idx) => { chars.push(ch); at.push({ run: ri, idx }); });
  });
  return { text: chars.join(''), at };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Busca do que a pessoa digitou: sem diferenciar maiúsculas nem acentos; espaços valem qualquer espaço. */
export function queryRegex(query: string): RegExp | null {
  const q = [...query.trim()].map(fold).join('');
  if (!q) return null;
  return new RegExp(q.split(/\s+/).map(escape).join('\\s+'), 'g');
}

/** Retângulos (espaço do PDF) de cada ocorrência. Padrões rodam no texto original; buscas, no texto sem acentos. */
export function findMatches(runs: TextRun[], re: RegExp, { folded = false, measure = evenMeasure, pad = 1 }: { folded?: boolean; measure?: Measure; pad?: number } = {}): Rect[][] {
  const { text, at } = pageText(runs);
  // Índices em pontos de código (como os cursores), não em unidades UTF-16
  const cps = [...text];
  const parts = folded ? cps.map(fold) : cps;
  const subject = parts.join('');
  const units: number[] = [];
  parts.forEach((c, i) => { for (let k = 0; k < c.length; k++) units.push(i); });
  units.push(parts.length);
  const out: Rect[][] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of subject.matchAll(g)) {
    if (!m[0].length) continue;
    let s = units[m.index!], e = units[m.index! + m[0].length] - 1;
    while (s <= e && !at[s]) s++;
    while (e >= s && !at[e]) e--;
    if (s > e) continue;
    const a = at[s]!, b = at[e]!;
    const sel = selectBetween(runs, a, { run: b.run, idx: b.idx + 1 }, measure);
    if (sel) out.push(sel.quads.map((q) => ({ x: q.x - pad, y: q.y + pad, w: q.w + 2 * pad, h: q.h + 2 * pad })));
  }
  return out;
}
