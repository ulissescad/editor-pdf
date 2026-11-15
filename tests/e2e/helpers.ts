import type { Page, Request } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/generated/${name}`, import.meta.url));

/** Registra toda requisição feita pela página e todo erro de CSP no console. */
export function watchNetwork(page: Page) {
  const requests: string[] = [];
  const cspErrors: string[] = [];
  page.on('request', (r: Request) => requests.push(r.url()));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Content-Security-Policy/i.test(m.text())) cspErrors.push(m.text());
  });
  const external = () => requests.filter((u) => {
    if (/^(data|blob):/.test(u)) return false;
    try { return new URL(u).hostname !== 'localhost'; } catch { return true; }
  });
  return { requests, cspErrors, external };
}

/** Espera o editor terminar de abrir um documento. */
export async function waitForDoc(page: Page) {
  await page.locator('html[data-editor-ready="true"]').waitFor();
  await page.locator('.pdfViewer .page canvas').first().waitFor();
}

/** Abre um PDF pela página inicial (escolher arquivo → editor). */
export async function openFromHome(page: Page, file: string) {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Abrir PDF para editar' }).click();
  await (await chooser).setFiles(file.includes('/') || file.includes('\\') ? file : fixture(file));
  await page.waitForURL(/#\/editor$/);
  await waitForDoc(page);
}

/** Abre um PDF a partir do próprio editor (“Abrir PDF” na tela vazia ou “Abrir outro PDF”). */
export async function openInEditor(page: Page, file: string | { name: string; bytes: Uint8Array }) {
  await page.locator('.editor input[type="file"]').setInputFiles(typeof file === 'string'
    ? file
    : { name: file.name, mimeType: 'application/pdf', buffer: Buffer.from(file.bytes) });
  await waitForDoc(page);
}

/** Um ponto visível dentro da página n (0-based), em coordenadas da tela, na fração (fx, fy) da página. */
export async function pointOnPage(page: Page, fx: number, fy: number, n = 0) {
  const box = (await page.locator('.pdfViewer .page').nth(n).boundingBox())!;
  const vh = page.viewportSize()!.height;
  return { x: box.x + box.width * fx, y: Math.min(box.y + box.height * fy, vh - 140) };
}

export const isTouch = (page: Page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches);

/** Toque (celular) ou clique (computador) num ponto da tela. */
export async function tapAt(page: Page, x: number, y: number) {
  if (await isTouch(page)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Cria uma caixa de texto com a ferramenta Texto e digita. */
export async function addText(page: Page, text: string, fx = 0.2, fy = 0.4) {
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  const p = await pointOnPage(page, fx, fy);
  await tapAt(page, p.x, p.y);
  await page.locator('.tbox.editing .tcontent').waitFor();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Baixa o PDF pelo botão “Baixar” e devolve os bytes e o nome sugerido. */
export async function downloadPdf(page: Page): Promise<{ bytes: Uint8Array; name: string; path: string }> {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Baixar/ }).click();
  const download = await dl;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const path = (await download.path())!;
  return { bytes: new Uint8Array(Buffer.concat(chunks)), name: download.suggestedFilename(), path };
}

/** Texto extraído de uma página de um PDF (para conferir o que foi gravado). */
export async function pdfText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const tc = await (await pdf.getPage(pageNumber)).getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}
