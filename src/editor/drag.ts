// Arrastar para mover e alças para redimensionar, comum a todos os objetos.
// Um toque sem arrastar chama onTap (entrar na edição, marcar a caixa de seleção…).
import { clamp, type Obj } from './model';
import type { EditorState } from './state.svelte';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

export interface DragOptions {
  ed: EditorState;
  obj: Obj;
  scale: number;            // px por pt na tela
  mode: string;             // 'move' ou uma alça (n, ne, e…)
  minW: number;
  minH: number;
  aspect?: boolean;         // cantos mantêm a proporção
  onTap?: (ev: PointerEvent) => void;
}

export function startDrag(e: PointerEvent, { ed, obj, scale: s, mode, minW, minH, aspect, onTap }: DragOptions) {
  const [px0, py0, px1, py1] = ed.pageBounds(obj.page);
  const start = { cx: e.clientX, cy: e.clientY, ...obj.rect };
  const right = start.x + start.w, bottom = start.y - start.h;
  const el = e.target as HTMLElement;
  let moved = false;
  el.setPointerCapture?.(e.pointerId);

  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - start.cx, ev.clientY - start.cy) < 4) return;
    moved = true;
    const dx = (ev.clientX - start.cx) / s, dy = (ev.clientY - start.cy) / s; // pt; dy > 0 = para baixo
    if (mode === 'move') {
      obj.rect.x = clamp(start.x + dx, px0, px1 - start.w);
      obj.rect.y = clamp(start.y - dy, py0 + start.h, py1);
      return;
    }
    if (aspect && mode.length === 2) {
      // Canto com proporção: o canto oposto fica parado
      const east = mode.includes('e'), south = mode.includes('s');
      const kx = (start.w + (east ? dx : -dx)) / start.w;
      const ky = (start.h + (south ? dy : -dy)) / start.h;
      const kMin = Math.max(minW / start.w, minH / start.h);
      const kMax = Math.min(
        east ? (px1 - start.x) / start.w : (right - px0) / start.w,
        south ? (start.y - py0) / start.h : (py1 - bottom) / start.h,
      );
      const k = clamp(Math.max(kx, ky), kMin, kMax);
      const w = start.w * k, h = start.h * k;
      obj.rect = { x: east ? start.x : right - w, y: south ? start.y : bottom + h, w, h };
      return;
    }
    let { x, y, w, h } = start;
    if (mode.includes('e')) w = clamp(start.w + dx, minW, px1 - start.x);
    if (mode.includes('w')) { x = clamp(start.x + dx, px0, right - minW); w = right - x; }
    if (mode.includes('s')) h = clamp(start.h + dy, minH, start.y - py0);
    if (mode.includes('n')) { y = clamp(start.y - dy, bottom + minH, py1); h = y - bottom; }
    obj.rect = { x, y, w, h };
  };
  const onUp = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    if (moved) ed.commit();
    else if (ev.type === 'pointerup') onTap?.(ev);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}
