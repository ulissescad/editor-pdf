// Reordenar arrastando, com mouse, caneta ou dedo (sem biblioteca).
// - Mouse/caneta: arrasta o item inteiro (um clique sem arrastar continua sendo clique).
// - Toque: arrasta pela alça (o resto do item rola a página normalmente).
// Durante o arraste a lista é reordenada ao vivo (onmove) e a área rola sozinha perto das bordas.

export interface SortableOptions {
  item: string;                         // seletor dos itens (filhos diretos ou não do container)
  handle?: string;                      // seletor da alça para toque
  onmove: (from: number, to: number) => void;
  onend?: () => void;
}

function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

export function sortable(node: HTMLElement, options: SortableOptions) {
  let opts = options;
  let suppressClick = false;

  const items = () => [...node.querySelectorAll<HTMLElement>(opts.item)];

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>(opts.item);
    if (!el || !node.contains(el)) return;
    const onHandle = !!opts.handle && !!target.closest(opts.handle);
    if (e.pointerType === 'touch' && !onHandle) return;
    if (target.closest('input, select, textarea, a, [data-nodrag]') && !onHandle) return;
    if (onHandle) e.preventDefault();

    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let current = items().indexOf(el);
    let lastX = startX, lastY = startY;
    let raf = 0;
    const scroller = scrollParent(node);

    const autoScroll = () => {
      raf = 0;
      if (!dragging) return;
      const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      const bottom = scroller === document.scrollingElement ? window.innerHeight : scroller.getBoundingClientRect().bottom;
      const edge = 64;
      const dy = lastY < top + edge ? -12 : lastY > bottom - edge ? 12 : 0;
      if (dy) {
        scroller.scrollBy(0, dy);
        hover(lastX, lastY);
        raf = requestAnimationFrame(autoScroll);
      }
    };

    const hover = (x: number, y: number) => {
      const over = document.elementFromPoint(x, y)?.closest<HTMLElement>(opts.item);
      if (!over || over === el || !node.contains(over)) return;
      const to = items().indexOf(over);
      if (to < 0 || to === current) return;
      opts.onmove(current, to);
      current = to;
    };

    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX; lastY = ev.clientY;
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
        dragging = true;
        el.classList.add('sorting');
        try { el.setPointerCapture(ev.pointerId); } catch { /* sem captura: segue pela janela */ }
      }
      ev.preventDefault();
      hover(ev.clientX, ev.clientY);
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (raf) cancelAnimationFrame(raf);
      if (dragging) {
        el.classList.remove('sorting');
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
        opts.onend?.();
      }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // Depois de arrastar, o navegador ainda dispara um clique: não deve selecionar nada
  function onClick(e: MouseEvent) {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('click', onClick, true);
  return {
    update(next: SortableOptions) { opts = next; },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('click', onClick, true);
    },
  };
}

/** Move um item de uma posição para outra (novo array). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}
