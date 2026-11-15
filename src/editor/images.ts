// Imagens no navegador: carregar fotos e arquivos, reduzir, recodificar e preparar assinaturas.
// Tudo em canvas, no próprio aparelho.
import { newId, type ImageAsset } from './model';

const MAX_SIDE = 2400; // px: mais que isso só pesa no PDF e na memória do celular

export function canvasToBytes(canvas: HTMLCanvasElement, mime: ImageAsset['mime'], quality = 0.9): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(async (b) => {
    if (!b) { reject(new Error('Falha ao gerar a imagem')); return; }
    resolve(new Uint8Array(await b.arrayBuffer()));
  }, mime, quality));
}

export async function assetFromCanvas(canvas: HTMLCanvasElement, mime: ImageAsset['mime'], quality = 0.9): Promise<ImageAsset> {
  return { id: newId(), mime, bytes: await canvasToBytes(canvas, mime, quality), w: canvas.width, h: canvas.height };
}

/** Lê uma imagem do aparelho respeitando a orientação da foto (EXIF). */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** Desenha a imagem num canvas, reduzindo se for grande demais. */
export function drawScaled(img: CanvasImageSource & { width: number; height: number }, maxSide = MAX_SIDE): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * k));
  canvas.height = Math.max(1, Math.round(img.height * k));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function hasAlpha(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

/**
 * Imagem escolhida pela pessoa → asset pronto para o PDF.
 * Fotos viram JPEG (menores); imagens com transparência continuam PNG.
 */
export async function loadImageFile(file: Blob): Promise<ImageAsset> {
  const bmp = await decodeImage(file);
  const canvas = drawScaled(bmp);
  bmp.close();
  return hasAlpha(canvas) ? assetFromCanvas(canvas, 'image/png') : assetFromCanvas(canvas, 'image/jpeg', 0.88);
}

/** Recorta as bordas transparentes (com uma pequena margem). Devolve null se a imagem estiver vazia. */
export function trimTransparent(src: HTMLCanvasElement, margin = 4, minInk = 1): HTMLCanvasElement | null {
  const { width: w, height: h } = src;
  const { data } = src.getContext('2d')!.getImageData(0, 0, w, h);
  const rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) { rows[y]++; cols[x]++; }
    }
  }
  // Linhas/colunas com pouquíssima tinta (sujeira isolada da foto) não aumentam o recorte
  const first = (a: Uint32Array) => a.findIndex((v) => v >= minInk);
  const last = (a: Uint32Array) => a.length - 1 - [...a].reverse().findIndex((v) => v >= minInk);
  const y0 = first(rows), x0 = first(cols);
  if (y0 < 0 || x0 < 0) return null;
  const y1 = last(rows), x1 = last(cols);
  const left = Math.max(0, x0 - margin), top = Math.max(0, y0 - margin);
  const right = Math.min(w, x1 + 1 + margin), bottom = Math.min(h, y1 + 1 + margin);
  const out = document.createElement('canvas');
  out.width = right - left;
  out.height = bottom - top;
  out.getContext('2d')!.drawImage(src, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Limiar automático (método de Otsu) sobre o histograma de luminância. */
export function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

export type InkColor = 'original' | '#000000' | '#1a3cc8';

/**
 * Assinatura fotografada: o papel (claro) fica transparente e o traço (escuro) vira tinta.
 * `sensitivity` desloca o limiar automático (−60 a +60): maior = pega traços mais claros.
 */
export function removeBackground(src: HTMLCanvasElement, sensitivity: number, ink: InkColor): HTMLCanvasElement {
  const { width: w, height: h } = src;
  const ctx = src.getContext('2d')!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    lum[p] = l;
    hist[l]++;
  }
  const t = Math.min(250, Math.max(5, otsu(hist, lum.length) + sensitivity));
  const soft = 18; // transição suave na borda do traço
  const fixed = ink === 'original' ? null : [parseInt(ink.slice(1, 3), 16), parseInt(ink.slice(3, 5), 16), parseInt(ink.slice(5, 7), 16)];
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const res = octx.createImageData(w, h);
  const r = res.data;
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    const a = Math.max(0, Math.min(1, (t - lum[p]) / soft + 0.5));
    if (!a) continue;
    if (fixed) { r[i] = fixed[0]; r[i + 1] = fixed[1]; r[i + 2] = fixed[2]; }
    else { r[i] = d[i] * 0.6; r[i + 1] = d[i + 1] * 0.6; r[i + 2] = d[i + 2] * 0.6; } // escurece a tinta original
    r[i + 3] = Math.round(a * 255);
  }
  octx.putImageData(res, 0, 0);
  return out;
}
