// Carregamento do pdf.js, sempre a partir do próprio site (worker, fontes padrão, CMaps, WASM, ICC).
// Usa a versão "legacy": a "moderna" do pdf.js 6 chama APIs recentíssimas (Map.getOrInsertComputed,
// Math.sumPrecise, RegExp.escape) sem alternativa, e falha ao abrir qualquer PDF em navegadores de
// celular (Samsung Internet, Chrome não atualizado). A legacy traz essas funções embutidas.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
// O pdf_viewer.mjs (componentes do visualizador) lê a biblioteca deste global
(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

export { pdfjsLib };
export type { PDFDocumentProxy };

const assets = () => new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;

/** Os componentes do visualizador só podem ser importados depois do global acima. */
export const loadViewerComponents = () => import('pdfjs-dist/legacy/web/pdf_viewer.mjs');

export async function openPdf(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const base = assets();
  return pdfjsLib.getDocument({
    data: data.slice(), // o pdf.js transfere o buffer para o worker; mantemos o original intacto
    password,
    enableXfa: true,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  }).promise;
}

/** Libera o documento e o worker (no pdf.js 6 isso é feito pela tarefa de carregamento). */
export const closePdf = (doc: PDFDocumentProxy | null | undefined) => doc?.loadingTask.destroy() ?? Promise.resolve();

/** Avisa quando um campo de formulário é alterado (para o rascunho automático). */
export function onFormChange(doc: PDFDocumentProxy, fn: () => void) {
  (doc.annotationStorage as unknown as { onSetModified: (() => void) | null }).onSetModified = fn;
}

/** Conta campos de formulário editáveis e somente leitura (ignora botões, assinaturas e ocultos). */
export async function countFields(doc: PDFDocumentProxy) {
  const fields = (await doc.getFieldObjects()) as Map<string, Array<Record<string, unknown>>> | Record<string, Array<Record<string, unknown>>> | null;
  let editable = 0, readOnly = 0;
  if (fields) {
    const all = fields instanceof Map ? [...fields.values()] : Object.values(fields);
    for (const widgets of all) {
      const w = widgets.find((x) => x.type && x.type !== 'button' && x.type !== 'signature');
      if (!w || w.hidden) continue;
      if (w.editable === false) readOnly++; else editable++;
    }
  }
  return { editable, readOnly };
}

/** Valores atuais dos campos de formulário (para o rascunho). */
export function formValues(doc: PDFDocumentProxy): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of doc.annotationStorage as unknown as Iterable<[string, unknown]>) {
    if (value && typeof value === 'object' && !('annotationType' in value)) out[key] = value; // ignora editores do pdf.js
  }
  return out;
}

export function restoreFormValues(doc: PDFDocumentProxy, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) doc.annotationStorage.setValue(key, value as object);
}
