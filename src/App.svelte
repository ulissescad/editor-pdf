<script lang="ts">
  import { router } from './lib/router.svelte';
  import { pwa } from './lib/pwa.svelte';
  import Home from './routes/Home.svelte';
  import ToolSoon from './routes/ToolSoon.svelte';
  import SignTool from './routes/SignTool.svelte';
  import UpdateToast from './components/UpdateToast.svelte';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import type { Component } from 'svelte';

  const version = __APP_VERSION__;
  // O editor (com o pdf.js) só é baixado quando é aberto
  const loadEditor = () => import('./editor/Editor.svelte');
  // Ferramentas prontas, carregadas sob demanda (cada uma traz o pdf.js e/ou o pdf-lib só quando usada)
  const TOOL_VIEWS: Record<string, () => Promise<{ default: Component }>> = {
    juntar: () => import('./tools/MergeTool.svelte'),
    dividir: () => import('./tools/SplitTool.svelte'),
    organizar: () => import('./tools/OrganizeTool.svelte'),
    'imagens-para-pdf': () => import('./tools/ImagesTool.svelte'),
    'pdf-para-imagens': () => import('./tools/PdfToImagesTool.svelte'),
    comprimir: () => import('./tools/CompressTool.svelte'),
    proteger: () => import('./tools/ProtectTool.svelte'),
    desbloquear: () => import('./tools/UnlockTool.svelte'),
    'marca-dagua': () => import('./tools/WatermarkTool.svelte'),
    numerar: () => import('./tools/NumbersTool.svelte'),
    recortar: () => import('./tools/CropTool.svelte'),
    tarjar: () => import('./tools/RedactTool.svelte'),
    achatar: () => import('./tools/FlattenTool.svelte'),
    propriedades: () => import('./tools/PropertiesTool.svelte'),
  };
  const toolView = $derived(router.current.name === 'tool' ? TOOL_VIEWS[router.current.id] : undefined);
</script>

{#if router.current.name === 'editor'}
  {#await loadEditor()}
    <p class="loading">Carregando o editor…</p>
  {:then { default: Editor }}
    <Editor />
  {:catch}
    <p class="loading">Não foi possível carregar o editor. Recarregue a página.</p>
  {/await}
{:else}
  <a class="skip" href="#conteudo">Pular para o conteúdo</a>

  <header class="site-header">
    <div class="wrap bar">
      <a class="brand" href="#/">
        <img src="logo.svg" alt="" width="32" height="32">
        <span>Editor de PDF</span>
      </a>
      <span class="local" title="Os arquivos são processados só neste aparelho">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>100% no seu aparelho</span>
      </span>
    </div>
  </header>

  <main id="conteudo" tabindex="-1">
    {#if router.current.name === 'tool' && router.current.id === 'assinar'}
      <SignTool />
    {:else if toolView}
      {#key toolView}
        {#await toolView()}
          <p class="loading">Carregando a ferramenta…</p>
        {:then { default: View }}
          <View />
        {:catch}
          <p class="loading">Não foi possível carregar a ferramenta. Recarregue a página.</p>
        {/await}
      {/key}
    {:else if router.current.name === 'tool'}
      <ToolSoon id={router.current.id} />
    {:else}
      <Home />
    {/if}
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>
        Seus arquivos são processados só neste aparelho: nada é enviado para servidores, e o site não usa IA nem rastreadores.
      </p>
      <p class="meta">
        <span>Versão {version}</span>
        {#if pwa.offlineReady}<span>· Pronto para usar offline</span>{/if}
      </p>
    </div>
  </footer>
{/if}

<UpdateToast />

<style>
  .loading { padding: 32px 16px; text-align: center; color: var(--muted); }
  .skip { position: absolute; left: -999px; top: 8px; z-index: 10; background: var(--surface); padding: 8px 12px; border-radius: 8px; }
  .skip:focus { left: 8px; }
  .site-header {
    position: sticky; top: 0; z-index: 5;
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding-top: env(safe-area-inset-top);
  }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-weight: 700; font-size: 18px; }
  .local { display: inline-flex; align-items: center; gap: 6px; color: var(--ok-text); background: var(--ok-bg); border-radius: 999px; padding: 4px 10px; font-size: 13px; font-weight: 600; }
  main { outline: none; padding-bottom: 32px; }
  .site-footer { border-top: 1px solid var(--border); color: var(--muted); font-size: 14px; padding: 16px 0 calc(16px + env(safe-area-inset-bottom)); }
  .site-footer p { margin: 4px 0; }
  .meta { display: flex; gap: 6px; flex-wrap: wrap; }
  @media (max-width: 420px) {
    .local span { display: none; }
    .local { padding: 6px; }
  }
</style>
