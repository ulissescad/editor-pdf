<script lang="ts">
  import { FONTS, type Align, type FontId } from './model';
  import type { EditorState } from './state.svelte';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import AlignStart from '@lucide/svelte/icons/text-align-start';
  import AlignCenter from '@lucide/svelte/icons/text-align-center';
  import AlignEnd from '@lucide/svelte/icons/text-align-end';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash from '@lucide/svelte/icons/trash';

  let { ed }: { ed: EditorState } = $props();

  const SWATCHES = ['#000000', '#1a3cc8', '#c62828', '#2e7d32'];
  const ALIGNS: { value: Align; label: string; icon: typeof AlignStart }[] = [
    { value: 'left', label: 'Alinhar à esquerda', icon: AlignStart },
    { value: 'center', label: 'Centralizar', icon: AlignCenter },
    { value: 'right', label: 'Alinhar à direita', icon: AlignEnd },
  ];
  const s = $derived(ed.style);

  // Botões que não tiram o foco do texto em edição
  const keepFocus = (e: PointerEvent) => e.preventDefault();
  const setSize = (v: number) => { if (v >= 4 && v <= 96) ed.setStyle({ size: Math.round(v * 2) / 2 }); };
</script>

<div class="props" role="toolbar" aria-label="Formatação do texto">
  <select aria-label="Fonte" value={s.font} onchange={(e) => ed.setStyle({ font: e.currentTarget.value as FontId })}>
    {#each Object.entries(FONTS) as [id, f] (id)}<option value={id}>{f.label}</option>{/each}
  </select>

  <div class="group" role="group" aria-label="Tamanho da fonte">
    <button class="icon" aria-label="Diminuir fonte" onpointerdown={keepFocus} onclick={() => setSize(s.size - 1)}><Minus size={18} /></button>
    <input aria-label="Tamanho em pontos" type="number" min="4" max="96" step="0.5" value={s.size}
      onchange={(e) => setSize(Number(e.currentTarget.value))}>
    <button class="icon" aria-label="Aumentar fonte" onpointerdown={keepFocus} onclick={() => setSize(s.size + 1)}><Plus size={18} /></button>
  </div>

  <div class="group" role="group" aria-label="Estilo">
    <button class="icon" aria-label="Negrito" aria-pressed={s.bold} onpointerdown={keepFocus} onclick={() => ed.setStyle({ bold: !s.bold })}><b>N</b></button>
    <button class="icon" aria-label="Itálico" aria-pressed={s.italic} onpointerdown={keepFocus} onclick={() => ed.setStyle({ italic: !s.italic })}><i>I</i></button>
  </div>

  <div class="group" role="group" aria-label="Alinhamento">
    {#each ALIGNS as a (a.value)}
      {@const Icon = a.icon}
      <button class="icon" aria-label={a.label} aria-pressed={s.align === a.value} onpointerdown={keepFocus}
        onclick={() => ed.setStyle({ align: a.value })}><Icon size={18} /></button>
    {/each}
  </div>

  <div class="group" role="group" aria-label="Cor">
    {#each SWATCHES as c (c)}
      <button class="swatch" aria-label="Cor {c}" aria-pressed={s.color === c} style:--c={c} onpointerdown={keepFocus}
        onclick={() => ed.setStyle({ color: c })}></button>
    {/each}
    <input class="color" type="color" aria-label="Outra cor" value={s.color} oninput={(e) => ed.setStyle({ color: e.currentTarget.value })}>
  </div>

  {#if ed.selected}
    <div class="group" role="group" aria-label="Caixa selecionada">
      <button class="icon" aria-label="Duplicar" title="Duplicar (Ctrl+D)" onclick={() => ed.duplicate()}><Copy size={18} /></button>
      <button class="icon danger" aria-label="Excluir" title="Excluir (Delete)" onclick={() => ed.remove()}><Trash size={18} /></button>
    </div>
  {/if}
</div>

<style>
  .props { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .group { display: flex; align-items: center; gap: 2px; }
  select, input[type="number"] {
    height: 40px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit;
  }
  select { padding: 0 6px; max-width: 170px; }
  input[type="number"] { width: 58px; text-align: center; padding: 0 2px; }
  .icon {
    display: inline-flex; align-items: center; justify-content: center; min-width: 40px; height: 40px;
    border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text); font: 600 17px/1 Georgia, serif; cursor: pointer;
  }
  .icon:hover { border-color: var(--border); }
  .icon[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .danger { color: var(--err-text); }
  .swatch { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--surface); background: var(--c); box-shadow: 0 0 0 1px var(--border); cursor: pointer; margin: 0 2px; }
  .swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
  .color { width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; background: var(--surface); cursor: pointer; }
  @media (pointer: coarse) {
    .icon { min-width: 44px; height: 44px; }
    select, input[type="number"] { height: 44px; }
    .swatch { width: 34px; height: 34px; }
  }
</style>
