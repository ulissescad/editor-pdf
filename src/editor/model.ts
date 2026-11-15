// Modelo de objetos do editor (PLANO.md, seção 3).
// Posições e tamanhos ficam em pontos do PDF (origem no canto inferior esquerdo da página);
// x/y é o canto superior esquerdo do objeto. Assim o zoom e o aparelho não alteram nada.

export const PAD = 2;     // margem interna das caixas de texto, em pt
export const LINE = 1.2;  // altura de linha em múltiplos do tamanho da fonte

export type FontId = 'sans' | 'serif' | 'mono' | 'modern' | 'hand' | 'script';
export type Align = 'left' | 'center' | 'right';

type Four<T> = [T, T, T, T]; // normal, negrito, itálico, negrito+itálico

export interface FontDef {
  label: string;
  css: string;
  italic: boolean;              // a fonte tem itálico de verdade?
  pdf?: Four<string>;           // fonte padrão do PDF (não precisa embutir)
  files?: Four<string | null>;  // arquivos WOFF (em @fontsource/…) embutidos no PDF
}

/**
 * Fontes padrão: na tela usamos fontes servidas pelo site com as MESMAS medidas das fontes padrão do PDF
 * (Arimo = Helvetica/Arial, Tinos = Times, Cousine = Courier). Assim as quebras de linha medidas
 * na tela valem no PDF em qualquer aparelho, inclusive no Android, que não tem Arial.
 * Fontes extras: o próprio arquivo da fonte vai embutido no PDF (só os caracteres usados).
 */
export const FONTS: Record<FontId, FontDef> = {
  sans:   { label: 'Arial / Helvetica', css: 'Arimo, Arial, Helvetica, sans-serif', italic: true,
            pdf: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  serif:  { label: 'Times New Roman', css: 'Tinos, "Times New Roman", Times, serif', italic: true,
            pdf: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  mono:   { label: 'Courier New', css: 'Cousine, "Courier New", Courier, monospace', italic: true,
            pdf: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
  modern: { label: 'Open Sans (moderna)', css: '"Open Sans", sans-serif', italic: true,
            files: ['open-sans/files/open-sans-latin-400-normal.woff', 'open-sans/files/open-sans-latin-700-normal.woff',
                    'open-sans/files/open-sans-latin-400-italic.woff', 'open-sans/files/open-sans-latin-700-italic.woff'] },
  hand:   { label: 'Caveat (manuscrita)', css: 'Caveat, cursive', italic: false,
            files: ['caveat/files/caveat-latin-400-normal.woff', 'caveat/files/caveat-latin-700-normal.woff', null, null] },
  script: { label: 'Dancing Script (cursiva)', css: '"Dancing Script", cursive', italic: false,
            files: ['dancing-script/files/dancing-script-latin-400-normal.woff', 'dancing-script/files/dancing-script-latin-700-normal.woff', null, null] },
};

/** Itálico só vale se a fonte tiver itálico (senão a tela inclinaria e o PDF não). */
export const isItalic = (s: Pick<TextStyle, 'font' | 'italic'>) => s.italic && FONTS[s.font].italic;
const variant = (s: TextStyle) => (s.bold ? 1 : 0) + (isItalic(s) ? 2 : 0);

/** Nome da fonte padrão do PDF, ou undefined se a fonte for embutida. */
export const pdfFontName = (s: TextStyle) => FONTS[s.font].pdf?.[variant(s)];
/** Arquivo da fonte a embutir (caminho dentro de @fontsource), ou undefined se for fonte padrão. */
export const fontFile = (s: TextStyle) => FONTS[s.font].files?.[variant(s)] ?? undefined;

export interface TextStyle {
  font: FontId;
  size: number;      // pt
  bold: boolean;
  italic: boolean;
  color: string;     // #rrggbb
  align: Align;
}

export interface Rect { x: number; y: number; w: number; h: number }

interface Base {
  id: string;
  page: number;      // 0-based
  rect: Rect;
}

export interface TextObj extends Base {
  kind: 'text';
  style: TextStyle;
  text: string;
}

/** Imagem ou assinatura. Os bytes ficam à parte (ImageAsset), para o histórico não carregar imagens. */
export interface ImageObj extends Base {
  kind: 'image';
  imageId: string;
  signature?: boolean;
}

export type SymbolId = 'check' | 'cross' | 'dot' | 'circle';

/** Símbolo vetorial (✓ ✗ ● ○), desenhado como caminho: sai igual em qualquer leitor. */
export interface SymbolObj extends Base {
  kind: 'symbol';
  symbol: SymbolId;
  color: string;
}

export type FieldType = 'text' | 'check';

/** Campo de formulário a criar no PDF (AcroForm de verdade). Pode já levar um valor preenchido. */
export interface FieldObj extends Base {
  kind: 'field';
  type: FieldType;
  name: string;
  value: string;     // texto; na caixa de seleção, '' ou 'sim'
  size: number;      // tamanho da fonte, em pt
  multiline: boolean;
}

export type Obj = TextObj | ImageObj | SymbolObj | FieldObj;
export type ObjKind = Obj['kind'];

export interface ImageAsset {
  id: string;
  mime: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  w: number;         // pixels
  h: number;
}

export const DEFAULT_STYLE: TextStyle = { font: 'sans', size: 11, bold: false, italic: false, color: '#000000', align: 'left' };

export const minHeight = (style: Pick<TextStyle, 'size'>) => style.size * LINE + 2 * PAD;

let counter = 0;
export const newId = () => `o${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeText(page: number, rect: Rect, style: TextStyle, text = ''): TextObj {
  return { id: newId(), kind: 'text', page, rect: { ...rect, h: Math.max(rect.h, minHeight(style)) }, style: { ...style }, text };
}

export function makeImage(page: number, rect: Rect, imageId: string, signature = false): ImageObj {
  return { id: newId(), kind: 'image', page, rect: { ...rect }, imageId, ...(signature ? { signature: true } : {}) };
}

export function makeSymbol(page: number, rect: Rect, symbol: SymbolId, color: string): SymbolObj {
  return { id: newId(), kind: 'symbol', page, rect: { ...rect }, symbol, color };
}

export const FIELD_SIZE = 10;
export const fieldMultiline = (h: number, size: number) => h >= size * LINE * 2 + 2;

export function makeField(page: number, rect: Rect, type: FieldType, name: string, size = FIELD_SIZE): FieldObj {
  return {
    id: newId(), kind: 'field', page, rect: { ...rect }, type, name, value: '', size,
    multiline: type === 'text' && fieldMultiline(rect.h, size),
  };
}

/** Nome de campo válido no PDF (o ponto separa hierarquias) e legível. */
export function fieldName(label: string): string {
  const s = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[:?_.\s]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return s || 'campo';
}

/** Garante nomes únicos: “nome”, “nome_2”, “nome_3”… */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = base, n = 2;
  while (taken.has(name)) name = `${base}_${n++}`;
  taken.add(name);
  return name;
}

/** Objetos que mantêm a proporção ao redimensionar pelos cantos. */
export const keepsAspect = (o: Obj) => o.kind === 'image' || o.kind === 'symbol';

/** Objeto sem conteúdo (não vai para o PDF). */
export const isEmpty = (o: Obj) => o.kind === 'text' && !o.text.trim();

export const cloneObj = <T extends Obj>(o: T): T => JSON.parse(JSON.stringify(o));

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Mantém o retângulo dentro dos limites da página [x0, y0, x1, y1]. */
export function clampRect(r: Rect, [x0, y0, x1, y1]: number[]): Rect {
  const w = Math.min(r.w, x1 - x0), h = Math.min(r.h, y1 - y0);
  return { w, h, x: clamp(r.x, x0, x1 - w), y: clamp(r.y, y0 + h, y1) };
}

/** Retângulo de tamanho (w, h) centrado num ponto, dentro da página. */
export const rectAround = (cx: number, cy: number, w: number, h: number, bounds: number[]): Rect =>
  clampRect({ x: cx - w / 2, y: cy + h / 2, w, h }, bounds);

/** Projeto salvo no rascunho e embutido no PDF baixado (anexo editor-projeto.json). */
export interface Project {
  app: 'editor-pdf';
  version: 1;
  objects: Obj[];
  /** Imagens usadas pelos objetos, em base64 (só no anexo do PDF). */
  images?: Record<string, { mime: ImageAsset['mime']; w: number; h: number; data: string }>;
}

export const PROJECT_FILE = 'editor-projeto.json';

const SYMBOLS: SymbolId[] = ['check', 'cross', 'dot', 'circle'];

function validObj(o: Obj | null | undefined, images: Set<string>): boolean {
  if (!o || !Number.isInteger(o.page) || o.page < 0 || !o.rect || typeof o.id !== 'string') return false;
  switch (o.kind) {
    case 'text': return !!o.style && o.style.font in FONTS && typeof o.text === 'string';
    case 'image': return images.has(o.imageId);
    case 'symbol': return SYMBOLS.includes(o.symbol);
    case 'field': return (o.type === 'text' || o.type === 'check') && typeof o.name === 'string';
    default: return false;
  }
}

export function parseProject(json: string): { project: Project; assets: ImageAsset[] } | null {
  try {
    const p = JSON.parse(json);
    if (p?.app !== 'editor-pdf' || p.version !== 1 || !Array.isArray(p.objects)) return null;
    const assets: ImageAsset[] = [];
    for (const [id, img] of Object.entries((p.images ?? {}) as NonNullable<Project['images']>)) {
      if ((img?.mime !== 'image/png' && img?.mime !== 'image/jpeg') || typeof img.data !== 'string') continue;
      assets.push({ id, mime: img.mime, w: img.w, h: img.h, bytes: fromBase64(img.data) });
    }
    const ids = new Set(assets.map((a) => a.id));
    const objects = (p.objects as Obj[]).filter((o) => validObj(o, ids));
    return { project: { app: 'editor-pdf', version: 1, objects }, assets };
  } catch {
    return null;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Hoje no formato brasileiro (dd/mm/aaaa). */
export const today = (d = new Date()) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
