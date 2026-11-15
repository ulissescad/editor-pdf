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

/** Abre um PDF pela página inicial (escolher arquivo → editor). */
export async function openFromHome(page: Page, name: string) {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Abrir PDF para editar' }).click();
  await (await chooser).setFiles(fixture(name));
  await page.waitForURL(/editor\.html/);
  await page.locator('html[data-ready="true"]').waitFor();
  await page.locator('.pdfViewer .page canvas').first().waitFor();
}

/** Lê um download como bytes. */
export async function readDownload(download: import('@playwright/test').Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}
