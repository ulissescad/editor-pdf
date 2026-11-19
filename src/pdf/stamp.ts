// Carimbos nas páginas (PLANO.md, itens 2.8 e 2.9): marca d’água (texto ou imagem) e números de página.
// Tudo é desenhado no quadro “em pé” da página vista: em páginas giradas (/Rotate) a marca e o número
// aparecem na posição certa e na direção de leitura, como na tela.
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts, concatTransformationMatrix, degrees,
  popGraphicsState, pushGraphicsState, rgb, type PDFFont, type PDFImage, type PDFPage,
} from '@cantoo/pdf-lib';
import { contentMatrix, viewSize, type PageGeo } from '../editor/geom';
import { tk, tPdf } from '../lib/i18n.svelte';

/** Caixa visível (CropBox) e giro da página. */
export function pageGeo(page: PDFPage): PageGeo {
  const b = page.getCropBox();
  return { view: [b.x, b.y, b.x + b.width, b.y + b.height], rotate: page.getRotation().angle };
}

/** Matriz que leva o quadro “em pé” da página vista (origem embaixo à esquerda, y para cima) ao PDF. */
export function uprightMatrix(g: PageGeo) {
  const [x0, y0, x1, y1] = g.view;
  return contentMatrix({ x: x0, y: y1, w: x1 - x0, h: y1 - y0 }, g.rotate);
}

/** Desenha no quadro em pé da página: `draw` recebe a largura e a altura como se vê. */
function upright(page: PDFPage, draw: (w: number, h: number) => void) {
  const g = pageGeo(page);
  const [w, h] = viewSize(g);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...uprightMatrix(g)));
  draw(w, h);
  page.pushOperators(popGraphicsState());
}

export function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
}

/** Troca por “?” os caracteres que a fonte padrão do PDF não tem. Devolve o texto e quantos trocou. */
export function encodable(font: PDFFont, text: string): { text: string; replaced: number } {
  const supported = new Set(font.getCharacterSet());
  let replaced = 0;
  const out = [...text].map((ch) => {
    if (supported.has(ch.codePointAt(0)!)) return ch;
    replaced++;
    return '?';
  }).join('');
  return { text: out, replaced };
}

/** Pagina-alvo: todas (null) ou uma lista de índices 0-based. */
export const selected = (pages: number[] | null, i: number) => !pages || pages.includes(i);

// ===================== Números de página =====================

export type NumPos = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export type NumFormat = 'n' | 'n-de' | 'pag' | 'pag-de' | 'traco';

export interface NumberOptions {
  position: NumPos;
  format: NumFormat;
  from: number;     // primeira página numerada (1-based): as anteriores (capa) ficam sem número
  start: number;    // número que essa página recebe
  size: number;     // pt
  margin: number;   // pt, da borda da página vista
  color: string;    // #rrggbb
}

export const NUMBER_DEFAULTS: NumberOptions = { position: 'bc', format: 'n', from: 1, start: 1, size: 11, margin: 28, color: '#222222' };

/** Texto do número da página `index` (0-based) num documento de `count` páginas; null = sem número. */
export function numberLabel(index: number, count: number, o: Pick<NumberOptions, 'format' | 'from' | 'start'>): string | null {
  const p = index + 1;
  if (p < o.from) return null;
  const n = o.start + (p - o.from);
  const total = o.start + (count - o.from);
  switch (o.format) {
    // Texto que vai para dentro do PDF: no idioma do site, se a fonte padrão do PDF tiver as letras (tPdf)
    case 'n-de': return tPdf('{n} de {total}', { n: String(n), total: String(total) });
    case 'pag': return tPdf('Página {n}', { n: String(n) });
    case 'pag-de': return tPdf('Página {n} de {total}', { n: String(n), total: String(total) });
    case 'traco': return `– ${n} –`;
    default: return String(n);
  }
}

/** Onde fica a linha de base do texto (quadro em pé), dado o tamanho do texto. */
export function numberAt(pos: NumPos, page: [number, number], text: { w: number; ascent: number }, margin: number): [number, number] {
  const [pw, ph] = page;
  const x = pos[1] === 'l' ? margin : pos[1] === 'r' ? pw - margin - text.w : (pw - text.w) / 2;
  const y = pos[0] === 'b' ? margin : ph - margin - text.ascent;
  return [x, y];
}

export async function addPageNumbers(doc: PDFDocument, o: NumberOptions, labels?: (index: number) => string | null) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const label = labels ? labels(i) : numberLabel(i, pages.length, o);
    if (label) drawNumber(page, font, label, o);
  });
}

function drawNumber(page: PDFPage, font: PDFFont, label: string, o: NumberOptions) {
  const text = encodable(font, label).text;
  upright(page, (w, h) => {
    const tw = font.widthOfTextAtSize(text, o.size);
    const ascent = font.heightAtSize(o.size, { descender: false });
    const [x, y] = numberAt(o.position, [w, h], { w: tw, ascent }, o.margin);
    page.drawText(text, { x, y, size: o.size, font, color: hexToRgb(o.color) });
  });
}

// ===================== Marca d’água =====================

export interface WatermarkImage { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; w: number; h: number }

export interface WatermarkOptions {
  kind: 'text' | 'image';
  text: string;
  bold: boolean;
  color: string;           // #rrggbb
  image?: WatermarkImage;
  opacity: number;         // 0–1
  scale: number;           // 0,1–1: texto = fração da diagonal (ou da largura); imagem = fração da página
  diagonal: boolean;       // texto na diagonal da página (senão, horizontal)
  tile: boolean;           // repetida em mosaico (senão, uma no centro)
  under: boolean;          // atrás do conteúdo da página (senão, por cima)
}

export const WATERMARK_DEFAULTS: WatermarkOptions = {
  kind: 'text', text: tk('CONFIDENCIAL'), bold: true, color: '#c0392b', opacity: 0.25, scale: 0.7,
  diagonal: true, tile: false, under: false,
};

export interface Placement { x: number; y: number; angle: number }

/**
 * Posições (canto inferior esquerdo da caixa, já girada) de uma caixa w×h na página pw×ph, girada
 * `angle` graus no sentido anti-horário: uma no centro ou um mosaico que cobre a página.
 */
export function watermarkPlacements(page: [number, number], box: [number, number], angle: number, tile: boolean): Placement[] {
  const [pw, ph] = page;
  const [w, h] = box;
  const t = (angle * Math.PI) / 180;
  const u = [Math.cos(t), Math.sin(t)], v = [-Math.sin(t), Math.cos(t)];
  const corner = (cx: number, cy: number): Placement =>
    ({ x: cx - u[0] * w / 2 - v[0] * h / 2, y: cy - u[1] * w / 2 - v[1] * h / 2, angle });
  if (!tile) return [corner(pw / 2, ph / 2)];
  // Mosaico em linhas na direção do texto, com as linhas alternadas deslocadas meio passo
  const su = w * 1.35, sv = Math.max(h * 3.2, w * 0.45);
  const reach = Math.hypot(pw, ph);
  const out: Placement[] = [];
  const nu = Math.ceil(reach / su) + 1, nv = Math.ceil(reach / sv) + 1;
  for (let j = -nv; j <= nv; j++) {
    for (let i = -nu; i <= nu; i++) {
      const di = i * su + (j % 2 ? su / 2 : 0), dj = j * sv;
      const cx = pw / 2 + u[0] * di + v[0] * dj, cy = ph / 2 + u[1] * di + v[1] * dj;
      if (cx < -w / 2 || cx > pw + w / 2 || cy < -w / 2 || cy > ph + w / 2) continue;
      out.push(corner(cx, cy));
    }
  }
  return out;
}

export interface PreparedWatermark { font?: PDFFont; image?: PDFImage; text: string; replaced: number }

export async function prepareWatermark(doc: PDFDocument, o: WatermarkOptions): Promise<PreparedWatermark> {
  if (o.kind === 'image') {
    if (!o.image) throw new Error('Escolha uma imagem');
    const image = o.image.mime === 'image/png' ? await doc.embedPng(o.image.bytes) : await doc.embedJpg(o.image.bytes);
    return { image, text: '', replaced: 0 };
  }
  const font = await doc.embedFont(o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const { text, replaced } = encodable(font, o.text.replace(/\s+/g, ' ').trim());
  return { font, text, replaced };
}

export function drawWatermark(page: PDFPage, o: WatermarkOptions, prep: PreparedWatermark) {
  upright(page, (pw, ph) => {
    if (prep.image) {
      const img = prep.image;
      const k = Math.min((pw * o.scale) / img.width, (ph * o.scale) / img.height) * (o.tile ? 0.45 : 1);
      const w = img.width * k, h = img.height * k;
      for (const p of watermarkPlacements([pw, ph], [w, h], 0, o.tile)) {
        page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, opacity: o.opacity });
      }
      return;
    }
    const font = prep.font!;
    if (!prep.text) return;
    const angle = o.diagonal ? (Math.atan2(ph, pw) * 180) / Math.PI : 0;
    const run = o.diagonal ? Math.hypot(pw, ph) : pw;
    const unit = font.widthOfTextAtSize(prep.text, 1);
    // Tamanho: a fração escolhida do comprimento disponível (no mosaico, cada cópia é menor)
    const size = Math.max(6, Math.min(400, (run * o.scale * (o.tile ? 0.32 : 0.85)) / unit));
    const w = unit * size, h = font.heightAtSize(size, { descender: false });
    for (const p of watermarkPlacements([pw, ph], [w, h], angle, o.tile)) {
      page.drawText(prep.text, { x: p.x, y: p.y, size, font, color: hexToRgb(o.color), opacity: o.opacity, rotate: degrees(p.angle) });
    }
  });
  if (o.under) moveLastContentToBack(page);
}

/** Leva o fluxo de conteúdo desenhado agora (o último) para antes do conteúdo original da página. */
function moveLastContentToBack(page: PDFPage) {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray) || contents.size() < 2) return;
  const mine = (page as unknown as { contentStreamRef?: PDFRef }).contentStreamRef;
  for (let i = contents.size() - 1; i >= 0; i--) {
    if (contents.get(i) !== mine) continue;
    contents.remove(i);
    contents.insert(0, mine!);
    return;
  }
}

export async function addWatermark(doc: PDFDocument, o: WatermarkOptions, pages: number[] | null = null) {
  const prep = await prepareWatermark(doc, o);
  doc.getPages().forEach((page, i) => { if (selected(pages, i)) drawWatermark(page, o, prep); });
  return { replaced: prep.replaced };
}

// ===================== Prévia =====================

const ANNOTS = PDFName.of('Annots');

/**
 * Documento com uma cópia da página `index` (para a prévia). Os widgets perdem o /P, senão a cópia
 * levaria junto o arquivo inteiro.
 */
export async function singlePage(src: PDFDocument, index: number): Promise<PDFDocument> {
  const annots = src.getPage(index).node.lookupMaybe(ANNOTS, PDFArray);
  for (let i = 0; annots && i < annots.size(); i++) {
    const a = annots.lookup(i);
    if (a instanceof PDFDict) a.delete(PDFName.of('P'));
  }
  const doc = await PDFDocument.create({ updateMetadata: false });
  const [page] = await doc.copyPages(src, [index]);
  doc.addPage(page);
  return doc;
}
