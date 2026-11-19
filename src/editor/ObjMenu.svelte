<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  // Menu do objeto (PLANO.md, seção 4): toque longo no celular, clique direito ou tecla de menu no computador.
  import { onMount } from 'svelte';
  import { isFixed } from './model';
  import type { EditorState } from './state.svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import Files from '@lucide/svelte/icons/files';
  import BringToFront from '@lucide/svelte/icons/bring-to-front';
  import SendToBack from '@lucide/svelte/icons/send-to-back';
  import Trash from '@lucide/svelte/icons/trash-2';
  import type { Component } from 'svelte';

  let { ed, x, y }: { ed: EditorState; x: number; y: number } = $props();

  let menu = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0 });

  const obj = $derived(ed.selected);
  // Marcações ficam presas ao texto e notas são anotações: não se copiam nem mudam de camada
  const items = $derived.by(() => {
    if (!obj) return [];
    const list: Array<{ label: string; icon: Component; run: () => void; danger?: boolean }> = [];
    if (!isFixed(obj)) {
      list.push({ label: t('Copiar'), icon: Copy, run: () => ed.copy() });
      list.push({ label: t('Duplicar'), icon: Files, run: () => ed.duplicate() });
      if (obj.kind !== 'note') {
        list.push({ label: t('Trazer para a frente'), icon: BringToFront, run: () => ed.reorder('front') });
        list.push({ label: t('Enviar para trás'), icon: SendToBack, run: () => ed.reorder('back') });
      }
    }
    list.push({ label: t('Excluir'), icon: Trash, run: () => ed.remove(), danger: true });
    return list;
  });

  const close = () => { ed.menu = null; };

  onMount(() => {
    if (!menu) return;
    const el = menu;
    // Dentro da tela, mesmo com o dedo perto da borda
    const r = el.getBoundingClientRect();
    const vw = window.visualViewport?.width ?? innerWidth, vh = window.visualViewport?.height ?? innerHeight;
    pos = { left: Math.max(8, Math.min(x, vw - r.width - 8)), top: Math.max(8, Math.min(y + 8, vh - r.height - 8)) };
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    // Fecha ao tocar fora (o toque que abriu já terminou quando o menu aparece)
    const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node)) close(); };
    const t = setTimeout(() => window.addEventListener('pointerdown', outside, true));
    window.addEventListener('resize', close);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
    };
  });

  function onKeydown(e: KeyboardEvent) {
    const all = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close();
    }
    e.stopPropagation(); // os atalhos do editor (Delete, setas) não valem com o menu aberto
  }
</script>

{#if obj}
  <div class="menu" role="menu" aria-label={t('Ações do objeto')} tabindex="-1" bind:this={menu}
    style:left="{pos.left}px" style:top="{pos.top}px" onkeydown={onKeydown}>
    {#each items as item (item.label)}
      {@const Icon = item.icon}
      <button type="button" role="menuitem" class:danger={item.danger} onclick={() => { close(); item.run(); }}>
        <Icon size={18} aria-hidden="true" /> {item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed; z-index: 40; min-width: 210px; padding: 6px; display: grid;
    background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .25);
  }
  button {
    display: flex; align-items: center; gap: 10px; min-height: var(--tap); padding: 0 12px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer;
  }
  button:hover, button:focus-visible { background: var(--surface-2); outline: none; }
  button:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  .danger { color: var(--err-text); }
</style>
