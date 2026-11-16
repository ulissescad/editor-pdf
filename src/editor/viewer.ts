// Visualizador do pdf.js + conversões de coordenadas + gestos (pinça e Ctrl+roda).
import 'pdfjs-dist/web/pdf_viewer.css';
import { loadViewerComponents, pdfjsLib, type PDFDocumentProxy } from '../pdf/pdfjs';
import type { Obj } from './model';
import { A4, clampView, localSize, toView, turnOf, viewSize, type PageGeo } from './geom';

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
  /** Caixa da página no PDF e giro com que ela aparece (o /Rotate da página). */
  pageGeo(i: number): PageGeo {
    const pv = this.pageView(i);
    return pv?.pdfPage ? { view: pv.pdfPage.view, rotate: pv.viewport.rotation } : A4;
  }

  /** Ponto da página vista (pt, origem no canto superior esquerdo) → coordenadas dentro do container. */
  viewToContainer(i: number, vx: number, vy: number): [number, number] {
    const pv = this.pageView(i);
    if (!pv) return [0, 0];
    const s = pv.viewport.scale;
    return [this.viewerDiv.offsetLeft + pv.div.offsetLeft + pv.div.clientLeft + vx * s,
            this.viewerDiv.offsetTop + pv.div.offsetTop + pv.div.clientTop + vy * s];
  }

  /** Ponto da tela (clientX/Y) → ponto da página vista i. */
  clientToView(i: number, cx: number, cy: number): [number, number] {
    const pv = this.pageView(i);
    const r = pv.div.getBoundingClientRect();
    const s = pv.viewport.scale;
    return [(cx - r.left - pv.div.clientLeft) / s, (cy - r.top - pv.div.clientTop) / s];
  }

  /**
   * Onde desenhar o objeto: caixa na tela (left/top/width/height, já com o giro da página) e o conteúdo
   * sem giro (cw × ch) com o giro que ele aparenta na tela (turn, horário).
   */
  boxGeometry(o: Obj) {
    const s = this.scaleOf(o.page);
    const geo = this.pageGeo(o.page);
    const v = toView(o.rect, geo);
    const [left, top] = this.viewToContainer(o.page, v.x, v.y);
    const local = localSize(o.rect, o.rot);
    return { left, top, width: v.w * s, height: v.h * s, scale: s, turn: turnOf(o.rot, geo.rotate), cw: local.w * s, ch: local.h * s };
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
    const [x, y] = this.clientToView(page, cx, cy);
    const c = clampView({ x, y, w: 0, h: 0 }, viewSize(this.pageGeo(page)));
    return { page, x: c.x, y: c.y };
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
    let pinch: { dist: number; mid: [number, number] } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList): [number, number] => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

    c.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { dist: dist(e.touches), mid: mid(e.touches) }; }, { passive: true });
    c.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault(); // a pinça é do visualizador, não da página
      // Dois dedos também rolam (nas ferramentas de desenho, um dedo desenha e a rolagem nativa fica desligada)
      const m = mid(e.touches);
      c.scrollBy(pinch.mid[0] - m[0], pinch.mid[1] - m[1]);
      pinch.mid = m;
      const d = dist(e.touches);
      const factor = d / pinch.dist;
      if (Math.abs(factor - 1) < 0.02) return;
      const next = this.scale * factor;
      if (next < MIN_SCALE || next > MAX_SCALE) return;
      this.zoomBy(factor, m);
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
