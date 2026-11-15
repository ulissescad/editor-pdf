// Visualizador do pdf.js + conversões de coordenadas + gestos (pinça e Ctrl+roda).
import 'pdfjs-dist/web/pdf_viewer.css';
import { loadViewerComponents, pdfjsLib, type PDFDocumentProxy } from '../pdf/pdfjs';
import type { Obj } from './model';

type Components = Awaited<ReturnType<typeof loadViewerComponents>>;
type Viewer = InstanceType<Components['PDFViewer']>;

export interface FindResult { current: number; total: number; state: 'found' | 'notfound' | 'wrapped' | 'pending' | 'idle' }

export interface ViewCallbacks {
  onLayout(): void;                 // geometria das páginas mudou (zoom, render, resize)
  onScale(scale: number): void;
  onPage(page: number): void;       // 1-based
  onPagesInit(): void;
  onFind(r: Partial<FindResult>): void;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;

export class PdfView {
  private constructor(
    readonly container: HTMLDivElement,
    readonly viewerDiv: HTMLDivElement,
    private viewer: Viewer,
    private eventBus: InstanceType<Components['EventBus']>,
    private linkService: InstanceType<Components['PDFLinkService']>,
    private findController: InstanceType<Components['PDFFindController']>,
    private cb: ViewCallbacks,
  ) {}

  static async create(container: HTMLDivElement, viewerDiv: HTMLDivElement, cb: ViewCallbacks): Promise<PdfView> {
    const { PDFViewer, EventBus, PDFLinkService, PDFFindController } = await loadViewerComponents();
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
      container,
      viewer: viewerDiv,
      eventBus,
      linkService,
      findController,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
      removePageBorders: true,
    });
    linkService.setViewer(viewer);
    const view = new PdfView(container, viewerDiv, viewer, eventBus, linkService, findController, cb);
    view.wire();
    return view;
  }

  private wire() {
    const { eventBus, cb } = this;
    const layout = () => requestAnimationFrame(() => cb.onLayout());
    eventBus.on('pagesinit', () => { this.viewer.currentScaleValue = 'page-width'; cb.onPagesInit(); layout(); });
    eventBus.on('scalechanging', (e: { scale: number }) => { cb.onScale(e.scale); layout(); });
    eventBus.on('pagerendered', layout);
    eventBus.on('pagechanging', (e: { pageNumber: number }) => cb.onPage(e.pageNumber));
    eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) =>
      cb.onFind({ current: e.matchesCount.current, total: e.matchesCount.total }));
    eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount: { current: number; total: number } }) => {
      const states = ['found', 'notfound', 'wrapped', 'pending'] as const;
      cb.onFind({ state: states[e.state] ?? 'idle', current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0 });
    });
    // O container muda de tamanho com a janela e também quando painéis laterais abrem ou fecham
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);
    this.attachGestures();
  }

  private resizeObserver: ResizeObserver | null = null;
  private onResize = () => {
    if (!this.viewer.pdfDocument) return;
    if (this.viewer.currentScaleValue === 'page-width') this.viewer.currentScaleValue = 'page-width';
    requestAnimationFrame(() => this.cb.onLayout());
  };

  setDocument(doc: PDFDocumentProxy | null) {
    this.viewer.setDocument(doc as PDFDocumentProxy);
    this.linkService.setDocument(doc, null);
    this.findController.setDocument(doc as PDFDocumentProxy);
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.setDocument(null);
  }

  // ---------- geometria ----------
  get pagesCount() { return this.viewer.pagesCount; }
  private pageView(i: number) { return this.viewer.getPageView(i); }
  scaleOf(i: number): number { return this.pageView(i)?.viewport.scale ?? 1; }
  pageBounds(i: number): number[] { return this.pageView(i)?.pdfPage?.view ?? [0, 0, 595, 842]; }

  /** Ponto do PDF → coordenadas dentro do container (onde fica a camada de objetos). */
  toContainer(i: number, x: number, y: number): [number, number] {
    const pv = this.pageView(i);
    if (!pv) return [0, 0];
    const [vx, vy] = pv.viewport.convertToViewportPoint(x, y);
    return [this.viewerDiv.offsetLeft + pv.div.offsetLeft + pv.div.clientLeft + vx,
            this.viewerDiv.offsetTop + pv.div.offsetTop + pv.div.clientTop + vy];
  }

  /** Ponto da tela (clientX/Y) → ponto do PDF na página i. */
  clientToPdf(i: number, cx: number, cy: number): [number, number] {
    const pv = this.pageView(i);
    const r = pv.div.getBoundingClientRect();
    const [x, y] = pv.viewport.convertToPdfPoint(cx - r.left - pv.div.clientLeft, cy - r.top - pv.div.clientTop);
    return [x, y];
  }

  boxGeometry(o: Obj) {
    const s = this.scaleOf(o.page);
    const [left, top] = this.toContainer(o.page, o.rect.x, o.rect.y);
    return { left, top, width: o.rect.w * s, height: o.rect.h * s, scale: s };
  }

  /** Centro da área visível, convertido para a página que está ali (para colocar objetos novos). */
  visibleCenter(): { page: number; x: number; y: number } {
    const r = this.container.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let page = Math.max(0, this.viewer.currentPageNumber - 1);
    for (let i = 0; i < this.pagesCount; i++) {
      const d = this.pageView(i)?.div.getBoundingClientRect();
      if (d && cy >= d.top && cy <= d.bottom) { page = i; break; }
    }
    const [x0, y0, x1, y1] = this.pageBounds(page);
    const [x, y] = this.clientToPdf(page, cx, cy);
    return { page, x: Math.min(Math.max(x, x0), x1), y: Math.min(Math.max(y, y0), y1) };
  }

  // ---------- navegação e zoom ----------
  get scale() { return this.viewer.currentScale; }
  zoomBy(factor: number, origin?: [number, number]) {
    this.viewer.updateScale({ scaleFactor: factor, origin, drawingDelay: origin ? 300 : 0 });
  }
  fitWidth() { this.viewer.currentScaleValue = 'page-width'; }
  get currentPage() { return this.viewer.currentPageNumber; }
  goToPage(n: number) { this.viewer.currentPageNumber = Math.min(Math.max(1, n), this.pagesCount); }
  /** Rola até deixar o retângulo do objeto visível. */
  scrollToObject(o: Obj) {
    const g = this.boxGeometry(o);
    const c = this.container;
    if (g.top < c.scrollTop || g.top + g.height > c.scrollTop + c.clientHeight) c.scrollTo({ top: g.top - c.clientHeight / 3 });
  }

  // ---------- busca ----------
  find(query: string, opts: { again?: boolean; previous?: boolean } = {}) {
    this.eventBus.dispatch('find', {
      source: this, type: opts.again ? 'again' : '', query,
      caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: !!opts.previous, matchDiacritics: false,
    });
  }
  closeFind() { this.eventBus.dispatch('findbarclose', { source: this }); }

  // ---------- gestos ----------
  private attachGestures() {
    const c = this.container;
    let pinch: { dist: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList): [number, number] => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

    c.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { dist: dist(e.touches) }; }, { passive: true });
    c.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault(); // a pinça é do visualizador, não da página
      const d = dist(e.touches);
      const factor = d / pinch.dist;
      if (Math.abs(factor - 1) < 0.02) return;
      const next = this.scale * factor;
      if (next < MIN_SCALE || next > MAX_SCALE) return;
      this.zoomBy(factor, mid(e.touches));
      pinch.dist = d;
    }, { passive: false });
    const end = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);

    // Ctrl + roda do mouse (e pinça no trackpad, que o navegador entrega como Ctrl+roda)
    c.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY / 300);
      const next = this.scale * factor;
      if (next >= MIN_SCALE && next <= MAX_SCALE) this.zoomBy(factor, [e.clientX, e.clientY]);
    }, { passive: false });
  }
}
