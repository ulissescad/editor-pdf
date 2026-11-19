<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { onMount } from 'svelte';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';
  import type { EditorState } from './state.svelte';

  let { ed, onclose }: { ed: EditorState; onclose: () => void } = $props();
  let query = $state('');
  let input: HTMLInputElement;

  onMount(() => input.focus());

  const result = $derived.by(() => {
    if (!query.trim()) return '';
    if (ed.find.state === 'pending') return t('Buscando…');
    if (ed.find.state === 'notfound' || ed.find.total === 0) return t('Nada encontrado');
    return t('{i} de {n}', { i: ed.find.current, n: ed.find.total });
  });

  function search(again = false, previous = false) {
    if (query.trim()) ed.view?.find(query, { again, previous });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); search(true, e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function close() {
    ed.view?.closeFind();
    onclose();
  }
</script>

<div class="search" role="search">
  <input bind:this={input} bind:value={query} type="search" placeholder={t('Buscar no documento')} aria-label={t('Buscar no documento')}
    oninput={() => search()} onkeydown={onKeydown} enterkeyhint="search">
  <span class="result" aria-live="polite">{result}</span>
  <button class="icon" aria-label={t('Resultado anterior')} onclick={() => search(true, true)}><ChevronUp size={20} /></button>
  <button class="icon" aria-label={t('Próximo resultado')} onclick={() => search(true)}><ChevronDown size={20} /></button>
  <button class="icon" aria-label={t('Fechar busca')} onclick={close}><X size={20} /></button>
</div>

<style>
  .search { display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
  input { flex: 1; min-width: 0; height: 40px; border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; background: var(--surface-2); color: var(--text); font: inherit; }
  .result { color: var(--muted); font-size: 14px; white-space: nowrap; min-width: 4em; text-align: center; }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 8px; background: none; color: var(--text); cursor: pointer; }
  .icon:hover { background: var(--surface-2); }
  @media (pointer: coarse) { .icon { width: 44px; height: 44px; } }
</style>
