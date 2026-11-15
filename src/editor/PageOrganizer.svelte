<script lang="ts">
  // “Organizar páginas” dentro do editor: a mesma grade da ferramenta Organizar, sobre o documento aberto.
  // Textos, assinaturas e campos acompanham as páginas (state.applyPages).
  import { onDestroy, onMount } from 'svelte';
  import PageGrid, { itemsFor, type PageItem } from '../tools/PageGrid.svelte';
  import { Thumbs } from '../tools/thumbs';
  import { normRot } from './geom';
  import type { EditorState } from './state.svelte';
  import type { PageSpec } from '../pdf/plan';
  import X from '@lucide/svelte/icons/x';
  import Check from '@lucide/svelte/icons/check';

  let { ed, onclose }: { ed: EditorState; onclose: () => void } = $props();

  const thumbs = new Thumbs();
  let items = $state<PageItem[]>([]);
  let ready = $state(false);
  let dialog: HTMLDivElement;

  onMount(async () => {
    if (!ed.doc) return;
    const src = await thumbs.add(ed.doc); // o documento já aberto no editor (não é fechado aqui)
    items = itemsFor(src, ed.pages);
    ready = true;
    dialog.focus();
  });
  onDestroy(() => { thumbs.destroy(); });

  const unchanged = $derived(items.every((it, i) => !it.blank && it.index === i && !normRot(it.rotate)) && items.length === ed.pages);

  function sizeOf(it: PageItem) {
    if (it.blank) return it.blank;
    const s = thumbs.size(it.src, it.index) ?? { width: 595.28, height: 841.89 };
    return normRot(it.rotate) % 180 ? { width: s.height, height: s.width } : s;
  }

  async function apply() {
    const specs: PageSpec[] = items.map((it) => (it.blank
      ? { blank: true as const, width: it.blank.width, height: it.blank.height }
      : { src: 0, index: it.index, rotate: it.rotate }));
    onclose();
    await ed.applyPages(specs);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Organizar páginas" tabindex="-1" bind:this={dialog}
  onkeydown={(e) => { if (e.key === 'Escape') onclose(); e.stopPropagation(); }}>
  <header>
    <button class="icon" aria-label="Cancelar" onclick={onclose}><X size={22} /></button>
    <strong>Organizar páginas</strong>
    <button class="apply" onclick={apply} disabled={!ready || unchanged}><Check size={18} /> Aplicar</button>
  </header>
  <div class="body">
    <p class="note">Textos, assinaturas e campos que você colocou acompanham as páginas.</p>
    {#if ready}<PageGrid bind:items {thumbs} {sizeOf} />{/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: var(--bg); color: var(--text);
    outline: none; padding-top: env(safe-area-inset-top);
  }
  header {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px; min-height: 56px;
    background: var(--surface); border-bottom: 1px solid var(--border);
  }
  header strong { flex: 1; font-size: 17px; }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 10px; background: none; color: var(--text); cursor: pointer; }
  .apply {
    display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 16px; border: 0; border-radius: 10px;
    background: var(--accent); color: var(--accent-text); font: inherit; font-weight: 700; cursor: pointer;
  }
  .apply:disabled { opacity: .5; cursor: default; }
  .body { flex: 1; overflow: auto; padding: 12px 16px 0; }
  .note { color: var(--muted); font-size: 14px; margin: 0 0 12px; }
</style>
