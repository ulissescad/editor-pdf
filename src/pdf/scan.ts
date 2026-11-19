// Digitalizar: a parte que usa o canvas do navegador (a matemática está em perspective.ts).
import type { ImageAsset } from '../editor/model';
import { assetFromCanvas, drawScaled } from '../editor/images';
import {
  applyFilter, rotateRaster, scanSize, warpPerspective,
  type PageFormat, type Pt, type Quad, type Raster, type ScanFilter, type Turn,
} from './perspective';

export interface ScanSettings { quad: Quad; filter: ScanFilter; turn: Turn; format: PageFormat }
export interface ScanOutput { canvas: HTMLCanvasElement; page: Pt }

export async function decodeAsset(a: ImageAsset): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(new Blob([a.bytes as BlobPart], { type: a.mime }));
  const canvas = drawScaled(bmp, Math.max(bmp.width, bmp.height));
  bmp.close();
  return canvas;
}

const rasterOf = (c: HTMLCanvasElement): Raster => {
  const { data, width, height } = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { data, width, height };
};

function canvasOf(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  c.getContext('2d')!.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
  return c;
}

/** Endireita, filtra e gira. `maxSide` menor serve para a prévia, que precisa ser instantânea. */
export function renderScan(source: HTMLCanvasElement, s: ScanSettings, maxSide = 2400): ScanOutput {
  const size = scanSize(s.quad, source.width, source.height, s.format, maxSide);
  const flat = warpPerspective(rasterOf(source), s.quad, size.width, size.height);
  const done = rotateRaster(applyFilter(flat, s.filter), s.turn);
  return { canvas: canvasOf(done), page: s.turn % 2 ? [size.page[1], size.page[0]] : size.page };
}

/** Imagem final da página, já em JPEG. */
export async function scanAsset(source: HTMLCanvasElement, s: ScanSettings): Promise<{ asset: ImageAsset; page: Pt }> {
  const { canvas, page } = renderScan(source, s);
  return { asset: await assetFromCanvas(canvas, 'image/jpeg', s.filter === 'color' ? 0.85 : 0.8), page };
}
