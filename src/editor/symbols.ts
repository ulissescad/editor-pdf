// Símbolos vetoriais num quadro de 24×24 unidades. A mesma definição desenha na tela (SVG)
// e no PDF (drawSvgPath), então o resultado é idêntico.
import type { SymbolId } from './model';
import { tk } from '../lib/i18n.svelte';

export interface SymbolDef {
  label: string;
  char: string;
  path: string;
  stroke?: number;   // espessura do traço (unidades do quadro); sem traço = preenchido
}

export const SYMBOL_DEFS: Record<SymbolId, SymbolDef> = {
  check:  { label: tk('Visto'), char: '✓', path: 'M4 12.5 L9.5 18 L20 6', stroke: 3 },
  cross:  { label: tk('Xis'), char: '✗', path: 'M5 5 L19 19 M19 5 L5 19', stroke: 3 },
  dot:    { label: tk('Ponto'), char: '●', path: 'M12 5 A7 7 0 1 1 12 19 A7 7 0 1 1 12 5 Z' },
  circle: { label: tk('Círculo'), char: '○', path: 'M12 4 A8 8 0 1 1 12 20 A8 8 0 1 1 12 4 Z', stroke: 2.5 },
};

export const SYMBOL_IDS = Object.keys(SYMBOL_DEFS) as SymbolId[];
export const SYMBOL_SIZE = 14; // pt (tamanho inicial)
