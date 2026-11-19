// Teclado virtual do celular (PLANO.md, seção 4): a caixa em edição não pode ficar escondida atrás dele.
// O teclado encolhe a área visível (visualViewport) sem mudar o tamanho da página no iOS, então
// rolar até o “centro da tela” não basta: a conta usa a área que sobra acima do teclado.

/** Quanto rolar (px, positivo = para baixo) para o trecho [top, bottom] caber em [viewTop, viewBottom]. */
export function scrollToFit(top: number, bottom: number, viewTop: number, viewBottom: number, margin = 12): number {
  const lo = viewTop + margin, hi = viewBottom - margin;
  if (bottom - top > hi - lo) return top - lo;   // maior que a área: mostra o começo (onde se digita)
  if (bottom > hi) return bottom - hi;
  if (top < lo) return top - lo;
  return 0;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Mantém `el` visível acima do teclado enquanto ele estiver aberto. Devolve a função que para de vigiar.
 * Só age em telas de toque (no computador não há teclado virtual).
 */
export function keepAboveKeyboard(el: HTMLElement): () => void {
  if (!matchMedia('(pointer: coarse)').matches) return () => {};
  const vv = window.visualViewport;
  const fit = () => {
    const scroller = scrollParent(el);
    if (!vv || !scroller) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    // Área visível: a interseção do visualizador com o que sobra acima do teclado
    const top = Math.max(s.top, vv.offsetTop), bottom = Math.min(s.bottom, vv.offsetTop + vv.height);
    const d = scrollToFit(r.top, r.bottom, top, bottom);
    if (Math.abs(d) > 1) scroller.scrollBy({ top: d });
  };
  // O teclado leva um instante para abrir; depois disso, cada mudança de tamanho reajusta
  const t = setTimeout(fit, 350);
  vv?.addEventListener('resize', fit);
  return () => {
    clearTimeout(t);
    vv?.removeEventListener('resize', fit);
  };
}
