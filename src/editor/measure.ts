// Mede, na tela, como o texto de uma caixa quebrou em linhas, para o PDF sair igual ao que se vê.
import { FONTS, LINE, PAD, isItalic, type TextStyle } from './model';

const baselineCache = new Map<string, number>();

export const cssFont = (s: TextStyle, px: number) =>
  `${isItalic(s) ? 'italic' : 'normal'} ${s.bold ? 700 : 400} ${px}px ${FONTS[s.font].css}`;

/** Distância do topo da linha até a linha de base, em múltiplos do tamanho da fonte. */
export function baselineFactor(s: TextStyle): number {
  const key = `${s.font}|${s.bold}|${s.italic}`;
  let v = baselineCache.get(key);
  if (v === undefined) {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;line-height:${LINE}`;
    d.style.font = cssFont(s, 100);
    d.style.lineHeight = String(LINE);
    d.textContent = 'Hg';
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:1px;height:0';
    d.appendChild(probe);
    document.body.appendChild(d);
    v = (probe.getBoundingClientRect().top - d.getBoundingClientRect().top) / 100;
    d.remove();
    baselineCache.set(key, v);
  }
  return v;
}

/** Garante que as fontes do editor estão carregadas antes de medir ou gravar. */
export async function fontsReady(styles: TextStyle[]) {
  const wanted = new Set(styles.map((s) => cssFont(s, 16)));
  await Promise.all([...wanted].map((f) => document.fonts.load(f, 'Aá')));
  await document.fonts.ready;
  baselineCache.clear();
}

export interface MeasuredLine { index: number; text: string }

/**
 * Lê as linhas como o navegador as quebrou: cada caractere é atribuído à linha onde aparece.
 * Linhas em branco (Enter duplo) são preservadas pelo índice.
 */
export function measureLines(content: HTMLElement, style: TextStyle, scale: number): MeasuredLine[] {
  // Texto girado (página girada): mede sem o giro, que não muda as quebras de linha
  const transform = content.style.transform;
  if (transform) content.style.transform = 'none';
  try {
    return readLines(content, style, scale);
  } finally {
    if (transform) content.style.transform = transform;
  }
}

function readLines(content: HTMLElement, style: TextStyle, scale: number): MeasuredLine[] {
  content.scrollTop = 0;
  const lineH = style.size * LINE * scale;
  const top0 = content.getBoundingClientRect().top + content.clientTop + PAD * scale;
  const lines: string[] = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const t = node.data;
    for (let i = 0; i < t.length; ) {
      const cp = t.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      const ch = t.slice(i, i + len);
      if (ch !== '\n' && ch !== '\r') {
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const r = range.getClientRects()[0];
        if (r) {
          const idx = Math.max(0, Math.floor(((r.top + r.bottom) / 2 - top0) / lineH));
          lines[idx] = (lines[idx] ?? '') + ch;
        }
      }
      i += len;
    }
  }
  return lines
    .map((t, index) => ({ index, text: (t ?? '').replace(/\s+$/, '').replace(/\t/g, '    ') }))
    .filter((l) => l.text);
}
