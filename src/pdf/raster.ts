// Páginas e imagens desenhadas no navegador (canvas): compressão “forte” (item 2.6), tarja (item 2.11)
// e o recodificador de imagens da compressão leve.
import { PDFDocument } from '@cantoo/pdf-lib';
import { closePdf, openPdf, type PDFDocumentProxy } from './pdfjs';
import type { Recoder } from './compress';
import type { VRect } from '../editor/geom';
import { Assembler } from './pages';
import type { PageSpec } from './plan';
import { clearInfo } from './meta';

const MAX_PIXELS = 16_000_000; // limite de canvas do Safari (iPhone)

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(async (b) => {
    if (!b) { reject(new Error('Falha ao gerar a imagem')); return; }
    resolve(new Uint8Array(await b.arrayBuffer()));
  }, mime, quality));
}

/** Libera a memória do canvas (importante no iPhone). */
const free = (c: HTMLCanvasElement) => { c.width = c.height = 0; };

export interface RenderedPage { canvas: HTMLCanvasElement; width: number; height: number; scale: number }

/**
 * Desenha a página `index` (0-based) como se vê (com o giro e as anotações e campos), em `dpi`, sobre
 * fundo branco. width/height = tamanho da página vista em pt; scale = pixels por pt.
 */
export async function renderPage(doc: PDFDocumentProxy, index: number, dpi: number): Promise<RenderedPage> {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport, intent: 'print' }).promise;
  page.cleanup();
  return { canvas, width: base.width, height: base.height, scale };
}

interface ImagePage { bytes: Uint8Array; width: number; height: number }

/** Coloca cada imagem numa página (doc novo, ou páginas em branco já existentes). */
async function drawImagePages(doc: PDFDocument, images: Array<ImagePage & { page?: number }>) {
  for (const img of images) {
    const jpg = await doc.embedJpg(img.bytes);
    const page = img.page !== undefined ? doc.getPage(img.page) : doc.addPage([img.width, img.height]);
    page.drawImage(jpg, { x: 0, y: 0, width: img.width, height: img.height });
  }
}

// ---------- Compressão forte ----------

export interface StrongOptions { dpi: number; quality: number; onProgress?: (done: number, total: number) => void }

/** Cada página vira uma imagem JPEG (o texto deixa de ser selecionável). */
export async function rasterizePdf(bytes: Uint8Array, o: StrongOptions): Promise<Uint8Array> {
  const src = await openPdf(bytes);
  try {
    const out = await PDFDocument.create({ updateMetadata: false });
    for (let i = 0; i < src.numPages; i++) {
      o.onProgress?.(i, src.numPages);
      const r = await renderPage(src, i, o.dpi);
      const jpg = await toBlob(r.canvas, 'image/jpeg', o.quality);
      free(r.canvas);
      await drawImagePages(out, [{ bytes: jpg, width: r.width, height: r.height }]);
    }
    o.onProgress?.(src.numPages, src.numPages);
    out.setProducer('Editor de PDF (no navegador)');
    return await out.save({ useObjectStreams: true });
  } finally {
    await closePdf(src);
  }
}

// ---------- Recodificador da compressão leve ----------

/** Recodifica imagens com o canvas do navegador (reduz e gera JPEG). */
export const canvasRecoder: Recoder = async (src, maxSide, quality) => {
  let source: CanvasImageSource;
  let bitmap: ImageBitmap | null = null;
  let full: HTMLCanvasElement | null = null;
  if (src.kind === 'jpeg') {
    try {
      bitmap = await createImageBitmap(new Blob([src.bytes as BlobPart], { type: 'image/jpeg' }));
    } catch {
      return null; // JPEG que o navegador não lê (CMYK estranho, corrompido…)
    }
    if (bitmap.width !== src.width || bitmap.height !== src.height) { bitmap.close(); return null; }
    source = bitmap;
  } else {
    full = document.createElement('canvas');
    full.width = src.width;
    full.height = src.height;
    full.getContext('2d')!.putImageData(new ImageData(src.rgba as ImageDataArray, src.width, src.height), 0, 0);
    source = full;
  }
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * k));
  canvas.height = Math.max(1, Math.round(src.height * k));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close();
  if (full) free(full);
  const bytes = await toBlob(canvas, 'image/jpeg', quality);
  const out = { bytes, width: canvas.width, height: canvas.height };
  free(canvas);
  return out;
};

// ---------- Tarja ----------

export interface RedactOptions {
  dpi: number;
  clearMetadata: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Tarja de verdade: cada página com tarja vira uma imagem com os retângulos pintados de preto, e o
 * conteúdo original dela (texto, anotações, campos) não vai para o arquivo novo. As outras páginas
 * são copiadas como estão. Retângulos em pt na página vista.
 */
export async function redactPdf(bytes: Uint8Array, rects: Map<number, VRect[]>, o: RedactOptions): Promise<Uint8Array> {
  const src = await openPdf(bytes);
  try {
    const marked = [...rects.entries()].filter(([, r]) => r.length).map(([i]) => i).sort((a, b) => a - b);
    const images: Array<ImagePage & { page: number }> = [];
    for (const [n, i] of marked.entries()) {
      o.onProgress?.(n, marked.length);
      const r = await renderPage(src, i, o.dpi);
      const ctx = r.canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      for (const v of rects.get(i)!) {
        // Arredonda para fora: nenhum pixel do que está embaixo escapa pela borda
        const x0 = Math.floor(v.x * r.scale), y0 = Math.floor(v.y * r.scale);
        const x1 = Math.ceil((v.x + v.w) * r.scale), y1 = Math.ceil((v.y + v.h) * r.scale);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      images.push({ bytes: await toBlob(r.canvas, 'image/jpeg', 0.9), width: r.width, height: r.height, page: i });
      free(r.canvas);
    }
    o.onProgress?.(marked.length, marked.length);

    // Montagem: páginas tarjadas entram em branco (sem nada do original) e recebem a imagem
    const asm = await Assembler.load([bytes]);
    const specs: PageSpec[] = Array.from({ length: src.numPages }, (_, index) => {
      const img = images.find((m) => m.page === index);
      return img ? { blank: true as const, width: img.width, height: img.height } : { src: 0, index };
    });
    const built = await asm.build(specs);
    const doc = await PDFDocument.load(built, { updateMetadata: false });
    await drawImagePages(doc, images);
    if (o.clearMetadata) clearInfo(doc);
    return await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  } finally {
    await closePdf(src);
  }
}
