// Editor v1 (migrado do arquivo único). Todas as bibliotecas e arquivos de apoio são servidos pelo próprio site.
// Será substituído pelo editor novo no marco M1 (PLANO.md).
import '../styles/tokens.css';
import 'pdfjs-dist/web/pdf_viewer.css';
import './editor.css';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { registerSW } from 'virtual:pwa-register';
import { takeHandoff } from '../lib/handoff';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
globalThis.pdfjsLib = pdfjsLib; // o pdf_viewer.mjs lê a biblioteca daqui
const { PDFViewer, EventBus, PDFLinkService } = await import('pdfjs-dist/web/pdf_viewer.mjs');
const loadPdfLib = () => import('@cantoo/pdf-lib');
// Arquivos de apoio do pdf.js copiados para /pdfjs/ no build (vite.config.ts)
const PDFJS_ASSETS = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;

if ('serviceWorker' in navigator) registerSW({ immediate: true });

const $ = (id) => document.getElementById(id);
const container = $('viewerContainer');
const viewerDiv = $('viewer');
const statusEl = $('status');
const downloadBtn = $('download');

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const viewer = new PDFViewer({
  container,
  viewer: viewerDiv,
  eventBus,
  linkService,
  annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, // campos de formulário editáveis
  annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE, // usamos caixas de texto próprias
  removePageBorders: true,
});
linkService.setViewer(viewer);
eventBus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; layoutAll(); });
eventBus.on('scalechanging', (e) => {
  $('zoomLabel').textContent = Math.round(e.scale * 100) + '%';
  requestAnimationFrame(layoutAll);
});
eventBus.on('pagerendered', () => layoutAll());

let pdfDoc = null;
let fileName = 'documento.pdf';
let dirty = false;
let docStatus = { kind: '', text: '' }; // mensagem sobre o documento, restaurada ao sair do modo texto

function setStatus(kind, text) {
  statusEl.className = kind;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}
function setDocStatus(kind, text) {
  docStatus = { kind, text };
  if (!textMode) setStatus(kind, text);
}
function setControls(enabled) {
  for (const id of ['zoomOut', 'zoomIn', 'zoomFit', 'download', 'textMode']) $(id).disabled = !enabled;
}

// ============================================================
// Caixas de texto
// Cada caixa guarda posição e tamanho em pontos do PDF (origem no canto inferior
// esquerdo da página). x/y é o canto superior esquerdo. Na tela, tudo é convertido
// pela viewport da página, então zoom e redimensionamento da janela não distorcem nada.
// ============================================================
const PAD = 2;            // margem interna da caixa, em pt
const LINE = 1.2;         // altura de linha (em múltiplos do tamanho da fonte)
const FONTS = {
  helv:    { css: 'Arial, Helvetica, "Liberation Sans", sans-serif',
             pdf: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  times:   { css: '"Times New Roman", Times, "Liberation Serif", serif',
             pdf: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  courier: { css: '"Courier New", Courier, "Liberation Mono", monospace',
             pdf: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
};
const style = { font: 'helv', size: 11, bold: false, italic: false, color: '#000000' }; // estilo para novas caixas

let boxes = [];
let selected = null;
let textMode = false;
let boxLayer = null;

const pageView = (i) => viewer.getPageView(i);
const scaleOf = (i) => pageView(i).viewport.scale;   // px de tela por pt do PDF
const pageBounds = (i) => pageView(i).pdfPage?.view || [0, 0, 595, 842];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const minHeight = (b) => b.size * LINE + 2 * PAD;

function ensureLayer() {
  if (!boxLayer) { boxLayer = document.createElement('div'); boxLayer.id = 'boxLayer'; }
  if (boxLayer.parentNode !== viewerDiv) viewerDiv.appendChild(boxLayer); // o pdf.js limpa o #viewer ao trocar de documento
}

// Converte um ponto do PDF para coordenadas dentro do #viewer
function toViewer(i, x, y) {
  const pv = pageView(i);
  const [vx, vy] = pv.viewport.convertToViewportPoint(x, y);
  return [pv.div.offsetLeft + pv.div.clientLeft + vx, pv.div.offsetTop + pv.div.clientTop + vy];
}
// Converte um ponto da tela (clientX/Y) para coordenadas do PDF na página i
function clientToPdf(i, cx, cy) {
  const pv = pageView(i);
  const r = pv.div.getBoundingClientRect();
  return pv.viewport.convertToPdfPoint(cx - r.left - pv.div.clientLeft, cy - r.top - pv.div.clientTop);
}

function layoutBox(b) {
  if (!pdfDoc) return;
  const s = scaleOf(b.page);
  const [left, top] = toViewer(b.page, b.x, b.y);
  Object.assign(b.el.style, { left: left + 'px', top: top + 'px', width: b.w * s + 'px', height: b.h * s + 'px' });
  Object.assign(b.content.style, {
    fontFamily: FONTS[b.font].css,
    fontSize: b.size * s + 'px',
    fontWeight: b.bold ? '700' : '400',
    fontStyle: b.italic ? 'italic' : 'normal',
    color: b.color,
    padding: PAD * s + 'px',
  });
  b.el.classList.toggle('overflow', b.content.scrollHeight > b.content.clientHeight + 1);
}
function layoutAll() {
  if (!pdfDoc) return;
  ensureLayer();
  boxes.forEach(layoutBox);
}

function createBox(page, x, y, w, h) {
  const b = { page, x, y, w, h, text: '', ...style };
  b.el = document.createElement('div');
  b.el.className = 'tbox';
  b.el.innerHTML = '<div class="grip" title="Arraste para mover">✥ mover</div><div class="tcontent" spellcheck="true"></div>'
    + ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<span class="handle" data-h="${h}"></span>`).join('');
  b.content = b.el.querySelector('.tcontent');
  try { b.content.contentEditable = 'plaintext-only'; } catch { b.content.contentEditable = 'true'; }
  b.h = Math.max(b.h, minHeight(b));
  wireBox(b);
  ensureLayer();
  boxLayer.appendChild(b.el);
  boxes.push(b);
  layoutBox(b);
  dirty = true;
  return b;
}

function removeBox(b) {
  boxes = boxes.filter((x) => x !== b);
  b.el.remove();
  if (selected === b) { selected = null; syncToolbar(); }
  dirty = true;
}

function select(b) {
  if (selected === b) return;
  const prev = selected;
  if (prev) {
    prev.el.classList.remove('selected');
    stopEditing(prev);
    if (!prev.text.trim()) removeBox(prev); // caixa vazia some ao perder a seleção
  }
  selected = b;
  if (b) {
    b.el.classList.add('selected');
    Object.assign(style, { font: b.font, size: b.size, bold: b.bold, italic: b.italic, color: b.color });
  }
  syncToolbar();
}

function startEditing(b, cx, cy) {
  select(b);
  b.el.classList.add('editing');
  b.content.focus({ preventScroll: true });
  const sel = window.getSelection();
  let range = null;
  if (cx != null) {
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(cx, cy);
    else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(cx, cy);
      if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
    }
  }
  if (!range || !b.content.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(b.content);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function stopEditing(b) {
  if (!b.el.classList.contains('editing')) return;
  b.el.classList.remove('editing');
  b.text = b.content.innerText.replace(/\n$/, '');
  if (document.activeElement === b.content) b.content.blur();
}

// Cresce a altura automaticamente enquanto se digita (nunca encolhe sozinha)
function autoGrow(b) {
  const s = scaleOf(b.page);
  const need = b.content.scrollHeight / s;
  if (need > b.h + 0.5) {
    const maxH = b.y - pageBounds(b.page)[1];
    b.h = Math.min(need, maxH);
  }
  layoutBox(b);
}

function wireBox(b) {
  b.content.addEventListener('input', () => { b.text = b.content.innerText.replace(/\n$/, ''); dirty = true; autoGrow(b); });
  b.content.addEventListener('blur', () => { b.el.classList.remove('editing'); b.text = b.content.innerText.replace(/\n$/, ''); });
  b.content.addEventListener('paste', (e) => { // cola sempre como texto simples
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  b.content.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); stopEditing(b); b.el.focus?.(); }
  });

  b.el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const handle = e.target.dataset?.h;
    const onGrip = e.target.classList.contains('grip');
    // Durante a edição, cliques no texto ficam com o navegador (cursor, seleção)
    if (b.el.classList.contains('editing') && !handle && !onGrip) return;
    e.preventDefault();
    e.stopPropagation();
    if (selected !== b) select(b);
    drag(e, b, handle || 'move', !handle && !onGrip);
  });
}

// Arrastar para mover ou redimensionar. Um clique sem arrastar entra na edição do texto.
function drag(e, b, mode, clickEdits) {
  const s = scaleOf(b.page);
  const [px0, py0, px1, py1] = pageBounds(b.page);
  const start = { cx: e.clientX, cy: e.clientY, x: b.x, y: b.y, w: b.w, h: b.h };
  const minW = Math.max(12, b.size), minH = minHeight(b);
  let moved = false;
  const el = e.target;
  el.setPointerCapture?.(e.pointerId);

  const onMove = (ev) => {
    const dx = (ev.clientX - start.cx) / s, dy = (ev.clientY - start.cy) / s; // em pt; dy positivo = para baixo
    if (!moved && Math.hypot(ev.clientX - start.cx, ev.clientY - start.cy) < 3) return;
    moved = true;
    if (mode === 'move') {
      b.x = clamp(start.x + dx, px0, px1 - b.w);
      b.y = clamp(start.y - dy, py0 + b.h, py1);
    } else {
      let { x, y, w, h } = start;
      const right = start.x + start.w, bottom = start.y - start.h;
      if (mode.includes('e')) w = clamp(start.w + dx, minW, px1 - start.x);
      if (mode.includes('w')) { x = clamp(start.x + dx, px0, right - minW); w = right - x; }
      if (mode.includes('s')) h = clamp(start.h + dy, minH, start.y - py0);
      if (mode.includes('n')) { y = clamp(start.y - dy, bottom + minH, py1); h = y - bottom; }
      Object.assign(b, { x, y, w, h });
    }
    layoutBox(b);
    dirty = true;
  };
  const onUp = (ev) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    if (!moved && clickEdits && ev.type === 'pointerup') startEditing(b, ev.clientX, ev.clientY);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

// Criar caixa: clique (tamanho padrão) ou arraste (desenha o retângulo) com o modo texto ligado
viewerDiv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.tbox')) return;
  const pageEl = e.target.closest('.page');
  if (!textMode || !pageEl) { select(null); return; }
  e.preventDefault();
  select(null);
  const page = Number(pageEl.dataset.pageNumber) - 1;
  const s = scaleOf(page);
  const [px0, py0, px1, py1] = pageBounds(page);
  const [x0, y0] = clientToPdf(page, e.clientX, e.clientY);
  let rectEl = null, rect = null, cancelled = false;

  const onMove = (ev) => {
    if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6 && !rectEl) return;
    const [x1, y1] = clientToPdf(page, ev.clientX, ev.clientY);
    const left = clamp(Math.min(x0, x1), px0, px1), right = clamp(Math.max(x0, x1), px0, px1);
    const top = clamp(Math.max(y0, y1), py0, py1), bottom = clamp(Math.min(y0, y1), py0, py1);
    rect = { x: left, y: top, w: right - left, h: top - bottom };
    if (!rectEl) { rectEl = document.createElement('div'); rectEl.className = 'drawRect'; ensureLayer(); boxLayer.appendChild(rectEl); }
    const [l, t] = toViewer(page, rect.x, rect.y);
    Object.assign(rectEl.style, { left: l + 'px', top: t + 'px', width: rect.w * s + 'px', height: rect.h * s + 'px' });
  };
  const finish = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    rectEl?.remove();
    if (ev.type === 'pointercancel') return; // ex.: o toque virou rolagem
    let b;
    if (rect && rect.w >= 8) {
      b = createBox(page, rect.x, rect.y, rect.w, rect.h);
    } else {
      // Clique simples: caixa de uma linha centralizada verticalmente no ponto clicado
      const h = style.size * LINE + 2 * PAD;
      const w = Math.min(200, px1 - x0 - 2);
      b = createBox(page, clamp(x0 - PAD, px0, px1 - w), clamp(y0 + h / 2, py0 + h, py1), Math.max(w, 30), h);
    }
    startEditing(b);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
});

// Teclado: Delete apaga, setas movem (Shift = 10 pt), Esc solta a seleção
window.addEventListener('keydown', (e) => {
  if (!selected || selected.el.classList.contains('editing')) return;
  if (e.target.closest?.('input, select, textarea')) return;
  const b = selected;
  const [px0, py0, px1, py1] = pageBounds(b.page);
  const step = e.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeBox(b); }
  else if (e.key === 'Escape') { select(null); }
  else if (e.key === 'Enter') { e.preventDefault(); startEditing(b); }
  else if (moves[e.key]) {
    e.preventDefault();
    b.x = clamp(b.x + moves[e.key][0], px0, px1 - b.w);
    b.y = clamp(b.y + moves[e.key][1], py0 + b.h, py1);
    layoutBox(b); dirty = true;
  }
});

// ---- Barra de formatação ----
function syncToolbar() {
  $('fontFamily').value = style.font;
  $('fontSize').value = style.size;
  $('bold').setAttribute('aria-pressed', String(style.bold));
  $('italic').setAttribute('aria-pressed', String(style.italic));
  $('fontColor').value = style.color;
  // A barra fica sempre visível com um PDF aberto (para a página não "pular"), ativa só no modo texto ou com caixa selecionada
  const active = textMode || !!selected;
  for (const id of ['fontFamily', 'fontSize', 'bold', 'italic', 'fontColor']) $(id).disabled = !active;
  $('deleteBox').disabled = !selected;
  $('textOpts').hidden = !pdfDoc || pdfDoc.isPureXfa;
}
function applyStyle(patch) {
  Object.assign(style, patch);
  if (selected) {
    Object.assign(selected, patch);
    if (selected.h < minHeight(selected)) selected.h = minHeight(selected);
    autoGrow(selected);
    dirty = true;
  }
  syncToolbar();
}
$('fontFamily').addEventListener('change', (e) => applyStyle({ font: e.target.value }));
$('fontSize').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (v >= 4 && v <= 96) applyStyle({ size: v });
});
$('fontColor').addEventListener('input', (e) => applyStyle({ color: e.target.value }));
for (const id of ['bold', 'italic']) {
  const btn = $(id);
  btn.addEventListener('pointerdown', (e) => e.preventDefault()); // não tira o foco do texto em edição
  btn.addEventListener('click', () => applyStyle({ [id]: !style[id] }));
}
$('deleteBox').addEventListener('click', () => selected && removeBox(selected));

function setTextMode(on) {
  textMode = on;
  $('textMode').setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('text-mode', on);
  syncToolbar();
  if (on) setStatus('ok', 'Modo texto: clique ou arraste na página para criar uma caixa · clique no texto para editar · arraste para mover · alças ajustam o tamanho · Delete apaga.');
  else setStatus(docStatus.kind, docStatus.text);
}
$('textMode').addEventListener('click', () => setTextMode(!textMode));

// ============================================================
// Gravação das caixas no PDF (pdf-lib)
// As quebras de linha são lidas da própria tela, para o PDF sair igual ao que se vê.
// ============================================================
const baselineCache = new Map();
function baselineFactor(b) { // distância do topo da linha até a linha de base, em múltiplos do tamanho da fonte
  const key = `${b.font}|${b.bold}|${b.italic}`;
  if (!baselineCache.has(key)) {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-family:${FONTS[b.font].css};`
      + `font-size:100px;line-height:${LINE};font-weight:${b.bold ? 700 : 400};font-style:${b.italic ? 'italic' : 'normal'}`;
    d.innerHTML = 'Hg<span style="display:inline-block;width:1px;height:0"></span>';
    document.body.appendChild(d);
    baselineCache.set(key, (d.lastChild.getBoundingClientRect().top - d.getBoundingClientRect().top) / 100);
    d.remove();
  }
  return baselineCache.get(key);
}

function measureLines(b) {
  const c = b.content;
  c.scrollTop = 0;
  const s = scaleOf(b.page);
  const lineH = b.size * LINE * s;
  const top0 = c.getBoundingClientRect().top + c.clientTop + PAD * s;
  const lines = [];
  const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const t = node.data;
    for (let i = 0; i < t.length; ) {
      const cp = t.codePointAt(i);
      const len = cp > 0xffff ? 2 : 1;
      const ch = t.slice(i, i + len);
      if (ch !== '\n' && ch !== '\r') {
        range.setStart(node, i); range.setEnd(node, i + len);
        const r = range.getClientRects()[0];
        if (r) {
          const idx = Math.max(0, Math.floor(((r.top + r.bottom) / 2 - top0) / lineH));
          lines[idx] = (lines[idx] || '') + ch;
        }
      }
      i += len;
    }
  }
  return lines.map((t, i) => ({ i, text: (t || '').replace(/\s+$/, '').replace(/\t/g, '    ') })).filter((l) => l.text);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

async function stampBoxes(bytes) {
  const live = boxes.filter((b) => b.text.trim());
  if (!live.length) return bytes;
  const lib = await loadPdfLib();
  const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = lib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fonts = new Map();
  let replaced = 0;
  for (const b of live) {
    const name = FONTS[b.font].pdf[(b.bold ? 1 : 0) + (b.italic ? 2 : 0)];
    if (!fonts.has(name)) {
      const f = await doc.embedFont(StandardFonts[name]);
      fonts.set(name, { f, chars: new Set(f.getCharacterSet()) });
    }
    const { f: font, chars } = fonts.get(name);
    const page = doc.getPage(b.page);
    const base = baselineFactor(b);
    // Recorta no retângulo da caixa: o que não cabe na tela também não aparece no PDF
    page.pushOperators(pushGraphicsState(), rectangle(b.x, b.y - b.h, b.w, b.h), clip(), endPath());
    for (const { i, text } of measureLines(b)) {
      const safe = [...text].map((ch) => (chars.has(ch.codePointAt(0)) ? ch : (replaced++, '?'))).join('');
      page.drawText(safe, {
        x: b.x + PAD,
        y: b.y - PAD - i * b.size * LINE - base * b.size,
        size: b.size, font, color: rgb(...hexToRgb(b.color)),
      });
    }
    page.pushOperators(popGraphicsState());
  }
  if (replaced) console.warn(`${replaced} caractere(s) sem suporte nas fontes padrão do PDF foram trocados por “?”.`);
  return doc.save({ updateFieldAppearances: false });
}

// ============================================================
// Abrir / salvar
// ============================================================
async function countEditableFields(doc) { // ignora botões, assinaturas, ocultos e somente leitura
  const fields = await doc.getFieldObjects();
  let editable = 0, readOnly = 0;
  if (fields) {
    // pdf.js 6 devolve um Map; versões antigas, um objeto simples
    for (const widgets of fields instanceof Map ? fields.values() : Object.values(fields)) {
      const w = widgets.find((x) => x.type && x.type !== 'button' && x.type !== 'signature');
      if (!w || w.hidden) continue;
      if (w.editable === false) readOnly++; else editable++;
    }
  }
  return { editable, readOnly };
}

async function openPdf(data, name) {
  setStatus('', '');
  try {
    if (pdfDoc) { await pdfDoc.destroy(); pdfDoc = null; }
    selected = null;
    boxes.forEach((b) => b.el.remove());
    boxes = [];
    docStatus = { kind: '', text: '' };
    setTextMode(false);

    const doc = await pdfjsLib.getDocument({
      data,
      enableXfa: true,
      cMapUrl: `${PDFJS_ASSETS}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
      wasmUrl: `${PDFJS_ASSETS}wasm/`,
      iccUrl: `${PDFJS_ASSETS}iccs/`,
    }).promise;
    pdfDoc = doc;
    fileName = name || 'documento.pdf';
    dirty = false;
    doc.annotationStorage.onSetModified = () => { dirty = true; };

    $('drop').hidden = true;
    container.hidden = false;
    viewer.setDocument(doc);
    linkService.setDocument(doc, null);
    ensureLayer();
    $('fileName').textContent = fileName;
    $('fileName').title = fileName;
    setControls(true);

    syncToolbar();
    if (doc.isPureXfa) {
      $('textMode').disabled = true; // formulários XFA puros são renderizados como HTML; caixas não se aplicam
      setDocStatus('ok', 'Formulário XFA detectado: os campos podem ser preenchidos diretamente na página.');
      return;
    }
    const { editable, readOnly } = await countEditableFields(doc);
    const pages = `${doc.numPages} página${doc.numPages > 1 ? 's' : ''}`;
    if (editable > 0) {
      const ro = readOnly ? ` (${readOnly} somente leitura)` : '';
      setDocStatus('ok', `${editable} campo${editable > 1 ? 's' : ''} editáve${editable > 1 ? 'is' : 'l'}${ro} · ${pages}. Clique nos campos destacados para preencher e depois em “Baixar PDF”.`);
    } else if (readOnly > 0) {
      setDocStatus('warn', `Este PDF tem ${readOnly} campo${readOnly > 1 ? 's' : ''}, mas todos estão bloqueados (somente leitura) · ${pages}. Use “Inserir texto” para escrever sobre ele.`);
    } else {
      setDocStatus('warn', `Este PDF não tem campos de formulário · ${pages}. Use “Inserir texto” para escrever sobre ele e depois “Baixar PDF”.`);
    }
  } catch (err) {
    console.error(err);
    const msg = err?.name === 'PasswordException'
      ? 'Este PDF é protegido por senha e não pode ser aberto aqui.'
      : 'Não foi possível abrir este arquivo. Verifique se é um PDF válido.';
    setStatus('err', msg);
  }
}

async function openFile(file) {
  if (!file) return;
  if (dirty && !confirm('Há alterações não baixadas neste PDF. Abrir outro arquivo mesmo assim?')) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  await openPdf(buf, file.name);
}

// Gera os bytes do PDF final: valores dos campos (pdf.js) + caixas de texto (pdf-lib)
async function buildPdf() {
  if (selected) stopEditing(selected);
  layoutAll();
  const withFields = await pdfDoc.saveDocument();
  return stampBoxes(withFields);
}

async function download() {
  if (!pdfDoc) return;
  downloadBtn.disabled = true;
  try {
    const bytes = await buildPdf();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.pdf$/i, '') + '-preenchido.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    dirty = false;
  } catch (err) {
    console.error(err);
    setStatus('err', 'Não foi possível gerar o PDF preenchido.' + (/encrypt/i.test(err?.message) ? ' O arquivo é protegido contra alterações.' : ''));
  } finally {
    downloadBtn.disabled = false;
  }
}

$('fileInput').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
downloadBtn.addEventListener('click', download);
$('zoomIn').addEventListener('click', () => { viewer.currentScale = Math.min(viewer.currentScale * 1.2, 5); });
$('zoomOut').addEventListener('click', () => { viewer.currentScale = Math.max(viewer.currentScale / 1.2, 0.25); });
$('zoomFit').addEventListener('click', () => { viewer.currentScaleValue = 'page-width'; });
window.addEventListener('resize', () => {
  if (!pdfDoc) return;
  if (viewer.currentScaleValue === 'page-width') viewer.currentScaleValue = 'page-width';
  requestAnimationFrame(layoutAll);
});

// Arrastar e soltar arquivo
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const file = [...(e.dataTransfer?.files || [])].find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (file) openFile(file); else if (e.dataTransfer?.files?.length) setStatus('err', 'Solte um arquivo .pdf.');
});

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// Arquivo escolhido na página inicial (editor.html?abrir=1)
if (new URLSearchParams(location.search).has('abrir')) {
  history.replaceState(null, '', location.pathname);
  const item = await takeHandoff();
  if (item) await openPdf(new Uint8Array(item.data), item.name);
}

// Exposto para testes automatizados e depuração
window.editorPdf = { openPdf, download, buildPdf, get doc() { return pdfDoc; }, get boxes() { return boxes; } };
document.documentElement.dataset.ready = 'true';
