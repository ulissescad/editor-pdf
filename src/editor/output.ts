// Saídas do PDF final: baixar, compartilhar (WhatsApp, e-mail…) e imprimir.
import { closePdf, openPdf } from '../pdf/pdfjs';

export function downloadPdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Compartilhamento nativo com arquivo (celulares e alguns navegadores de computador). */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/** Retorna false se a pessoa cancelou. */
export async function sharePdf(bytes: Uint8Array, name: string): Promise<boolean> {
  const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
  try {
    await navigator.share({ files: [file], title: name });
    return true;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return false;
    throw err;
  }
}

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
