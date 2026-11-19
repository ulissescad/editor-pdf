<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  // Moldura comum das ferramentas: voltar, ícone, título, descrição e o conteúdo da ferramenta.
  import type { Snippet } from 'svelte';
  import { findTool } from '../lib/tools';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  let { id, children, wide = false }: { id: string; children: Snippet; wide?: boolean } = $props();
  const tool = $derived(findTool(id)!);
</script>

<section class="wrap page" class:wide>
  <a class="back" href="#/"><ArrowLeft size={18} aria-hidden="true" /> {t('Todas as ferramentas')}</a>
  <header class="head">
    {#if tool}
      {@const Icon = tool.icon}
      <span class="icon"><Icon size={26} aria-hidden="true" /></span>
      <div>
        <h1>{t(tool.name)}</h1>
        <p>{t(tool.description)}</p>
      </div>
    {/if}
  </header>
  {@render children()}
</section>

<style>
  .page { padding-top: 16px; }
  .page.wide { max-width: 1240px; }
  .back { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); text-decoration: none; font-weight: 600; }
  .head { display: flex; align-items: center; gap: 14px; margin: 4px 0 16px; }
  .icon {
    display: inline-flex; width: 52px; height: 52px; flex: none; align-items: center; justify-content: center;
    border-radius: 14px; background: var(--accent-soft); color: var(--accent);
  }
  h1 { font-size: 24px; margin: 0; line-height: 1.2; }
  .head p { margin: 2px 0 0; color: var(--muted); }
</style>
