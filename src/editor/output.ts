// Saídas do PDF final: baixar, compartilhar (WhatsApp, e-mail…) e imprimir.
import { closePdf, openPdf } from '../pdf/pdfjs';

/** Baixa bytes como arquivo (PDF, imagem, ZIP…). */
export function downloadBytes(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const downloadPdf = (bytes: Uint8Array, name: string) => downloadBytes(bytes, name, 'application/pdf');

/** Compartilhamento nativo com arquivo (celulares e alguns navegadores de computador). */
export function canShareFiles(files?: File[]): boolean {
  try {
    const probe = files ?? [new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })];
    return !!navigator.canShare?.({ files: probe });
  } catch {
    return false;
  }
}

/** Retorna false se a pessoa cancelou. */
export async function shareFiles(files: File[], title?: string): Promise<boolean> {
  try {
    await navigator.share({ files, title: title ?? files[0]?.name });
    return true;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return false;
    throw err;
  }
}

export const sharePdf = (bytes: Uint8Array, name: string) =>
  shareFiles([new File([bytes as BlobPart], name, { type: 'application/pdf' })], name);

/**
 * Impressão: as páginas do PDF final são desenhadas como imagens (150 ppp) numa área só de impressão
 * e o navegador imprime a página. Funciona igual em computador, Android e iPhone, sem depender de
 * visualizador de PDF embutido.
 */
let cleanupPrint: (() => void) | null = null;

export async function printPdf(bytes: Uint8Array, onProgress?: (done: number, total: number) => void) {
  cleanupPrint?.();
  const doc = await openPdf(bytes);
  const root = document.createElement('div');
  root.id = 'print-root';
  const urls: string[] = [];
  // A área de impressão só é removida depois que a impressão termina (no celular, print() não bloqueia)
  cleanupPrint = () => {
    root.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    window.removeEventListener('afterprint', onAfter);
    cleanupPrint = null;
  };
  const onAfter = () => setTimeout(() => cleanupPrint?.(), 500);
  try {
    const dpi = doc.numPages > 60 ? 100 : 150;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/jpeg', 0.92));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      root.appendChild(img);
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    document.body.appendChild(root);
    await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
    window.addEventListener('afterprint', onAfter);
    window.print();
  } catch (err) {
    cleanupPrint?.();
    throw err;
  } finally {
    await closePdf(doc);
  }
}

/** Remove a área de impressão (ao sair do editor). */
export const disposePrint = () => cleanupPrint?.();
