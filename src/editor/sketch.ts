// Gestos das ferramentas de desenho (Destacar, Caneta e Formas): um dedo, a caneta ou o mouse desenha.
// No celular a rolagem nativa fica desligada nessas ferramentas; dois dedos rolam e dão zoom (viewer.ts),
// e um segundo dedo no meio de um traço cancela o traço.
import { clamp } from './model';
import { fromView, normRot, toView, viewSize, viewToUser, type VRect } from './geom';
import {
  HIGHLIGHT_OPACITY, MARKER, WHITEOUT, isLineShape, markupRects, packLine, shapeGeometry, smoothPath, thinPoints,
} from './draw';
import { caretAt, selectBetween, wordAt, type Caret, type TextRun, type TextSelection } from './textsel';
import type { EditorState } from './state.svelte';

/** O que mostrar enquanto se desenha, em pt na página vista. */
export type Preview = { page: number } & (
  | { kind: 'path'; d: string; color: string; width: number; opacity?: number }
  | { kind: 'shape'; x: number; y: number; stroke?: string; fill?: string; color: string; width: number }
  | { kind: 'rects'; rects: VRect[]; color: string; opacity: number }
);

export function startSketch(e: PointerEvent, ed: EditorState, page: number, show: (p: Preview | null) => void) {
  const view = ed.view;
  if (!view) return;
  const tool = ed.tool;
  const g = ed.geo(page);
  const [pw, ph] = viewSize(g);
  const s = view.scaleOf(page);
  const at = (ev: PointerEvent): [number, number] => {
    const [x, y] = view.clientToView(page, ev.clientX, ev.clientY);
    return [clamp(x, 0, pw), clamp(y, 0, ph)];
  };
  const start = at(e);
  let last = start;
  let moved = false;
  e.preventDefault(); // sem seleção nativa de texto nem arrastar imagem

  // ---------- caneta ----------
  const pts = [...start];
  const inkColor = ed.inkMarker ? MARKER.color : ed.inkColor;
  const inkWidth = ed.inkMarker ? MARKER.width : ed.inkWidth;
  const inkOpacity = ed.inkMarker ? MARKER.opacity : undefined;

  // ---------- destacar ----------
  let runs: TextRun[] | null = null;
  let anchor: Caret | null = null;     // onde o arraste começou, no texto
  let sel: TextSelection | null = null;
  let mode: 'text' | 'rect' | null = null;
  const markRot = normRot(g.rotate) || undefined;
  const user = (p: [number, number]) => viewToUser(p[0], p[1], g);
  const tol = Math.max(4, 16 / s); // tolerância do toque: 16 px na tela
  if (tool === 'markup') {
    ed.textRuns(page).then((r) => {
      runs = r;
      const [ux, uy] = user(start);
      anchor = caretAt(runs, ux, uy, ed.measure, tol);
      mode = anchor ? 'text' : 'rect';
      update();
    });
  }

  function markPreview(quads: TextSelection['quads'], rot: number | undefined) {
    const type = ed.markupType;
    const rects = markupRects({ type, quads, rot: rot as 0 | 90 | 180 | 270 | undefined }).map((r) => toView(r, g));
    show({ page, kind: 'rects', rects, color: ed.markupColors[type], opacity: type === 'highlight' ? HIGHLIGHT_OPACITY : 1 });
  }

  function update() {
    if (tool === 'ink') {
      show({ page, kind: 'path', d: smoothPath(pts), color: inkColor, width: inkWidth, opacity: inkOpacity });
    } else if (tool === 'shape') {
      const shape = ed.shapeType;
      const color = shape === 'whiteout' ? WHITEOUT : ed.shapeColor;
      if (isLineShape(shape)) {
        const { box, ends } = packLine(start, last, ed.shapeWidth, shape === 'arrow');
        show({ page, kind: 'shape', x: box.x, y: box.y, ...shapeGeometry({ shape, width: ed.shapeWidth, ends }, box.w, box.h), color, width: ed.shapeWidth });
      } else {
        const v = box();
        show({ page, kind: 'shape', x: v.x, y: v.y, ...shapeGeometry({ shape, width: ed.shapeWidth }, v.w, v.h), color, width: ed.shapeWidth });
      }
    } else if (tool === 'markup' && runs && moved) {
      if (mode === 'text' && anchor) {
        const [ux, uy] = user(last);
        const end = caretAt(runs, ux, uy, ed.measure);
        sel = end ? selectBetween(runs, anchor, end, ed.measure) : null;
        if (sel) markPreview(sel.quads, sel.rot || undefined); else show(null);
      } else {
        markPreview([fromView(box(), g)], markRot);
      }
    }
  }

  const box = (): VRect => ({
    x: Math.min(start[0], last[0]), y: Math.min(start[1], last[1]),
    w: Math.abs(last[0] - start[0]), h: Math.abs(last[1] - start[1]),
  });

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const events = tool === 'ink' ? (ev.getCoalescedEvents?.() ?? []) : [];
    for (const ce of events.length ? events : [ev]) {
      const p = at(ce);
      if (!moved && Math.hypot(p[0] - start[0], p[1] - start[1]) * s < 3) continue;
      moved = true;
      last = p;
      if (tool === 'ink' && Math.hypot(p[0] - pts[pts.length - 2], p[1] - pts[pts.length - 1]) * s >= 1.5) pts.push(...p);
    }
    if (moved) update();
  };

  // Um segundo dedo na tela: é rolagem/zoom, não desenho
  const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) end(null); };

  const finish = async (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    end(ev.type === 'pointerup' ? ev : null);
  };

  let done = false;
  async function end(ev: PointerEvent | null) {
    if (done) return;
    done = true;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    window.removeEventListener('pointerdown', onOtherDown, true);
    if (!ev) { show(null); return; }
    last = at(ev);
    if (tool === 'ink') {
      ed.addInkStroke(page, thinPoints(pts.length > 2 ? pts : [...pts, ...last], 1 / s));
    } else if (tool === 'shape') {
      if (moved) ed.addShape(page, start, last);
    } else if (tool === 'markup') {
      if (!runs) {
        runs = await ed.textRuns(page);
        const [ux, uy] = user(start);
        anchor = caretAt(runs, ux, uy, ed.measure, tol);
        mode = anchor ? 'text' : 'rect';
      }
      if (mode === 'text' && anchor) {
        const [ux, uy] = user(last);
        const endCaret = caretAt(runs, ux, uy, ed.measure);
        // Toque sem arrastar: marca a palavra tocada
        const picked = moved && endCaret ? selectBetween(runs, anchor, endCaret, ed.measure) : wordAt(runs, anchor, ed.measure);
        if (picked) ed.addMarkup(page, picked);
      } else if (moved) {
        const v = box();
        if (v.w >= 4 && v.h >= 4) ed.addMarkup(page, v);
      }
    }
    show(null);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  window.addEventListener('pointerdown', onOtherDown, true);
}
