<script lang="ts">
  import { findTool } from '../lib/tools';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  let { id }: { id: string } = $props();
  const tool = $derived(findTool(id));
</script>

<section class="wrap page">
  <a class="back" href="#/"><ArrowLeft size={18} aria-hidden="true" /> Todas as ferramentas</a>

  {#if tool}
    {@const Icon = tool.icon}
    <div class="box">
      <span class="icon"><Icon size={32} aria-hidden="true" /></span>
      <h1>{tool.name}</h1>
      <p>{tool.description}</p>
      <p class="soon">Esta ferramenta está em desenvolvimento e chega numa próxima versão do site.</p>
      <a class="button primary" href="#/editor">Abrir um PDF no editor</a>
    </div>
  {:else}
    <div class="box">
      <h1>Ferramenta não encontrada</h1>
      <p>O endereço pode estar incorreto.</p>
      <a class="button" href="#/">Ver todas as ferramentas</a>
    </div>
  {/if}
</section>

<style>
  .page { padding-top: 16px; }
  .back { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); text-decoration: none; font-weight: 600; }
  .box { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px 20px; text-align: center; }
  .icon { display: inline-flex; width: 64px; height: 64px; align-items: center; justify-content: center; border-radius: 16px; background: var(--accent-soft); color: var(--accent); }
  h1 { font-size: 24px; margin: 12px 0 4px; }
  p { color: var(--muted); margin: 0 auto 12px; max-width: 48ch; }
  .soon { color: var(--warn-text); background: var(--warn-bg); border-radius: 8px; padding: 8px 12px; display: inline-block; }
</style>
