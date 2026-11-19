// Chaves de tradução usadas no código: o texto em português dentro de t(), tn(), tk() e tPdf().
// Usado pelo teste de completude (tests/unit/i18n.test.ts) e pelo script que lista as chaves.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'i18n' ? [] : files(p);
    return /\.(ts|svelte)$/.test(f) ? [p] : [];
  });
}

const STR = String.raw`'((?:[^'\\]|\\.)*)'`;
const ONE = new RegExp(String.raw`\b(?:t|tk|tPdf)\(\s*${STR}`, 'g');
const PLURAL = new RegExp(String.raw`\btn\([^,]+,\s*${STR}\s*,\s*${STR}`, 'g');
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

export interface Keys { simple: Set<string>; plural: Set<string> }

export function collectKeys(): Keys {
  const simple = new Set<string>(), plural = new Set<string>();
  for (const f of files(SRC.pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(ONE)) simple.add(unescape(m[1]));
    for (const m of s.matchAll(PLURAL)) plural.add(`${unescape(m[1])}|${unescape(m[2])}`);
  }
  return { simple, plural };
}

/** Os {campos} de um texto, em ordem alfabética. */
export const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
