<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { watchLongPress } from './drag';
  import type { MarkupObj } from './model';
  import { HIGHLIGHT_OPACITY, MARKUP_NAMES, markupRects } from './draw';
  import { toView, type VRect } from './geom';
  import type { EditorState } from './state.svelte';

  // Destaque, sublinhado ou riscado. Fica preso ao texto: toque seleciona (para trocar a cor ou excluir),
  // mas não se arrasta. Só as linhas marcadas recebem o toque; o resto da caixa deixa passar.
  let { obj, ed }: { obj: MarkupObj; ed: EditorState } = $props();

  const selected = $derived(ed.selectedId === obj.id);
  const geo = $derived.by(() => {
    void ed.layoutTick; // recalcula quando o zoom ou a página mudam
    const view = ed.view;
    const g = ed.geo(obj.page);
    const s = view?.scaleOf(obj.page) ?? 1;
    const box = toView(obj.rect, g);
    const [left, top] = view?.viewToContainer(obj.page, box.x, box.y) ?? [0, 0];
    const rel = (v: VRect) => ({ left: (v.x - box.x) * s, top: (v.y - box.y) * s, width: v.w * s, height: v.h * s });
    return {
      left, top, width: box.w * s, height: box.h * s,
      paint: markupRects(obj).map((r) => rel(toView(r, g))),
      hit: obj.quads.map((q) => rel(toView(q, g))),
    };
  });

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ed.select(obj.id);
    watchLongPress(e, (x, y) => ed.openMenu(obj.id, x, y));
  }
</script>

<!-- Pelo teclado: Delete apaga o selecionado (Editor.svelte) -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mbox" class:selected data-id={obj.id} role="group" aria-label="{t(MARKUP_NAMES[obj.type])}{obj.text ? `: ${obj.text}` : ''}"
  style:left="{geo.left}px" style:top="{geo.top}px" style:width="{geo.width}px" style:height="{geo.height}px"
  onpointerdown={onPointerDown}>
  {#each geo.paint as r, i (i)}
    <div class="paint" style:left="{r.left}px" style:top="{r.top}px" style:width="{r.width}px" style:height="{r.height}px"
      style:background={obj.color} style:opacity={obj.type === 'highlight' ? HIGHLIGHT_OPACITY : 1}></div>
  {/each}
  {#each geo.hit as r, i (i)}
    <div class="hit" style:left="{r.left}px" style:top="{r.top}px" style:width="{r.width}px" style:height="{r.height}px"></div>
  {/each}
</div>

<style>
  .mbox { position: absolute; pointer-events: none; }
  .mbox.selected { outline: 1.5px dashed #2457d6; outline-offset: 2px; }
  .paint, .hit { position: absolute; }
  .hit { pointer-events: auto; cursor: pointer; -webkit-touch-callout: none; }
</style>
