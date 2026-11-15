// Modelo de objetos do editor (PLANO.md, seção 3).
// Posições e tamanhos ficam em pontos do PDF (origem no canto inferior esquerdo da página);
// x/y é o canto superior esquerdo do objeto. Assim o zoom e o aparelho não alteram nada.

export const PAD = 2;     // margem interna das caixas de texto, em pt
export const LINE = 1.2;  // altura de linha em múltiplos do tamanho da fonte

export type FontId = 'sans' | 'serif' | 'mono';
export type Align = 'left' | 'center' | 'right';

/**
 * Na tela usamos fontes servidas pelo site com as MESMAS medidas das fontes padrão do PDF
 * (Arimo = Helvetica/Arial, Tinos = Times, Cousine = Courier). Assim as quebras de linha medidas
 * na tela valem no PDF em qualquer aparelho, inclusive no Android, que não tem Arial.
 */
export const FONTS: Record<FontId, { label: string; css: string; pdf: [string, string, string, string] }> = {
  sans:  { label: 'Arial / Helvetica', css: 'Arimo, Arial, Helvetica, sans-serif',
           pdf: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  serif: { label: 'Times New Roman', css: 'Tinos, "Times New Roman", Times, serif',
           pdf: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  mono:  { label: 'Courier New', css: 'Cousine, "Courier New", Courier, monospace',
           pdf: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
};

export const pdfFontName = (s: TextStyle) => FONTS[s.font].pdf[(s.bold ? 1 : 0) + (s.italic ? 2 : 0)];

export interface TextStyle {
  font: FontId;
  size: number;      // pt
  bold: boolean;
  italic: boolean;
  color: string;     // #rrggbb
  align: Align;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface TextObj {
  id: string;
  kind: 'text';
  page: number;      // 0-based
  rect: Rect;
  style: TextStyle;
  text: string;
}

export type Obj = TextObj;

export const DEFAULT_STYLE: TextStyle = { font: 'sans', size: 11, bold: false, italic: false, color: '#000000', align: 'left' };

export const minHeight = (style: Pick<TextStyle, 'size'>) => style.size * LINE + 2 * PAD;

let counter = 0;
export const newId = () => `o${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeText(page: number, rect: Rect, style: TextStyle, text = ''): TextObj {
  return { id: newId(), kind: 'text', page, rect: { ...rect, h: Math.max(rect.h, minHeight(style)) }, style: { ...style }, text };
}

export const cloneObj = <T extends Obj>(o: T): T => JSON.parse(JSON.stringify(o));

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Mantém o retângulo dentro dos limites da página [x0, y0, x1, y1]. */
export function clampRect(r: Rect, [x0, y0, x1, y1]: number[]): Rect {
  const w = Math.min(r.w, x1 - x0), h = Math.min(r.h, y1 - y0);
  return { w, h, x: clamp(r.x, x0, x1 - w), y: clamp(r.y, y0 + h, y1) };
}

/** Projeto salvo no rascunho e embutido no PDF baixado (anexo editor-projeto.json). */
export interface Project {
  app: 'editor-pdf';
  version: 1;
  objects: Obj[];
}

export const PROJECT_FILE = 'editor-projeto.json';

export function parseProject(json: string): Project | null {
  try {
    const p = JSON.parse(json);
    if (p?.app !== 'editor-pdf' || p.version !== 1 || !Array.isArray(p.objects)) return null;
    const objects = p.objects.filter((o: Obj) => o?.kind === 'text' && Number.isInteger(o.page) && o.rect && o.style);
    return { app: 'editor-pdf', version: 1, objects };
  } catch {
    return null;
  }
}
