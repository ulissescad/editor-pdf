// Estado do editor: documento aberto, objetos, seleção, ferramenta, histórico e rascunho automático.
import { History } from './history';
import {
  DEFAULT_STYLE, PAD, clampRect, cloneObj, makeText, minHeight, newId,
  type Obj, type Project, type Rect, type TextStyle,
} from './model';
import type { PdfView, FindResult } from './viewer';
import { closePdf, countFields, formValues, onFormChange, openPdf, restoreFormValues, type PDFDocumentProxy } from '../pdf/pdfjs';
import { extractProject, stampObjects } from '../pdf/write';
import { baselineFactor, fontsReady, measureLines } from './measure';
import { deleteDraft, getDraft, saveDraft, sha256 } from '../storage/drafts';

export type Tool = 'select' | 'text';
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
  // visualização
  scale = $state(1);
  currentPage = $state(1);
  layoutTick = $state(0);
  find = $state<FindResult>({ current: 0, total: 0, state: 'idle' });
  // situação
  status = $state<{ kind: StatusKind; text: string } | null>(null);
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
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  get selected(): Obj | undefined { return this.objects.find((o) => o.id === this.selectedId); }
  get hasDoc() { return !!this.doc; }

  // ================= abrir =================
  async openBytes(bytes: Uint8Array, name: string) {
    this.loading = true;
    this.status = null;
    try {
      const hash = await sha256(bytes);
      const draft = await getDraft(hash).catch(() => undefined);
      if (draft) {
        await this.#load(draft.bytes, draft.name, hash, draft.objects, draft.formValues);
        this.restoredAt = draft.updatedAt;
        return;
      }
      const reopened = await extractProject(bytes).catch(() => null);
      if (reopened) {
        await this.#load(reopened.base, name, hash, reopened.project.objects, {});
        this.#toast('info', `PDF criado neste editor: ${reopened.project.objects.length} texto(s) continuam editáveis.`);
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
      await this.#load(draft.bytes, draft.name, hash, draft.objects, draft.formValues);
      this.restoredAt = draft.updatedAt;
    } finally {
      this.loading = false;
    }
  }

  async #load(base: Uint8Array, name: string, hash: string, objects: Obj[], values: Record<string, unknown>) {
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
    this.objects = objects.filter((o) => o.page < doc.numPages);
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
      this.#toast('warn', 'Este PDF não tem campos de formulário. Use “Texto” para escrever sobre ele.');
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

  select(id: string | null) {
    if (this.selectedId === id) return;
    const prev = this.selected;
    this.editingId = null;
    this.selectedId = id;
    if (prev && prev.kind === 'text' && !prev.text.trim()) {
      this.objects = this.objects.filter((o) => o.id !== prev.id); // caixa vazia some ao perder a seleção
    }
    const cur = this.selected;
    if (cur) this.style = { ...cur.style };
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
    this.objects.push(o);
    this.selectedId = o.id;
    this.editingId = null;
    this.commit();
  }

  /** Muda o estilo padrão e o do objeto selecionado. */
  setStyle(patch: Partial<TextStyle>) {
    this.style = { ...this.style, ...patch };
    const s = this.selected;
    if (s) {
      Object.assign(s.style, patch);
      if (s.rect.h < minHeight(s.style)) s.rect.h = minHeight(s.style);
      this.commit();
    }
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
    const live = this.objects.filter((o) => o.text.trim());
    await fontsReady(live.map((o) => o.style));
    const items = live.map((obj) => {
      const el = this.contentEls.get(obj.id);
      const scale = this.view?.scaleOf(obj.page) ?? 1;
      const lines = el ? measureLines(el, obj.style, scale) : obj.text.split('\n').map((text, index) => ({ index, text }));
      return { obj: $state.snapshot(obj) as Obj, lines, baseline: baselineFactor(obj.style) };
    });
    const withFields = await this.doc.saveDocument();
    const project: Project = { app: 'editor-pdf', version: 1, objects: items.map((i) => i.obj) };
    const { bytes, replaced } = await stampObjects(withFields, items, project);
    if (replaced) this.#toast('warn', `${replaced} caractere(s) não existem nas fontes do PDF e foram trocados por “?”.`);
    return bytes;
  }

  get outputName() { return this.fileName.replace(/\.pdf$/i, '').replace(/-editado$/i, '') + '-editado.pdf'; }
}

export { PAD };
