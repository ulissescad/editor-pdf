// Estado do editor: documento aberto, objetos, seleção, ferramenta, histórico e rascunho automático.
import { History } from './history';
import {
  DEFAULT_STYLE, FIELD_SIZE, NOTE_SIZE, PAD, cloneObj, fieldMultiline, isEmpty, isFixed, makeField, makeImage, makeInk,
  makeMarkup, makeNote, makeShape, makeSymbol, makeText, minHeight, newId, today, uniqueName,
  type FieldObj, type FieldType, type ImageAsset, type InkObj, type MarkupType, type Obj, type ShapeType,
  type SymbolId, type TextStyle,
} from './model';
import {
  MARKER, MARKUP_DEFAULTS, NOTE_COLORS, WHITEOUT, isLineShape, packInk, packLine, shapeFamily, unionRect,
} from './draw';
import { canvasMeasure, textRuns, type Measure, type TextRun, type TextSelection } from './textsel';
import { SYMBOL_SIZE } from './symbols';
import { A4, clampView, fromView, localSize, normRot, toView, turnOf, viewSize, type PageGeo, type VRect } from './geom';
import type { PdfView, FindResult } from './viewer';
import { closePdf, countFields, formValues, onFormChange, openPdf, restoreFormValues, type PDFDocumentProxy } from '../pdf/pdfjs';
import { extractProject, projectFor, stampObjects, type StampInput } from '../pdf/write';
import { baselineFactor, cssFont, fontsReady, measureLines } from './measure';
import { deleteDraft, getDraft, saveDraft, sha256 } from '../storage/drafts';
import type { PageSpec } from '../pdf/plan';
import { bigFileNote } from './session';
import { t, tn } from '../lib/i18n.svelte';

export type Tool = 'select' | 'text' | 'stamp' | 'field' | 'markup' | 'ink' | 'shape' | 'note';
/** Ferramentas que desenham arrastando: no celular, um dedo desenha e dois dedos rolam. */
export const DRAW_TOOLS: Tool[] = ['markup', 'ink', 'shape'];
export type Stamp = SymbolId | 'date';
export type StatusKind = 'ok' | 'warn' | 'err' | 'info';

export class EditorState {
  // documento
  doc = $state.raw<PDFDocumentProxy | null>(null);
  fileName = $state('documento.pdf');
  pages = $state(0);
  fields = $state({ editable: 0, readOnly: 0 });
  xfa = $state(false);
  loading = $state(false);
  // objetos e interação
  objects = $state<Obj[]>([]);
  selectedId = $state<string | null>(null);
  editingId = $state<string | null>(null);
  tool = $state<Tool>('select');
  style = $state<TextStyle>({ ...DEFAULT_STYLE });
  stamp = $state<Stamp>('check');            // ferramenta Símbolos: o que um toque coloca
  symbolColor = $state('#000000');
  symbolSize = $state(SYMBOL_SIZE);
  fieldType = $state<FieldType>('text');     // ferramenta Campos: tipo do próximo campo
  markupType = $state<MarkupType>('highlight'); // ferramenta Destacar
  markupColors = $state<Record<MarkupType, string>>({ ...MARKUP_DEFAULTS });
  inkColor = $state('#1a3cc8');              // ferramenta Caneta
  inkWidth = $state(2.5);
  inkMarker = $state(false);                 // caneta marca-texto
  shapeType = $state<ShapeType>('rect');     // ferramenta Formas
  shapeColor = $state('#c62828');
  shapeWidth = $state(2);
  noteColor = $state(NOTE_COLORS[0]);        // ferramenta Nota
  // visualização
  scale = $state(1);
  currentPage = $state(1);
  layoutTick = $state(0);
  find = $state<FindResult>({ current: 0, total: 0, state: 'idle' });
  // situação
  status = $state<{ kind: StatusKind; text: string; action?: { label: string; run: () => void } } | null>(null);
  restoredAt = $state<number | null>(null); // rascunho restaurado (para o aviso)
  canUndo = $state(false);
  canRedo = $state(false);
  saving = $state<'idle' | 'pending' | 'saved' | 'error'>('idle');
  busy = $state<string | null>(null);      // operação demorada em andamento (texto para o usuário)

  view: PdfView | null = null;
  readonly contentEls = new Map<string, HTMLElement>(); // id → elemento de texto (para medir as linhas)
  #history = new History<Obj[]>([]);
  #hash = '';
  #base: Uint8Array | null = null;
  #clipboard: Obj | null = null;
  readonly images = new Map<string, ImageAsset>(); // imagens e assinaturas usadas nesta sessão
  #imageUrls = new Map<string, string>();
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #runs = new Map<number, Promise<TextRun[]>>(); // texto de cada página (para destacar)
  #measure: Measure | null = null;
  #lastInk: { id: string; at: number } | null = null; // traço anterior (para juntar a escrita num objeto)

  get selected(): Obj | undefined { return this.objects.find((o) => o.id === this.selectedId); }
  get hasDoc() { return !!this.doc; }

  /** Endereço local (blob:) da imagem, para mostrar na tela. */
  imageUrl(id: string): string {
    let url = this.#imageUrls.get(id);
    const asset = this.images.get(id);
    if (!url && asset) {
      url = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
      this.#imageUrls.set(id, url);
    }
    return url ?? '';
  }

  #setImages(assets: ImageAsset[]) {
    for (const url of this.#imageUrls.values()) URL.revokeObjectURL(url);
    this.#imageUrls.clear();
    this.images.clear();
    for (const a of assets) this.images.set(a.id, a);
  }

  // ================= abrir =================
  /** Menu do objeto selecionado (toque longo, clique direito ou tecla de menu), na posição da tela. */
  menu = $state<{ x: number; y: number } | null>(null);
  openMenu(id: string, x: number, y: number) { this.select(id); this.editingId = null; this.menu = { x, y }; }

  async openBytes(bytes: Uint8Array, name: string) {
    this.loading = true;
    this.status = null;
    try {
      const hash = await sha256(bytes);
      const draft = await getDraft(hash).catch(() => undefined);
      if (draft) {
        await this.#load(draft.bytes, draft.name, hash, draft.objects, draft.formValues, draft.images);
        this.restoredAt = draft.updatedAt;
        return;
      }
      const reopened = await extractProject(bytes).catch(() => null);
      if (reopened) {
        await this.#load(reopened.base, name, hash, reopened.project.objects, {}, reopened.assets);
        const n = reopened.project.objects.length;
        this.#toast('info', tn(n, 'PDF criado neste editor: {n} objeto continua editável.', 'PDF criado neste editor: {n} objetos continuam editáveis.'));
      } else {
        await this.#load(bytes, name, hash, [], {});
      }
      const big = bigFileNote(bytes.length);
      const shown = this.status as EditorState['status'];
      if (big && this.doc && (!shown || shown.kind === 'info')) this.status = { kind: 'warn', text: big };
    } catch (err) {
      console.error(err);
      const e = err as { name?: string };
      this.status = e?.name === 'PasswordException'
        ? {
          kind: 'err', text: t('Este PDF é protegido por senha.'),
          // Leva o arquivo para a ferramenta de desbloquear (sem sair da página)
          action: { label: t('Desbloquear'), run: () => { import('../tools/handoff').then((h) => h.sendToTool('desbloquear', [{ name, bytes }])); } },
        }
        : { kind: 'err', text: t('Não foi possível abrir este arquivo. Verifique se é um PDF válido.') };
    } finally {
      this.loading = false;
    }
  }

  async openDraft(hash: string) {
    this.loading = true;
    try {
      const draft = await getDraft(hash);
      if (!draft) { this.status = { kind: 'err', text: t('Rascunho não encontrado.') }; return; }
      await this.#load(draft.bytes, draft.name, hash, draft.objects, draft.formValues, draft.images);
      this.restoredAt = draft.updatedAt;
    } finally {
      this.loading = false;
    }
  }

  async #load(base: Uint8Array, name: string, hash: string, objects: Obj[], values: Record<string, unknown>, assets: ImageAsset[] = []) {
    const doc = await openPdf(base);
    if (Object.keys(values).length) restoreFormValues(doc, values);
    const old = this.doc;
    this.#hash = hash;
    this.#base = base;
    this.fileName = name;
    this.doc = doc;
    this.pages = doc.numPages;
    this.xfa = !!doc.isPureXfa;
    this.fields = doc.isPureXfa ? { editable: 0, readOnly: 0 } : await countFields(doc);
    this.#setImages(assets);
    this.#runs.clear();
    this.#lastInk = null;
    this.objects = objects.filter((o) => o.page < doc.numPages && (o.kind !== 'image' || this.images.has(o.imageId)));
    this.selectedId = this.editingId = null;
    this.tool = 'select';
    this.restoredAt = null;
    this.#history.reset(this.objects);
    this.#syncUndo();
    this.saving = 'idle';
    this.view?.setDocument(doc);
    onFormChange(doc, () => this.scheduleSave());
    await closePdf(old);
    if (!this.fields.editable && !this.objects.length && !this.xfa) {
      this.status = {
        kind: 'warn', text: t('Este PDF não tem campos de formulário. Use “Texto” para escrever ou detecte os campos automaticamente.'),
        action: { label: t('Detectar campos'), run: () => this.detectFields() },
      };
    }
  }

  async discardDraft() {
    if (!this.#hash) return;
    await deleteDraft(this.#hash).catch(() => {});
    this.restoredAt = null;
    if (!this.doc || !this.#base) return;
    await this.#load(this.#base, this.fileName, this.#hash, [], {}); // reabre do zero (sem objetos nem valores)
  }

  close() {
    this.flushSave();
    this.view?.setDocument(null);
    closePdf(this.doc);
    this.doc = null;
    this.objects = [];
    this.selectedId = this.editingId = null;
    this.pages = 0;
    this.#setImages([]);
  }

  // ================= objetos =================
  #toast(kind: StatusKind, text: string) { this.status = { kind, text }; }
  dismissStatus() { this.status = null; }

  /** Caixa e giro da página (geom.ts). */
  geo(page: number): PageGeo { return this.view?.pageGeo(page) ?? A4; }

  /** Retângulo da página vista → retângulo do PDF, dentro da página, e o giro para o objeto aparecer em pé. */
  #place(page: number, v: VRect) {
    const g = this.geo(page);
    return { rect: fromView(clampView(v, viewSize(g)), g), rot: normRot(g.rotate) || undefined };
  }

  /** Muda a caixa do objeto na página vista (mantendo dentro da página). */
  setViewRect(o: Obj, v: VRect) {
    const g = this.geo(o.page);
    o.rect = fromView(clampView(v, viewSize(g)), g);
  }

  /** Aumenta a altura do conteúdo (texto que cresce), para o lado de baixo do próprio conteúdo. */
  growTo(o: Obj, h: number) {
    const g = this.geo(o.page);
    const v = toView(o.rect, g);
    const d = h - localSize(o.rect, o.rot).h;
    if (d <= 0) return;
    const [pw, ph] = viewSize(g);
    switch (turnOf(o.rot, g.rotate)) {
      case 0: v.h = Math.min(v.h + d, ph - v.y); break;
      case 180: { const top = Math.max(0, v.y - d); v.h += v.y - top; v.y = top; break; }
      case 90: { const left = Math.max(0, v.x - d); v.w += v.x - left; v.x = left; break; }
      case 270: v.w = Math.min(v.w + d, pw - v.x); break;
    }
    o.rect = fromView(v, g);
  }

  /** Caixa de texto nova num retângulo da página vista. */
  addText(page: number, v: VRect): Obj {
    const { rect, rot } = this.#place(page, { ...v, h: Math.max(v.h, minHeight(this.style)) });
    const o = makeText(page, rect, this.style, '', rot);
    this.objects.push(o);
    this.selectedId = o.id;
    this.editingId = o.id;
    return o;
  }

  /** Onde colocar um objeto novo: no centro da parte visível da página atual (página vista). */
  visibleCenter() {
    return this.view?.visibleCenter() ?? { page: 0, x: 297, y: 421 };
  }

  #add(o: Obj, edit = false) {
    if (this.selectedId) this.select(null);
    this.objects.push(o);
    this.selectedId = o.id;
    this.editingId = edit ? o.id : null;
    if (!edit) this.commit();
    return o;
  }

  /** Imagem ou assinatura nova, no centro da tela, com até `maxW` pt de largura. */
  addImage(asset: ImageAsset, signature = false, maxW = signature ? 160 : 260) {
    this.images.set(asset.id, asset);
    const { page, x, y } = this.visibleCenter();
    const [pw] = viewSize(this.geo(page));
    const natural = asset.w * 0.75 / (signature ? 3 : 1); // px → pt (assinaturas são geradas em 3×)
    const w = Math.min(maxW, natural, pw * 0.8);
    const h = w * asset.h / asset.w;
    this.tool = 'select';
    const { rect, rot } = this.#place(page, { x: x - w / 2, y: y - h / 2, w, h });
    return this.#add(makeImage(page, rect, asset.id, signature, rot));
  }

  /** Ferramenta Símbolos: coloca o símbolo (ou a data de hoje) centrado no ponto tocado (página vista). */
  addStamp(page: number, x: number, y: number) {
    if (this.stamp === 'date') {
      const text = today();
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = cssFont(this.style, this.style.size);
      const w = Math.ceil(ctx.measureText(text).width) + 2 * PAD + 2;
      const h = minHeight(this.style);
      const { rect, rot } = this.#place(page, { x: x - PAD, y: y - h / 2, w, h });
      return this.#add(makeText(page, rect, this.style, text, rot));
    }
    const s = this.symbolSize;
    const { rect, rot } = this.#place(page, { x: x - s / 2, y: y - s / 2, w: s, h: s });
    return this.#add(makeSymbol(page, rect, this.stamp, this.symbolColor, rot));
  }

  #fieldNames() { return new Set(this.objects.filter((o): o is FieldObj => o.kind === 'field').map((o) => o.name)); }

  /** Ferramenta Campos: cria um campo (texto ou caixa de seleção) num retângulo da página vista. */
  addField(page: number, v: VRect, type = this.fieldType): Obj {
    const name = uniqueName(type === 'check' ? 'opcao' : 'campo', this.#fieldNames());
    const { rect, rot } = this.#place(page, v);
    return this.#add(makeField(page, rect, type, name, FIELD_SIZE, rot));
  }

  // ---------- anotações (M4) ----------
  /** Texto da página com a geometria de cada trecho (carregado uma vez por página). */
  textRuns(page: number): Promise<TextRun[]> {
    let p = this.#runs.get(page);
    if (!p) {
      const doc = this.doc;
      p = doc
        ? doc.getPage(page + 1).then((pg) => pg.getTextContent())
          .then((tc) => textRuns(tc.items as never[], tc.styles as never))
          .catch(() => [] as TextRun[])
        : Promise.resolve([]);
      this.#runs.set(page, p);
    }
    return p;
  }

  get measure(): Measure { return (this.#measure ??= canvasMeasure()); }

  /** Destacar/sublinhar/riscar: o texto selecionado ou, fora do texto, um retângulo (página vista). */
  addMarkup(page: number, sel: TextSelection | VRect): Obj | null {
    const type = this.markupType, color = this.markupColors[type];
    let o: Obj;
    if ('quads' in sel) {
      if (!sel.quads.length) return null;
      o = makeMarkup(page, unionRect(sel.quads), type, color, sel.quads, sel.text, sel.rot || undefined);
    } else {
      const { rect, rot } = this.#place(page, sel);
      if (rect.w < 2 || rect.h < 2) return null;
      o = makeMarkup(page, rect, type, color, [rect], '', rot);
    }
    this.objects.push(o);
    this.commit();
    return o;
  }

  /**
   * Caneta: um traço (pt na página vista). Traços seguidos (menos de 1,5 s entre eles), na mesma página e
   * com a mesma caneta, entram no mesmo objeto: uma palavra escrita vira um objeto só, e cada traço ainda
   * pode ser desfeito.
   */
  addInkStroke(page: number, points: number[]): Obj | null {
    if (points.length < 2) return null;
    const marker = this.inkMarker;
    const color = marker ? MARKER.color : this.inkColor;
    const width = marker ? MARKER.width : this.inkWidth;
    const opacity = marker ? MARKER.opacity : undefined;
    const g = this.geo(page);
    const rot = normRot(g.rotate) || undefined;
    const last = this.#lastInk;
    const prev = last && Date.now() - last.at < 1500
      ? this.objects.find((o): o is InkObj => o.id === last.id && o.kind === 'ink') : undefined;
    const strokes = [points];
    let target: InkObj | undefined;
    if (prev && prev.page === page && prev.color === color && prev.width === width && prev.opacity === opacity
      && (prev.rot ?? 0) === (rot ?? 0)) {
      // O objeto aparece em pé (giro igual ao da página): o quadro dele é o da página vista
      const v = toView(prev.rect, g);
      for (const p of prev.paths) strokes.unshift(p.map((n, i) => (i % 2 ? v.y + n * v.h : v.x + n * v.w)));
      target = prev;
    }
    const { box, paths } = packInk(strokes, width);
    const rect = fromView(box, g);
    let o: InkObj;
    if (target) {
      target.rect = rect;
      target.paths = paths;
      o = target;
    } else {
      o = makeInk(page, rect, paths, color, width, opacity, rot);
      this.objects.push(o);
    }
    this.#lastInk = { id: o.id, at: Date.now() };
    this.commit();
    return o;
  }

  /** Formas: retângulo/elipse/corretivo na caixa de a até b; linha/seta de a até b (pt na página vista). */
  addShape(page: number, a: [number, number], b: [number, number]): Obj | null {
    const shape = this.shapeType;
    const g = this.geo(page);
    const rot = normRot(g.rotate) || undefined;
    const color = shape === 'whiteout' ? WHITEOUT : this.shapeColor;
    let o: Obj;
    if (isLineShape(shape)) {
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) return null;
      const { box, ends } = packLine(a, b, this.shapeWidth, shape === 'arrow');
      o = makeShape(page, fromView(box, g), shape, color, this.shapeWidth, ends, rot);
    } else {
      const v = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
      if (v.w < 4 || v.h < 4) return null;
      o = makeShape(page, this.#place(page, v).rect, shape, color, this.shapeWidth, undefined, rot);
    }
    this.objects.push(o);
    this.commit();
    return o;
  }

  /** Nota: ícone centrado no ponto tocado (página vista), já aberto para escrever. */
  addNote(page: number, x: number, y: number): Obj {
    const s = NOTE_SIZE;
    const { rect, rot } = this.#place(page, { x: x - s / 2, y: y - s / 2, w: s, h: s });
    return this.#add(makeNote(page, rect, this.noteColor, '', rot), true);
  }

  /** Destacar: troca o tipo ou a cor (o padrão e o selecionado). */
  setMarkup(patch: { type?: MarkupType; color?: string }) {
    const s = this.selected;
    if (patch.type) this.markupType = patch.type;
    const type = patch.type ?? (s?.kind === 'markup' ? s.type : this.markupType);
    if (patch.color) this.markupColors = { ...this.markupColors, [type]: patch.color };
    if (s?.kind !== 'markup') return;
    if (patch.type && patch.type !== s.type) { s.type = patch.type; s.color = this.markupColors[patch.type]; }
    if (patch.color) s.color = patch.color;
    this.commit();
  }

  /** Caneta: cor, espessura ou marca-texto (o padrão e o selecionado). */
  setInk(patch: { color?: string; width?: number; marker?: boolean }) {
    if (patch.marker !== undefined) this.inkMarker = patch.marker;
    else if (patch.color || patch.width) this.inkMarker = false; // escolher cor ou espessura volta à caneta comum
    if (patch.color) this.inkColor = patch.color;
    if (patch.width) this.inkWidth = patch.width;
    this.#lastInk = null;
    const s = this.selected;
    if (s?.kind !== 'ink') return;
    if (patch.color) s.color = patch.color;
    if (patch.width) s.width = patch.width;
    this.commit();
  }

  /** Formas: tipo, cor ou espessura (o padrão e o selecionado; o tipo só muda dentro da mesma família). */
  setShape(patch: { shape?: ShapeType; color?: string; width?: number }) {
    if (patch.shape) this.shapeType = patch.shape;
    if (patch.color) this.shapeColor = patch.color;
    if (patch.width) this.shapeWidth = patch.width;
    const s = this.selected;
    if (s?.kind !== 'shape') return;
    if (patch.shape && shapeFamily(s.shape).includes(patch.shape)) {
      s.shape = patch.shape;
      if (patch.shape === 'whiteout') s.color = WHITEOUT;
      else if (s.color === WHITEOUT) s.color = this.shapeColor;
    }
    if (patch.color && s.shape !== 'whiteout') s.color = patch.color;
    if (patch.width) s.width = patch.width;
    this.commit();
  }

  /** Nota: cor (a padrão e a da selecionada). */
  setNote(patch: { color?: string }) {
    if (patch.color) this.noteColor = patch.color;
    const s = this.selected;
    if (s?.kind === 'note' && patch.color) { s.color = patch.color; this.commit(); }
  }

  /** Detecta campos nas páginas (PDF sem formulário) e cria os campos sugeridos. */
  async detectFields() {
    if (!this.doc) return;
    this.busy = t('Procurando campos…');
    try {
      const { detectInDocument } = await import('./detect');
      const found = await detectInDocument(this.doc, $state.snapshot(this.objects) as Obj[]);
      if (this.selectedId) this.select(null);
      const taken = this.#fieldNames();
      for (const f of found) {
        const rot = normRot(this.geo(f.page).rotate) || undefined;
        this.objects.push(makeField(f.page, f.rect, f.type, uniqueName(f.name, taken), f.size ?? FIELD_SIZE, rot));
      }
      this.commit();
      this.tool = 'field';
      this.status = found.length
        ? { kind: 'ok', text: `${tn(found.length, '{n} campo encontrado.', '{n} campos encontrados.')} ${t('Toque num campo para preencher e exclua os que não servirem. No PDF baixado eles continuam preenchíveis.')}` }
        : { kind: 'info', text: t('Nenhum campo encontrado. Com a ferramenta Campos, toque onde quer criar um.') };
    } catch (err) {
      console.error(err);
      this.status = { kind: 'err', text: t('Não foi possível detectar os campos deste PDF.') };
    } finally {
      this.busy = null;
    }
  }

  select(id: string | null) {
    if (this.selectedId === id) return;
    const prev = this.selected;
    this.editingId = null;
    this.selectedId = id;
    if (prev && isEmpty(prev)) {
      this.objects = this.objects.filter((o) => o.id !== prev.id); // caixa vazia some ao perder a seleção
    }
    const cur = this.selected;
    if (cur?.kind === 'text') this.style = { ...cur.style };
    if (cur?.kind === 'symbol') { this.stamp = cur.symbol; this.symbolColor = cur.color; }
    if (cur?.kind === 'field') this.fieldType = cur.type;
    if (cur?.kind === 'markup') this.markupType = cur.type;
    if (cur?.kind === 'ink') {
      this.inkMarker = (cur.opacity ?? 1) < 1;
      if (!this.inkMarker) { this.inkColor = cur.color; this.inkWidth = cur.width; }
    }
    if (cur?.kind === 'shape') {
      this.shapeType = cur.shape;
      this.shapeWidth = cur.width;
      if (cur.shape !== 'whiteout') this.shapeColor = cur.color;
    }
    if (cur?.kind === 'note') this.noteColor = cur.color;
    this.commit();
  }

  startEditing(id: string) { this.selectedId = id; this.editingId = id; }
  stopEditing() { this.editingId = null; this.commit(); }

  remove(id = this.selectedId) {
    if (!id) return;
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.selectedId === id) this.selectedId = this.editingId = null;
    this.commit();
  }

  duplicate(id = this.selectedId) {
    const src = this.objects.find((o) => o.id === id);
    if (!src || isFixed(src)) return; // marcações ficam presas ao texto
    this.#paste(src);
  }

  /** Traz para a frente (desenhado por último) ou manda para trás. */
  reorder(where: 'front' | 'back', id = this.selectedId) {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i < 0) return;
    const [o] = this.objects.splice(i, 1);
    if (where === 'front') this.objects.push(o); else this.objects.unshift(o);
    this.commit();
  }

  copy() { const s = this.selected; if (s && !isFixed(s)) this.#clipboard = cloneObj($state.snapshot(s) as Obj); }
  paste() { if (this.#clipboard) this.#paste(this.#clipboard); }

  #paste(src: Obj) {
    const o = cloneObj($state.snapshot(src) as Obj);
    o.id = newId();
    o.page = Math.min(o.page, this.pages - 1);
    const v = toView(o.rect, this.geo(o.page));
    this.setViewRect(o, { ...v, x: v.x + 12, y: v.y + 12 });
    if (o.kind === 'field') o.name = uniqueName(o.name, this.#fieldNames());
    this.objects.push(o);
    this.selectedId = o.id;
    this.editingId = null;
    this.commit();
  }

  /** Muda o estilo padrão e o do texto selecionado. */
  setStyle(patch: Partial<TextStyle>) {
    this.style = { ...this.style, ...patch };
    const s = this.selected;
    if (s?.kind === 'text') {
      Object.assign(s.style, patch);
      this.growTo(s, minHeight(s.style));
      this.commit();
    }
  }

  /** Símbolo: troca o desenho ou a cor (o padrão e o selecionado). */
  setSymbol(patch: { symbol?: SymbolId; color?: string }) {
    if (patch.symbol) this.stamp = patch.symbol;
    if (patch.color) this.symbolColor = patch.color;
    const s = this.selected;
    if (s?.kind === 'symbol') { Object.assign(s, patch); this.commit(); }
  }

  /** Campo: altera tipo, nome, tamanho da fonte, várias linhas ou valor. */
  setField(patch: Partial<Pick<FieldObj, 'type' | 'name' | 'size' | 'multiline' | 'value'>>) {
    if (patch.type) this.fieldType = patch.type;
    const s = this.selected;
    if (s?.kind !== 'field') return;
    if (patch.name !== undefined) {
      const others = this.#fieldNames();
      others.delete(s.name);
      patch.name = uniqueName(patch.name.trim().replace(/\./g, '_') || 'campo', others);
    }
    if (patch.type && patch.type !== s.type) {
      patch.value = '';
      patch.multiline = patch.type === 'text' && fieldMultiline(localSize(s.rect, s.rot).h, s.size);
    }
    Object.assign(s, patch);
    this.commit();
  }

  /** Move o selecionado (pt na página vista; dy > 0 = para baixo). */
  nudge(dx: number, dy: number) {
    const s = this.selected;
    if (!s || isFixed(s)) return;
    const v = toView(s.rect, this.geo(s.page));
    this.setViewRect(s, { ...v, x: v.x + dx, y: v.y + dy });
    this.commit();
  }

  // ================= histórico =================
  commit() {
    if (this.#history.push($state.snapshot(this.objects) as Obj[])) this.scheduleSave();
    this.#syncUndo();
  }
  undo() { this.#restore(this.#history.undo()); }
  redo() { this.#restore(this.#history.redo()); }
  #restore(snapshot: Obj[] | null) {
    if (!snapshot) return;
    this.objects = snapshot;
    if (!this.objects.some((o) => o.id === this.selectedId)) this.selectedId = null;
    this.editingId = null;
    this.#syncUndo();
    this.scheduleSave();
  }
  #syncUndo() { this.canUndo = this.#history.canUndo; this.canRedo = this.#history.canRedo; }

  /** Imagens usadas pelos objetos atuais (o que vai para o rascunho). */
  #usedImages(): ImageAsset[] {
    const ids = new Set(this.objects.flatMap((o) => (o.kind === 'image' ? [o.imageId] : [])));
    return [...ids].flatMap((id) => (this.images.has(id) ? [this.images.get(id)!] : []));
  }

  // ================= rascunho automático =================
  scheduleSave() {
    if (!this.doc) return;
    this.saving = 'pending';
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.flushSave(), 800);
  }

  async flushSave() {
    if (this.#saveTimer) { clearTimeout(this.#saveTimer); this.#saveTimer = null; }
    if (!this.doc || !this.#base || this.saving !== 'pending') return;
    try {
      await saveDraft({
        hash: this.#hash, name: this.fileName, bytes: this.#base, pages: this.pages,
        objects: $state.snapshot(this.objects) as Obj[], formValues: formValues(this.doc), updatedAt: Date.now(),
        images: this.#usedImages(),
      });
      this.saving = 'saved';
    } catch (err) {
      console.warn('Rascunho não salvo', err);
      this.saving = 'error';
    }
  }

  // ================= páginas =================
  /**
   * Reorganiza as páginas do documento aberto (ordem, giro, exclusão, duplicação, páginas em branco).
   * Os valores dos formulários entram no PDF base, e os objetos acompanham as páginas.
   * O aviso oferece “Desfazer” (volta ao documento anterior).
   */
  async applyPages(specs: PageSpec[]) {
    if (!this.doc || !this.#base) return;
    if (this.editingId) this.stopEditing();
    if (this.selectedId) this.select(null);
    this.busy = t('Reorganizando as páginas…');
    const prev = {
      base: this.#base, objects: $state.snapshot(this.objects) as Obj[], values: formValues(this.doc), images: this.#usedImages(),
    };
    try {
      const filled = await this.doc.saveDocument();
      const [{ assemble }, { remapObjects }] = await Promise.all([import('../pdf/pages'), import('../pdf/plan')]);
      const bytes = await assemble([filled], specs);
      await this.#load(bytes, this.fileName, this.#hash, remapObjects([prev.objects], specs), {}, prev.images);
      this.saving = 'pending';
      await this.flushSave();
      this.status = {
        kind: 'ok', text: tn(this.pages, 'Páginas reorganizadas: agora é {n} página.', 'Páginas reorganizadas: agora são {n} páginas.'),
        action: { label: t('Desfazer'), run: () => this.#restorePages(prev) },
      };
    } catch (err) {
      console.error(err);
      this.status = { kind: 'err', text: t('Não foi possível reorganizar as páginas deste PDF.') };
    } finally {
      this.busy = null;
    }
  }

  async #restorePages(prev: { base: Uint8Array; objects: Obj[]; values: Record<string, unknown>; images: ImageAsset[] }) {
    this.busy = t('Desfazendo…');
    try {
      await this.#load(prev.base, this.fileName, this.#hash, prev.objects, prev.values, prev.images);
      this.saving = 'pending';
      await this.flushSave();
      this.status = { kind: 'info', text: t('As páginas voltaram como estavam.') };
    } finally {
      this.busy = null;
    }
  }

  // ================= gerar o PDF =================
  async buildPdf(): Promise<Uint8Array> {
    if (!this.doc) throw new Error('Nenhum documento aberto');
    if (this.editingId) this.stopEditing();
    const live = this.objects.filter((o) => !isEmpty(o));
    await fontsReady(live.flatMap((o) => (o.kind === 'text' ? [o.style] : [])));
    const items: StampInput[] = live.map((o) => {
      const obj = $state.snapshot(o) as Obj;
      if (obj.kind !== 'text') return { obj };
      const el = this.contentEls.get(obj.id);
      const scale = this.view?.scaleOf(obj.page) ?? 1;
      const lines = el ? measureLines(el, obj.style, scale) : obj.text.split('\n').map((text, index) => ({ index, text }));
      return { obj, lines, baseline: baselineFactor(obj.style) };
    });
    const withFields = await this.doc.saveDocument();
    const project = projectFor(items.map((i) => i.obj), this.images);
    const { loadFontFile } = await import('./fonts');
    const { bytes, replaced } = await stampObjects(withFields, items, project, { assets: this.images, loadFont: loadFontFile });
    if (replaced) this.#toast('warn', tn(replaced, '{n} caractere não existe nas fontes do PDF e foi trocado por “?”.', '{n} caracteres não existem nas fontes do PDF e foram trocados por “?”.'));
    return bytes;
  }

  get outputName() {
    const suffix = t('editado');
    const base = this.fileName.replace(/\.pdf$/i, '');
    return (base.endsWith(`-${suffix}`) ? base.slice(0, -suffix.length - 1) : base.replace(/-editado$/i, '')) + `-${suffix}.pdf`;
  }
}

export { PAD };
