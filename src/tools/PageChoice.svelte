<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  // “Todas as páginas” ou “Escolher” (intervalos como “1-3, 5”). `selection` = null (todas) ou índices 0-based.
  import { parseRanges } from '../pdf/plan';

  let { pages, selection = $bindable(null), label = t('Páginas') }: { pages: number; selection?: number[] | null; label?: string } = $props();

  const uid = `pc-${Math.random().toString(36).slice(2, 8)}`;
  let which = $state<'all' | 'some'>('all');
  let ranges = $state('');
  const parsed = $derived(which === 'some' && ranges.trim() ? parseRanges(ranges, pages) : null);

  $effect(() => {
    if (which === 'all') selection = null;
    else selection = parsed && 'groups' in parsed ? [...new Set(parsed.groups.flat())].sort((a, b) => a - b) : [];
  });
</script>

<div class="row">
  <span class="label" id="{uid}-l">{label}</span>
  <fieldset class="seg" aria-labelledby="{uid}-l">
    <label><input type="radio" bind:group={which} value="all"> {t('Todas')}</label>
    <label><input type="radio" bind:group={which} value="some"> {t('Escolher')}</label>
  </fieldset>
  {#if which === 'some'}
    <input type="text" inputmode="numeric" autocomplete="off" aria-label={t('Quais páginas')} bind:value={ranges} placeholder="1-3, 5">
    {#if parsed && 'error' in parsed}<p class="notice warn">{parsed.error}</p>{/if}
  {/if}
</div>
