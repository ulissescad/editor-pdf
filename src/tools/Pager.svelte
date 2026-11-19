<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  // Navegar entre páginas (prévias e tarja): ‹ Página 2 de 5 ›
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  let { index = $bindable(0), pages, label = t('Página') }: { index?: number; pages: number; label?: string } = $props();
</script>

<div class="pager">
  <button type="button" class="button small" aria-label={t('Página anterior')} disabled={index <= 0} onclick={() => (index = Math.max(0, index - 1))}>
    <ChevronLeft size={20} aria-hidden="true" />
  </button>
  <span aria-live="polite">{t('{label} {i} de {n}', { label, i: index + 1, n: pages })}</span>
  <button type="button" class="button small" aria-label={t('Próxima página')} disabled={index >= pages - 1} onclick={() => (index = Math.min(pages - 1, index + 1))}>
    <ChevronRight size={20} aria-hidden="true" />
  </button>
</div>

<style>
  .pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 10px 0; font-weight: 600; }
  .pager .button { min-width: var(--tap); min-height: var(--tap); padding: 0; }
</style>
