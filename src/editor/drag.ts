// Arrastar para mover e alças para redimensionar, comum a todos os objetos.
// Um toque sem arrastar chama onTap (entrar na edição, marcar a caixa de seleção…).
// As contas são feitas na página como se vê (geom.ts), então funcionam igual em páginas giradas.
import { clamp, type Obj } from './model';
import { fromView, toView, turnOf, viewSize } from './geom';
import type { EditorState } from './state.svelte';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

export interface DragOptions {
  ed: EditorState;
  obj: Obj;
  scale: number;            // px por pt na tela
  mode: string;             // 'move' ou uma alça (n, ne, e…)
  minW: number;             // tamanho mínimo do conteúdo (sem giro), em pt
  minH: number;
  aspect?: boolean;         // cantos mantêm a proporção
  onTap?: (ev: PointerEvent) => void;
  onLongPress?: (x: number, y: number) => void;  // dedo ou caneta parado: menu do objeto
}

export const LONG_PRESS_MS = 500;

/**
 * Toque longo (dedo ou caneta, sem mexer): chama `onLong`. Com o mouse não vale (há o clique direito,
 * e segurar o botão antes de arrastar não pode abrir menu).
 */
export function watchLongPress(e: PointerEvent, onLong: (x: number, y: number) => void) {
  const none = { fired: () => false, cancel: () => {} };
  if (e.pointerType === 'mouse') return none;
  const el = e.target as HTMLElement;
  const x0 = e.clientX, y0 = e.clientY;
  let fired = false;
  const cancel = () => {
    clearTimeout(timer);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', cancel);
    el.removeEventListener('pointercancel', cancel);
  };
  const onMove = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) cancel(); };
  const timer = setTimeout(() => { fired = true; cancel(); onLong(x0, y0); }, LONG_PRESS_MS);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  return { fired: () => fired, cancel };
}

export function startDrag(e: PointerEvent, { ed, obj, scale: s, mode, minW, minH, aspect, onTap, onLongPress }: DragOptions) {
  const geo = ed.geo(obj.page);
  const [pw, ph] = viewSize(geo);
  // Conteúdo deitado na tela: a largura mínima dele vira altura mínima da caixa
  if (turnOf(obj.rot, geo.rotate) % 180) [minW, minH] = [minH, minW];
  const start = toView(obj.rect, geo);
  const cx = e.clientX, cy = e.clientY;
  const right = start.x + start.w, bottom = start.y + start.h;
  const el = e.target as HTMLElement;
  let moved = false;
  el.setPointerCapture?.(e.pointerId);
  const press = onLongPress && mode === 'move' ? watchLongPress(e, onLongPress) : null;

  const set = (x: number, y: number, w: number, h: number) => { obj.rect = fromView({ x, y, w, h }, geo); };

  const onMove = (ev: PointerEvent) => {
    if (press?.fired()) return; // o menu abriu: o objeto fica parado
    if (!moved && Math.hypot(ev.clientX - cx, ev.clientY - cy) < 4) return;
    moved = true;
    press?.cancel();
    const dx = (ev.clientX - cx) / s, dy = (ev.clientY - cy) / s; // pt; dy > 0 = para baixo
    if (mode === 'move') {
      set(clamp(start.x + dx, 0, pw - start.w), clamp(start.y + dy, 0, ph - start.h), start.w, start.h);
      return;
    }
    if (aspect && mode.length === 2) {
      // Canto com proporção: o canto oposto fica parado
      const east = mode.includes('e'), south = mode.includes('s');
      const kx = (start.w + (east ? dx : -dx)) / start.w;
      const ky = (start.h + (south ? dy : -dy)) / start.h;
      const kMin = Math.max(minW / start.w, minH / start.h);
      const kMax = Math.min(
        east ? (pw - start.x) / start.w : right / start.w,
        south ? (ph - start.y) / start.h : bottom / start.h,
      );
      const k = clamp(Math.max(kx, ky), kMin, kMax);
      const w = start.w * k, h = start.h * k;
      set(east ? start.x : right - w, south ? start.y : bottom - h, w, h);
      return;
    }
    let { x, y, w, h } = start;
    if (mode.includes('e')) w = clamp(start.w + dx, minW, pw - start.x);
    if (mode.includes('w')) { x = clamp(start.x + dx, 0, right - minW); w = right - x; }
    if (mode.includes('s')) h = clamp(start.h + dy, minH, ph - start.y);
    if (mode.includes('n')) { y = clamp(start.y + dy, 0, bottom - minH); h = bottom - y; }
    set(x, y, w, h);
  };
  const onUp = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    press?.cancel();
    if (moved) ed.commit();
    else if (ev.type === 'pointerup' && !press?.fired()) onTap?.(ev);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}
