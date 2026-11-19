// Montagem de PDFs a partir de um plano de páginas (PLANO.md, itens 2.1, 2.2 e 2.3): juntar, dividir,
// extrair, reordenar, girar, excluir, duplicar e inserir páginas em branco.
//
// Cuidados além do copyPages do pdf-lib:
// - campos de formulário continuam funcionando (o pdf-lib copia só os widgets, sem o /AcroForm);
//   nomes repetidos entre arquivos ganham sufixo (“nome_2”), senão os leitores ligariam os campos;
// - os widgets copiados não arrastam as outras páginas do arquivo de origem (/P), o que incharia o PDF;
// - objetos do editor (anexo editor-projeto.json) acompanham as páginas: o PDF montado continua
//   reeditável no editor.
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, PDFHexString, degrees,
  type PDFPage,
} from '@cantoo/pdf-lib';
import * as lib from '@cantoo/pdf-lib';
import type { ImageAsset, Obj, Project } from '../editor/model';
import { projectFor, takeProject } from './write';
import { isBlank, remapObjects, type PageSpec } from './plan';
import { normRot } from '../editor/geom';

/** PDF protegido por senha (abrir exige a senha). */
export class EncryptedError extends Error {
  constructor() { super('PDF protegido por senha'); this.name = 'EncryptedError'; }
}

/** Abre o PDF com o pdf-lib. PDFs com senha só “do dono” (abrem sem senha) são decifrados. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if ((err as Error).name !== 'EncryptedPDFError' && !/encrypt/i.test(String((err as Error).message))) throw err;
    try {
      return await PDFDocument.load(bytes, { updateMetadata: false, password: '' });
    } catch {
      throw new EncryptedError();
    }
  }
}

interface Loaded {
  doc: PDFDocument;
  objects: Obj[];
  assets: ImageAsset[];
  title?: string;
}

const ANNOTS = PDFName.of('Annots');
const P = PDFName.of('P');
const PARENT = PDFName.of('Parent');
const KIDS = PDFName.of('Kids');
const T = PDFName.of('T');

/** Arquivos de origem já abertos, prontos para montar quantos documentos forem precisos. */
export class Assembler {
  private constructor(private readonly sources: Loaded[]) {}

  static async load(files: Uint8Array[]): Promise<Assembler> {
    const sources: Loaded[] = [];
    for (const bytes of files) {
      const doc = await loadPdf(bytes);
      const parsed = takeProject(lib, doc, false);
      // Os widgets apontam para a própria página (/P); copiar isso levaria junto as outras páginas
      // do arquivo. /P é opcional: tiramos aqui e recolocamos na página nova.
      for (const page of doc.getPages()) {
        const annots = page.node.lookupMaybe(ANNOTS, PDFArray);
        for (let i = 0; annots && i < annots.size(); i++) {
          const a = annots.lookup(i);
          if (a instanceof PDFDict) a.delete(P);
        }
      }
      let title: string | undefined;
      try { title = doc.getTitle() || undefined; } catch { title = undefined; }
      sources.push({ doc, objects: parsed?.project.objects ?? [], assets: parsed?.assets ?? [], title });
    }
    return new Assembler(sources);
  }

  get count() { return this.sources.length; }
  pageCount(src: number) { return this.sources[src].doc.getPageCount(); }

  /** Tamanho da página como se vê (com o giro dela), em pt. */
  pageSize(src: number, index: number): { width: number; height: number; rotate: number } {
    const page = this.sources[src].doc.getPage(index);
    const { width, height } = page.getSize();
    const rotate = normRot(page.getRotation().angle);
    return rotate % 180 ? { width: height, height: width, rotate } : { width, height, rotate };
  }

  /** Objetos do editor guardados no PDF de origem. */
  objectsOf(src: number) { return this.sources[src].objects; }

  /** Monta um PDF novo com as páginas do plano. */
  async build(specs: PageSpec[]): Promise<Uint8Array> {
    if (!specs.length) throw new Error('Nenhuma página');
    const out = await PDFDocument.create({ updateMetadata: false });
    const pages: PDFPage[] = new Array(specs.length);

    // Copia por origem; uma página repetida é copiada de novo (o copyPages reaproveitaria a mesma cópia)
    const bySource = new Map<number, Array<{ pos: number; index: number }>>();
    specs.forEach((s, pos) => {
      if (isBlank(s)) return;
      if (!bySource.has(s.src)) bySource.set(s.src, []);
      bySource.get(s.src)!.push({ pos, index: s.index });
    });
    const batches: Array<{ src: number; items: Array<{ pos: number; index: number }> }> = [];
    for (const [src, items] of bySource) {
      const rounds: Array<Array<{ pos: number; index: number }>> = [];
      const seen = new Map<number, number>();
      for (const it of items) {
        const k = seen.get(it.index) ?? 0;
        seen.set(it.index, k + 1);
        (rounds[k] ??= []).push(it);
      }
      for (const items of rounds) batches.push({ src, items });
    }
    // Cada lote ganha seu conjunto de campos (raízes), para renomear repetições entre lotes
    const fieldGroups: PDFRef[][] = [];
    for (const { src, items } of batches) {
      const copied = await out.copyPages(this.sources[src].doc, items.map((i) => i.index));
      items.forEach((it, k) => { pages[it.pos] = copied[k]; });
      fieldGroups.push([]);
      for (const page of copied) fieldGroups[fieldGroups.length - 1].push(...this.widgetsOf(out, page));
    }

    specs.forEach((s, pos) => {
      if (isBlank(s)) {
        pages[pos] = out.addPage([s.width, s.height]);
        return;
      }
      const page = out.addPage(pages[pos]);
      pages[pos] = page;
      const extra = normRot(s.rotate ?? 0);
      if (extra) page.setRotation(degrees(normRot(page.getRotation().angle + extra)));
      const annots = page.node.lookupMaybe(ANNOTS, PDFArray);
      for (let i = 0; annots && i < annots.size(); i++) {
        const a = annots.lookup(i);
        if (a instanceof PDFDict) a.set(P, page.ref);
      }
    });

    this.rebuildForm(out, fieldGroups);

    // Objetos do editor acompanham as páginas
    const perSource = this.sources.map((s) => s.objects);
    const { objects, assets } = this.mergeImages(perSource);
    const moved = remapObjects(objects, specs);
    if (moved.length) {
      const project: Project = projectFor(moved, assets);
      await out.attach(new TextEncoder().encode(JSON.stringify(project)), 'editor-projeto.json', {
        mimeType: 'application/json',
        description: 'Objetos editáveis do Editor de PDF',
      });
    }

    const title = this.sources.find((s) => s.title)?.title;
    if (title) out.setTitle(title);
    out.setProducer('Editor de PDF (no navegador)');
    return out.save({ useObjectStreams: true, updateFieldAppearances: false });
  }

  /** Widgets (campos) de uma página copiada: a raiz de cada campo. */
  private widgetsOf(out: PDFDocument, page: PDFPage): PDFRef[] {
    const roots: PDFRef[] = [];
    const annots = page.node.lookupMaybe(ANNOTS, PDFArray);
    for (let i = 0; annots && i < annots.size(); i++) {
      const ref = annots.get(i);
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
      // Sobe pela hierarquia até a raiz do campo
      let rootRef = ref instanceof PDFRef ? ref : null;
      let node: PDFDict = a;
      for (let guard = 0; guard < 32; guard++) {
        const parentRef = node.get(PARENT);
        const parent = parentRef ? out.context.lookup(parentRef) : undefined;
        if (!(parentRef instanceof PDFRef) || !(parent instanceof PDFDict)) break;
        rootRef = parentRef;
        node = parent;
      }
      if (rootRef && !roots.includes(rootRef)) roots.push(rootRef);
    }
    return roots;
  }

  /**
   * Monta o /AcroForm do PDF novo com os campos das páginas copiadas. Tira dos campos os widgets
   * que ficaram de fora (páginas não copiadas) e renomeia campos repetidos.
   */
  private rebuildForm(out: PDFDocument, groups: PDFRef[][]) {
    const ctx = out.context;
    const onPage = new Set<PDFRef>();
    for (const page of out.getPages()) {
      const annots = page.node.lookupMaybe(ANNOTS, PDFArray);
      for (let i = 0; annots && i < annots.size(); i++) {
        const r = annots.get(i);
        if (r instanceof PDFRef) onPage.add(r);
      }
    }
    // Mantém só os filhos que levam a um widget presente em alguma página
    const prune = (ref: PDFRef, dict: PDFDict, depth = 0): boolean => {
      const kids = dict.lookupMaybe(KIDS, PDFArray);
      if (!kids) return onPage.has(ref);
      for (let i = kids.size() - 1; i >= 0; i--) {
        const kr = kids.get(i);
        const kd = kr instanceof PDFRef ? ctx.lookup(kr) : undefined;
        if (!(kr instanceof PDFRef) || !(kd instanceof PDFDict) || depth > 30 || !prune(kr, kd, depth + 1)) kids.remove(i);
      }
      return kids.size() > 0 || onPage.has(ref);
    };

    const fields: PDFRef[] = [];
    const taken = new Set<string>();
    for (const roots of groups) {
      for (const ref of roots) {
        if (fields.includes(ref)) continue;
        const dict = ctx.lookup(ref);
        if (!(dict instanceof PDFDict) || !prune(ref, dict)) continue;
        const t = dict.lookup(T);
        const name = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
        if (name) {
          let unique = name;
          for (let n = 2; taken.has(unique); n++) unique = `${name}_${n}`;
          if (unique !== name) dict.set(T, PDFHexString.fromText(unique));
          taken.add(unique);
        }
        fields.push(ref);
      }
    }
    if (!fields.length) return;

    // Aparência padrão (/DA, /DR) vem do primeiro arquivo com formulário
    const acro = ctx.obj({}) as PDFDict;
    acro.set(PDFName.of('Fields'), ctx.obj(fields));
    for (const s of this.sources) {
      const src = s.doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
      if (!src) continue;
      const copier = lib.PDFObjectCopier.for(s.doc.context, ctx);
      for (const key of ['DA', 'DR', 'Q']) {
        const v = src.get(PDFName.of(key));
        if (v && !acro.get(PDFName.of(key))) acro.set(PDFName.of(key), copier.copy(v));
      }
      const need = src.lookup(PDFName.of('NeedAppearances'));
      if (need) acro.set(PDFName.of('NeedAppearances'), need);
    }
    out.catalog.set(PDFName.of('AcroForm'), ctx.register(acro));
  }

  /** Junta as imagens de todas as origens, trocando ids repetidos. */
  private mergeImages(perSource: Obj[][]): { objects: Obj[][]; assets: Map<string, ImageAsset> } {
    const assets = new Map<string, ImageAsset>();
    const objects = perSource.map((objs, si) => {
      const rename = new Map<string, string>();
      for (const a of this.sources[si].assets) {
        let id = a.id;
        if (assets.has(id) && assets.get(id)!.bytes !== a.bytes) id = `${a.id}s${si}`;
        rename.set(a.id, id);
        assets.set(id, { ...a, id });
      }
      return objs.map((o) => (o.kind === 'image' && rename.get(o.imageId) !== o.imageId
        ? { ...o, imageId: rename.get(o.imageId) ?? o.imageId } : o));
    });
    return { objects, assets };
  }
}

/** Atalho: monta um PDF de uma vez. */
export async function assemble(files: Uint8Array[], specs: PageSpec[]): Promise<Uint8Array> {
  return (await Assembler.load(files)).build(specs);
}

// ============== Imagens → PDF (item 2.4) ==============

export type PageSizeId = 'a4' | 'letter' | 'image';
export type Orientation = 'auto' | 'portrait' | 'landscape';

export interface ImagePageOptions {
  size: PageSizeId;
  orientation: Orientation;
  margin: number;            // pt
}

export interface ImageInput {
  mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array; w: number; h: number;
  /** Tamanho exato da página (pt), com a imagem ocupando-a inteira (páginas digitalizadas). */
  page?: [number, number];
}

const SIZES: Record<Exclude<PageSizeId, 'image'>, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };

/** Tamanho da página e onde a imagem fica (centralizada, inteira, dentro da margem). */
export function imageLayout(img: { w: number; h: number; page?: [number, number] }, o: ImagePageOptions) {
  if (img.page) return { page: img.page, x: 0, y: 0, w: img.page[0], h: img.page[1] };
  // “Igual à imagem”: 1 px = 0,75 pt (96 ppp), limitado a uma folha A3 no lado maior
  if (o.size === 'image') {
    const k = Math.min(0.75, 1190 / Math.max(img.w, img.h));
    const w = img.w * k, h = img.h * k;
    return { page: [w + 2 * o.margin, h + 2 * o.margin] as [number, number], x: o.margin, y: o.margin, w, h };
  }
  let [pw, ph] = SIZES[o.size];
  const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && img.w > img.h);
  if (landscape) [pw, ph] = [ph, pw];
  const aw = pw - 2 * o.margin, ah = ph - 2 * o.margin;
  const k = Math.min(aw / img.w, ah / img.h);
  const w = img.w * k, h = img.h * k;
  return { page: [pw, ph] as [number, number], x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

/** Um PDF com uma imagem por página. */
export async function imagesToPdf(images: ImageInput[], o: ImagePageOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const img of images) {
    const embedded = img.mime === 'image/png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const l = imageLayout(img, o);
    const page = doc.addPage(l.page);
    page.drawImage(embedded, { x: l.x, y: l.y, width: l.w, height: l.h });
  }
  doc.setProducer('Editor de PDF (no navegador)');
  return doc.save({ useObjectStreams: true });
}
