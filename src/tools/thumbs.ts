// Miniaturas de páginas (pdf.js) para as ferramentas e para o “Organizar” do editor.
// Cada arquivo de origem é aberto uma vez; as páginas são desenhadas só quando aparecem na tela.
import { closePdf, openPdf, type PDFDocumentProxy } from '../pdf/pdfjs';
import { normRot } from '../editor/geom';
import { fmtNumber } from '../lib/i18n.svelte';

export class Thumbs {
  private docs: Array<{ doc: PDFDocumentProxy; owned: boolean }> = [];

  /** Abre um PDF (ou usa um já aberto, que não será fechado aqui). Devolve o índice da origem. */
  async add(source: Uint8Array | PDFDocumentProxy): Promise<number> {
    const owned = source instanceof Uint8Array;
    const doc = owned ? await openPdf(source) : source;
    this.docs.push({ doc, owned });
    return this.docs.length - 1;
  }

  private sizes = new Map<string, { width: number; height: number }>();

  pages(src: number) { return this.docs[src]?.doc.numPages ?? 0; }

  /** Tamanho da página como se vê (com o giro dela), em pt — conhecido depois que a miniatura é desenhada. */
  size(src: number, index: number) { return this.sizes.get(`${src}:${index}`); }

  /** Lê o tamanho de uma página (sem desenhar). */
  async measure(src: number, index: number) {
    const page = await this.docs[src].doc.getPage(index + 1);
    const vp = page.getViewport({ scale: 1 });
    const s = { width: vp.width, height: vp.height };
    this.sizes.set(`${src}:${index}`, s);
    return s;
  }

  /** Desenha a página no canvas com `width` px de largura (CSS), somando `rotate` ao giro da página. */
  async draw(canvas: HTMLCanvasElement, src: number, index: number, rotate = 0, width = 140) {
    const doc = this.docs[src]?.doc;
    if (!doc) return;
    const page = await doc.getPage(index + 1);
    const rotation = normRot(page.rotate + rotate);
    const natural = page.getViewport({ scale: 1 });
    this.sizes.set(`${src}:${index}`, { width: natural.width, height: natural.height });
    const base = page.getViewport({ scale: 1, rotation });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (width / base.width) * ratio, rotation });
    const off = document.createElement('canvas'); // desenha fora da tela e troca de uma vez (sem piscar)
    off.width = Math.floor(viewport.width);
    off.height = Math.floor(viewport.height);
    await page.render({ canvas: off, viewport }).promise;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.style.aspectRatio = `${off.width} / ${off.height}`;
    canvas.getContext('2d')!.drawImage(off, 0, 0);
  }

  async destroy() {
    const owned = this.docs.filter((d) => d.owned).map((d) => d.doc);
    this.docs = [];
    await Promise.all(owned.map((d) => closePdf(d)));
  }
}

/**
 * Ação Svelte: desenha a miniatura quando o canvas aparece na tela e de novo quando o giro muda.
 * Uso: <canvas use:thumb={{ thumbs, src, index, rotate }}>
 */
export function thumb(canvas: HTMLCanvasElement, p: { thumbs: Thumbs; src: number; index: number; rotate?: number; width?: number }) {
  let params = p;
  let drawnKey = '';
  let visible = false;
  const key = () => `${params.src}:${params.index}:${normRot(params.rotate ?? 0)}`;
  const draw = () => {
    if (!visible || drawnKey === key()) return;
    drawnKey = key();
    params.thumbs.draw(canvas, params.src, params.index, params.rotate ?? 0, params.width).catch(() => { drawnKey = ''; });
  };
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    draw();
  }, { rootMargin: '300px' });
  io.observe(canvas);
  return {
    update(next: typeof p) { params = next; draw(); },
    destroy() { io.disconnect(); },
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmtNumber(Math.round(bytes / 1024))} KB`;
  return `${fmtNumber(bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
