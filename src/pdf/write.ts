// Gravação do PDF final e leitura de PDFs gerados por este editor (PLANO.md, itens 1.3, 1.6, 1.7, 1.9 e 1.10).
//
// Os objetos do editor são desenhados numa camada própria em cada página: um fluxo de conteúdo marcado
// com /EditorPDF /Objetos. O projeto (JSON) vai junto como anexo. Ao reabrir o PDF, removemos essa camada
// e o anexo e recriamos os objetos editáveis, sem duplicar nada.
// Campos criados no editor viram campos de formulário de verdade (AcroForm) e não entram no projeto.
import type { PDFDocument as PDFDocumentType, PDFFont, PDFImage, PDFPage } from '@cantoo/pdf-lib';
import {
  DEFAULT_STYLE, LINE, PAD, PROJECT_FILE, fontFile, parseProject, pdfFontName, toBase64,
  type FieldObj, type ImageAsset, type Obj, type Project, type TextStyle,
} from '../editor/model';
import { SYMBOL_DEFS } from '../editor/symbols';
import { contentMatrix, localSize, normRot } from '../editor/geom';

const loadLib = () => import('@cantoo/pdf-lib');
const MARK_KEY = 'EditorPDF';
const MARK_VALUE = 'Objetos';

export interface StampLine { index: number; text: string }
/** Objeto a gravar. Caixas de texto levam as linhas como foram quebradas na tela. */
export interface StampInput { obj: Obj; lines?: StampLine[]; baseline?: number }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/**
 * Projeto que vai embutido no PDF. Campos não entram: viram campos de formulário de verdade
 * e continuam preenchíveis ao reabrir.
 */
export function projectFor(objects: Obj[], assets: Map<string, ImageAsset>): Project {
  const kept = objects.filter((o) => o.kind !== 'field');
  const images: NonNullable<Project['images']> = {};
  for (const o of kept) {
    if (o.kind !== 'image' || images[o.imageId]) continue;
    const a = assets.get(o.imageId);
    if (a) images[a.id] = { mime: a.mime, w: a.w, h: a.h, data: toBase64(a.bytes) };
  }
  return { app: 'editor-pdf', version: 1, objects: kept, ...(Object.keys(images).length ? { images } : {}) };
}

const NL = '\n';

export interface StampOptions {
  assets?: Map<string, ImageAsset>;
  /** Lê um arquivo de fonte extra (caminho de FONTS[...].files). Obrigatório se houver texto com fonte extra. */
  loadFont?: (path: string) => Promise<Uint8Array>;
}

/**
 * Recebe o PDF com os campos já preenchidos (pdf.js saveDocument) e grava os objetos.
 * Retorna os bytes finais, quantos caracteres não existiam nas fontes padrão (trocados por “?”)
 * e quantos campos de formulário foram criados.
 */
export async function stampObjects(
  bytes: Uint8Array, items: StampInput[], project: Project, { assets = new Map(), loadFont }: StampOptions = {},
): Promise<{ bytes: Uint8Array; replaced: number; fields: number }> {
  const lib = await loadLib();
  const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, PDFName, LineCapStyle,
    concatTransformationMatrix, degrees } = lib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fonts = new Map<string, { font: PDFFont; chars: Set<number> }>();
  const images = new Map<string, PDFImage>();
  const touched = new Set<PDFPage>();
  const fieldObjs: FieldObj[] = [];
  let replaced = 0;

  let fontkitReady = false;
  /** Fonte padrão do PDF ou fonte extra embutida (só com os caracteres usados). */
  async function font(style: TextStyle) {
    const std = pdfFontName(style);
    const key = std ?? fontFile(style)!;
    if (!fonts.has(key)) {
      let f: PDFFont;
      if (std) {
        f = await doc.embedFont(StandardFonts[std as keyof typeof StandardFonts]);
      } else {
        if (!loadFont) throw new Error('Fonte extra sem carregador');
        if (!fontkitReady) { doc.registerFontkit((await import('@cantoo/fontkit')).default); fontkitReady = true; }
        f = await doc.embedFont(await loadFont(key), { subset: true });
      }
      fonts.set(key, { font: f, chars: new Set(f.getCharacterSet()) });
    }
    return fonts.get(key)!;
  }
  const safeText = (text: string, chars: Set<number>) =>
    [...text].map((ch) => (ch === NL || chars.has(ch.codePointAt(0)!) ? ch : (replaced++, '?'))).join('');

  for (const { obj, lines, baseline = 0.9 } of items) {
    if (obj.page >= doc.getPageCount()) continue;
    if (obj.kind === 'field') { fieldObjs.push(obj); continue; }
    if (obj.kind === 'text' && !obj.text.trim()) continue;
    if (obj.kind === 'image' && !assets.has(obj.imageId)) continue;
    const page = doc.getPage(obj.page);
    touched.add(page);
    // Objeto girado (página girada): desenha no quadro do próprio conteúdo, levado ao lugar por uma matriz
    const turned = normRot(obj.rot ?? 0) !== 0;
    const local = localSize(obj.rect, obj.rot);
    const { x, y, w, h } = turned ? { x: 0, y: local.h, ...local } : obj.rect;
    if (turned) {
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...contentMatrix(obj.rect, obj.rot)));
    }

    if (obj.kind === 'text') {
      const { font: f, chars } = await font(obj.style);
      const { size, color, align } = obj.style;
      const innerW = w - 2 * PAD;
      // Recorta no retângulo da caixa: o que não aparece na tela também não aparece no PDF
      page.pushOperators(pushGraphicsState(), rectangle(x, y - h, w, h), clip(), endPath());
      for (const line of lines ?? obj.text.split(NL).map((text, index) => ({ index, text }))) {
        const safe = safeText(line.text, chars);
        const tw = f.widthOfTextAtSize(safe, size);
        const dx = align === 'center' ? (innerW - tw) / 2 : align === 'right' ? innerW - tw : 0;
        page.drawText(safe, {
          x: x + PAD + dx,
          y: y - PAD - line.index * size * LINE - baseline * size,
          size, font: f, color: rgb(...hexToRgb(color)),
        });
      }
      page.pushOperators(popGraphicsState());
    } else if (obj.kind === 'image') {
      const asset = assets.get(obj.imageId)!;
      let img = images.get(asset.id);
      if (!img) {
        img = asset.mime === 'image/png' ? await doc.embedPng(asset.bytes) : await doc.embedJpg(asset.bytes);
        images.set(asset.id, img);
      }
      page.drawImage(img, { x, y: y - h, width: w, height: h });
    } else if (obj.kind === 'symbol') {
      const def = SYMBOL_DEFS[obj.symbol];
      const side = Math.min(w, h);
      const color = rgb(...hexToRgb(obj.color));
      page.drawSvgPath(def.path, {
        x: x + (w - side) / 2, y: y - (h - side) / 2, scale: side / 24,
        ...(def.stroke
          ? { borderColor: color, borderWidth: def.stroke, borderLineCap: LineCapStyle.Round }
          : { color }),
      });
    }
    if (turned) page.pushOperators(popGraphicsState());
  }

  // Marca a camada criada nesta gravação em cada página tocada
  for (const page of touched) {
    const ref = (page as unknown as { contentStreamRef?: import('@cantoo/pdf-lib').PDFRef }).contentStreamRef;
    const stream = ref && doc.context.lookup(ref);
    const dict = (stream as { dict?: import('@cantoo/pdf-lib').PDFDict } | undefined)?.dict;
    dict?.set(PDFName.of(MARK_KEY), PDFName.of(MARK_VALUE));
  }

  // Campos de formulário de verdade (item 1.9 do PLANO.md)
  if (fieldObjs.length) {
    const form = doc.getForm();
    const taken = new Set(form.getFields().map((f) => f.getName()));
    const { font: helv, chars } = await font(DEFAULT_STYLE);
    for (const o of fieldObjs) {
      const page = doc.getPage(o.page);
      const base = o.name.replace(/\./g, '_') || 'campo';
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
      taken.add(name);
      // Campo girado: o pdf-lib gira em torno da origem do conteúdo (a mesma da matriz dos objetos)
      const local = localSize(o.rect, o.rot);
      const [, , , , ox, oy] = contentMatrix(o.rect, o.rot);
      const rotate = normRot(o.rot ?? 0);
      const box = { x: ox, y: oy, width: local.w, height: local.h, ...(rotate ? { rotate: degrees(rotate) } : {}) };
      if (o.type === 'check') {
        const cb = form.createCheckBox(name);
        cb.addToPage(page, { ...box, borderWidth: 1, borderColor: rgb(0, 0, 0), backgroundColor: undefined });
        if (o.value) cb.check();
      } else {
        const tf = form.createTextField(name);
        if (o.multiline) tf.enableMultiline();
        // A aparência padrão (/DA) só existe depois do addToPage; então fonte e valor vêm depois
        tf.addToPage(page, { ...box, font: helv, borderWidth: 0, borderColor: undefined, backgroundColor: undefined });
        tf.setFontSize(o.size);
        if (o.value) tf.setText(safeText(o.value, chars));
        tf.updateAppearances(helv);
      }
    }
  }

  if (project.objects.length) {
    await doc.attach(new TextEncoder().encode(JSON.stringify(project)), PROJECT_FILE, {
      mimeType: 'application/json',
      description: 'Objetos editáveis do Editor de PDF',
    });
  }
  return { bytes: await doc.save({ updateFieldAppearances: false }), replaced, fields: fieldObjs.length };
}

/**
 * Se o PDF foi gerado por este editor, devolve o projeto, as imagens e o PDF “base” (sem a camada
 * de objetos e sem o anexo), pronto para continuar editando. Caso contrário, devolve null.
 */
export async function extractProject(bytes: Uint8Array): Promise<{ project: Project; assets: ImageAsset[]; base: Uint8Array } | null> {
  const s = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4_000_000)));
  if (!s.includes(MARK_KEY) && !s.includes('EmbeddedFiles')) return null; // atalho: PDF comum
  const lib = await loadLib();
  const { PDFDocument, PDFName, PDFArray, PDFRef } = lib;
  let doc: PDFDocumentType;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { return null; }

  // 1) Anexo com o projeto
  const parsed = takeProject(lib, doc, true);
  if (!parsed) return null;

  // 2) Remove a camada de objetos de cada página
  const isMarked = (ref: unknown) => {
    const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    const dict = (obj as { dict?: import('@cantoo/pdf-lib').PDFDict } | undefined)?.dict;
    return dict?.get(PDFName.of(MARK_KEY)) === PDFName.of(MARK_VALUE);
  };
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of('Contents'));
    const list = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
    if (list instanceof PDFArray) {
      for (let i = list.size() - 1; i >= 0; i--) if (isMarked(list.get(i))) list.remove(i);
    }
  }

  return { ...parsed, base: await doc.save({ updateFieldAppearances: false }) };
}

type Lib = typeof import('@cantoo/pdf-lib');

/**
 * Lê o projeto do editor anexado ao PDF (editor-projeto.json). Com `remove`, tira o anexo do documento
 * (para regravar sem duplicar). Devolve null se o PDF não tiver projeto.
 */
export function takeProject(lib: Lib, doc: PDFDocumentType, remove: boolean): ReturnType<typeof parseProject> {
  const { PDFName, PDFArray, PDFDict, PDFHexString, PDFString, PDFRawStream, PDFRef, decodePDFRawStream } = lib;
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const ef = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const arr = ef?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!arr) return null;
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const key = arr.lookup(i);
    const name = key instanceof PDFHexString || key instanceof PDFString ? key.decodeText() : '';
    if (name !== PROJECT_FILE) continue;
    let parsed: ReturnType<typeof parseProject> = null;
    try {
      const spec = arr.lookup(i + 1, PDFDict);
      const file = spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F'));
      if (file instanceof PDFRawStream) parsed = parseProject(new TextDecoder().decode(decodePDFRawStream(file).decode()));
    } catch { parsed = null; }
    if (remove && parsed) {
      const specRef = arr.get(i + 1);
      arr.remove(i + 1);
      arr.remove(i);
      // Remove a referência ao anexo também da lista /AF do catálogo
      const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
      if (af && specRef instanceof PDFRef) {
        for (let j = af.size() - 1; j >= 0; j--) if (af.get(j) === specRef) af.remove(j);
      }
    }
    return parsed;
  }
  return null;
}
