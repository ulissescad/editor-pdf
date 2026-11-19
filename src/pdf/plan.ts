// Plano de páginas (PLANO.md, seção 3): a lista de páginas do documento de saída, cada uma vinda de um
// arquivo de origem (com giro extra) ou em branco. Juntar, dividir e organizar são todos “montar um plano”.
// Funções puras, testadas em tests/unit.
import { cloneObj, newId, type Obj } from '../editor/model';
import { t, tn } from '../lib/i18n.svelte';

export interface SourcePage { src: number; index: number; rotate?: number }  // rotate: giro a somar, em graus
export interface BlankPage { blank: true; width: number; height: number }     // tamanho em pt (sem giro)
export type PageSpec = SourcePage | BlankPage;

export const isBlank = (s: PageSpec): s is BlankPage => 'blank' in s;

/** Todas as páginas de uma origem, na ordem. */
export const allPages = (src: number, count: number): SourcePage[] =>
  Array.from({ length: count }, (_, index) => ({ src, index }));

/**
 * Leva os objetos do editor de cada origem para as posições do plano. Objetos de páginas que saíram
 * são descartados; páginas repetidas repetem os objetos (com id novo). O giro não muda nada aqui:
 * os objetos ficam no espaço do PDF da página e giram junto com ela.
 */
export function remapObjects(perSource: Obj[][], specs: PageSpec[]): Obj[] {
  const out: Obj[] = [];
  const ids = new Set<string>();
  specs.forEach((s, page) => {
    if (isBlank(s)) return;
    for (const o of perSource[s.src] ?? []) {
      if (o.page !== s.index) continue;
      const c = cloneObj(o);
      c.page = page;
      if (ids.has(c.id)) c.id = newId();
      ids.add(c.id);
      out.push(c);
    }
  });
  return out;
}

export type RangeResult = { groups: number[][] } | { error: string };

/**
 * Lê intervalos digitados (“1-3, 5, 8-”) em grupos de páginas 0-based.
 * “8-” vai até a última página; “-3” começa na primeira. Intervalos invertidos (“5-3”) saem em ordem reversa.
 */
export function parseRanges(text: string, total: number): RangeResult {
  const parts = text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { error: t('Digite as páginas, por exemplo: 1-3, 5') };
  const groups: number[][] = [];
  for (const part of parts) {
    const m = /^(\d*)\s*(?:[-–a]\s*(\d*))?$/.exec(part.replace(/\s+/g, ' '));
    if (!m || (!m[1] && m[2] === undefined)) return { error: t('“{part}” não é um intervalo válido.', { part }) };
    const isRange = part.includes('-') || part.includes('–') || / a /.test(` ${part} `);
    const a = m[1] ? Number(m[1]) : 1;
    const b = isRange ? (m[2] ? Number(m[2]) : total) : a;
    if (a < 1 || b < 1 || a > total || b > total) {
      return { error: tn(total, 'A página {p} não existe (o PDF tem {n} página).', 'A página {p} não existe (o PDF tem {n} páginas).', { p: String(Math.max(a, b) > total ? Math.max(a, b) : Math.min(a, b)) }) };
    }
    const step = a <= b ? 1 : -1;
    const g: number[] = [];
    for (let p = a; p !== b + step; p += step) g.push(p - 1);
    groups.push(g);
  }
  return { groups };
}

/** Rótulo curto de um grupo de páginas para nomes de arquivo: “1-3”, “5”, “2_4_7”. */
export function groupLabel(g: number[]): string {
  if (!g.length) return '';
  const contiguous = g.every((p, i) => i === 0 || p === g[i - 1] + 1);
  if (g.length === 1) return String(g[0] + 1);
  if (contiguous) return `${g[0] + 1}-${g[g.length - 1] + 1}`;
  return g.length <= 6 ? g.map((p) => p + 1).join('_') : `${g[0] + 1}-etc`;
}

/** Nome base sem “.pdf” (e sem caracteres que atrapalham em nomes de arquivo). */
export const baseName = (name: string) =>
  name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'documento';
