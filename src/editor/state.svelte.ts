// Estado do editor: documento aberto, objetos, seleção, ferramenta, histórico e rascunho automático.
import { History } from './history';
import {
  DEFAULT_STYLE, FIELD_SIZE, PAD, clampRect, cloneObj, fieldMultiline, isEmpty, makeField, makeImage, makeSymbol, makeText,
  minHeight, newId, rectAround, today, uniqueName,
  type FieldObj, type FieldType, type ImageAsset, type Obj, type Rect, type SymbolId, type TextStyle,
} from './model';
import { SYMBOL_SIZE } from './symbols';
import type { PdfView, FindResult } from './viewer';
import { closePdf, countFields, formValues, onFormChange, openPdf, restoreFormValues, type PDFDocumentProxy } from '../pdf/pdfjs';
import { extractProject, projectFor, stampObjects, type StampInput } from '../pdf/write';
import { baselineFactor, cssFont, fontsReady, measureLines } from './measure';
import { deleteDraft, getDraft, saveDraft, sha256 } from '../storage/drafts';

export type Tool = 'select' | 'text' | 'stamp' | 'field';
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
        this.#toast('info', `PDF criado neste editor: ${n} ${n === 1 ? 'objeto continua editável' : 'objetos continuam editáveis'}.`);
      } else {
        await this.#load(bytes, name, hash, [], {});
      }
    } catch (err) {
      console.error(err);
      const e = err as { name?: string };
      this.status = { kind: 'err', text: e?.name === 'PasswordException'
        ? 'Este PDF é protegido por senha. A ferramenta “Desbloquear PDF” chega numa próxima versão.'
        : 'Não foi possível abrir este arquivo. Verifique se é um PDF válido.' };
    } finally {
      this.loading = false;
    }
  }

  async openDraft(hash: string) {
    this.loading = true;
    try {
      const draft = await getDraft(hash);
      if (!draft) { this.status = { kind: 'err', text: 'Rascunho não encontrado.' }; return; }
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
        kind: 'warn', text: 'Este PDF não tem campos de formulário. Use “Texto” para escrever ou detecte os campos automaticamente.',
        action: { label: 'Detectar campos', run: () => this.detectFields() },
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

  pageBounds(page: number) { return this.view?.pageBounds(page) ?? [0, 0, 595, 842]; }

  addText(page: number, rect: Rect): Obj {
    const o = makeText(page, clampRect(rect, this.pageBounds(page)), this.style);
    this.objects.push(o);
    this.selectedId = o.id;
    this.editingId = o.id;
    return o;
  }

  /** Onde colocar um objeto novo: no centro da parte visível da página atual. */
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
    const b = this.pageBounds(page);
    const natural = asset.w * 0.75 / (signature ? 3 : 1); // px → pt (assinaturas são geradas em 3×)
    const w = Math.min(maxW, natural, (b[2] - b[0]) * 0.8);
    const h = w * asset.h / asset.w;
    this.tool = 'select';
    return this.#add(makeImage(page, rectAround(x, y, w, h, b), asset.id, signature));
  }

  /** Ferramenta Símbolos: coloca o símbolo (ou a data de hoje) centrado no ponto tocado. */
  addStamp(page: number, x: number, y: number) {
    const b = this.pageBounds(page);
    if (this.stamp === 'date') {
      const text = today();
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = cssFont(this.style, this.style.size);
      const w = Math.ceil(ctx.measureText(text).width) + 2 * PAD + 2;
      const h = minHeight(this.style);
      return this.#add(makeText(page, rectAround(x + w / 2 - PAD, y, w, h, b), this.style, text));
    }
    const s = this.symbolSize;
    return this.#add(makeSymbol(page, rectAround(x, y, s, s, b), this.stamp, this.symbolColor));
  }

  #fieldNames() { return new Set(this.objects.filter((o): o is FieldObj => o.kind === 'field').map((o) => o.name)); }

  /** Ferramenta Campos: cria um campo (texto ou caixa de seleção) no retângulo. */
  addField(page: number, rect: Rect, type = this.fieldType): Obj {
    const name = uniqueName(type === 'check' ? 'opcao' : 'campo', this.#fieldNames());
    return this.#add(makeField(page, clampRect(rect, this.pageBounds(page)), type, name));
  }

  /** Detecta campos nas páginas (PDF sem formulário) e cria os campos sugeridos. */
  async detectFields() {
    if (!this.doc) return;
    this.busy = 'Procurando campos…';
    try {
      const { detectInDocument } = await import('./detect');
      const found = await detectInDocument(this.doc, $state.snapshot(this.objects) as Obj[]);
      if (this.selectedId) this.select(null);
      const taken = this.#fieldNames();
      for (const f of found) {
        this.objects.push(makeField(f.page, f.rect, f.type, uniqueName(f.name, taken), f.size ?? FIELD_SIZE));
      }
      this.commit();
      this.tool = 'field';
      this.status = found.length
        ? { kind: 'ok', text: `${found.length} campo(s) encontrado(s). Toque num campo para preencher e exclua os que não servirem. No PDF baixado eles continuam preenchíveis.` }
        : { kind: 'info', text: 'Nenhum campo encontrado. Com a ferramenta Campos, toque onde quer criar um.' };
    } catch (err) {
      console.error(err);
      this.status = { kind: 'err', text: 'Não foi possível detectar os campos deste PDF.' };
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
    if (!src) return;
    this.#paste(src);
  }

  copy() { const s = this.selected; if (s) this.#clipboard = cloneObj($state.snapshot(s) as Obj); }
  paste() { if (this.#clipboard) this.#paste(this.#clipboard); }

  #paste(src: Obj) {
    const o = cloneObj($state.snapshot(src) as Obj);
    o.id = newId();
    o.page = Math.min(o.page, this.pages - 1);
    o.rect = clampRect({ ...o.rect, x: o.rect.x + 12, y: o.rect.y - 12 }, this.pageBounds(o.page));
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
      if (s.rect.h < minHeight(s.style)) s.rect.h = minHeight(s.style);
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
      patch.multiline = patch.type === 'text' && fieldMultiline(s.rect.h, s.size);
    }
    Object.assign(s, patch);
    this.commit();
  }

  nudge(dx: number, dy: number) {
    const s = this.selected;
    if (!s) return;
    s.rect = clampRect({ ...s.rect, x: s.rect.x + dx, y: s.rect.y + dy }, this.pageBounds(s.page));
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
    if (replaced) this.#toast('warn', `${replaced} caractere(s) não existem nas fontes do PDF e foram trocados por “?”.`);
    return bytes;
  }

  get outputName() { return this.fileName.replace(/\.pdf$/i, '').replace(/-editado$/i, '') + '-editado.pdf'; }
}

export { PAD };
