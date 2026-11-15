<script lang="ts">
  import { TOOLS } from '../lib/tools';
  import { hrefFor } from '../lib/routes';
  import { requestOpen, readPdf } from '../editor/session';
  import DraftList from '../components/DraftList.svelte';
  import FileUp from '@lucide/svelte/icons/file-up';

  let dragging = $state(false);
  let error = $state('');
  let input: HTMLInputElement;

  // O arquivo é lido aqui e entregue ao editor na mesma página: não sai do aparelho.
  async function openInEditor(file: File | undefined) {
    error = '';
    if (!file) return;
    const bytes = await readPdf(file);
    if (!bytes) { error = 'Escolha um arquivo .pdf.'; return; }
    requestOpen({ kind: 'file', bytes, name: /\.pdf$/i.test(file.name) ? file.name : `${file.name}.pdf` });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    openInEditor([...(e.dataTransfer?.files ?? [])][0]);
  }
</script>

<section class="wrap hero">
  <div
    class="drop"
    class:dragging
    role="region"
    aria-label="Abrir PDF para editar"
    ondragover={(e) => { e.preventDefault(); dragging = true; }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
  >
    <h1>Edite seus PDFs sem enviar nada para a internet</h1>
    <p>Preencha formulários, assine e escreva em qualquer PDF. Tudo acontece aqui no seu navegador, até offline.</p>
    <button class="button primary big" onclick={() => input.click()}>
      <FileUp size={22} aria-hidden="true" />
      Abrir PDF para editar
    </button>
    <input bind:this={input} type="file" accept="application/pdf,.pdf" hidden
      onchange={(e) => openInEditor(e.currentTarget.files?.[0])}>
    <p class="hint">ou arraste o arquivo para esta área</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>

  <DraftList onopen={(hash) => requestOpen({ kind: 'draft', hash })} />
</section>

<section class="wrap" aria-labelledby="ferramentas">
  <h2 id="ferramentas">Ferramentas</h2>
  <ul class="grid">
    {#each TOOLS as tool (tool.id)}
      {@const Icon = tool.icon}
      <li>
        <a class="card" href={hrefFor({ name: 'tool', id: tool.id })}>
          <span class="icon"><Icon size={24} aria-hidden="true" /></span>
          <span class="name">{tool.name}</span>
          <span class="desc">{tool.description}</span>
          {#if !tool.ready}<span class="badge">Em breve</span>{/if}
        </a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .hero { padding-top: 20px; }
  .drop {
    background: var(--surface); border: 2px dashed var(--border); border-radius: 16px;
    padding: 28px 20px; text-align: center;
  }
  .drop.dragging { border-color: var(--accent); background: var(--accent-soft); }
  h1 { font-size: clamp(22px, 5vw, 32px); line-height: 1.2; margin: 0 0 8px; }
  .drop > p { color: var(--muted); margin: 0 auto 20px; max-width: 52ch; }
  .big { min-height: 52px; font-size: 17px; padding: 0 24px; }
  .drop .hint { margin: 12px auto 0; font-size: 14px; }
  .error { color: var(--err-text); font-weight: 600; }
  h2 { font-size: 20px; margin: 28px 0 12px; }
  .grid {
    list-style: none; margin: 0; padding: 0;
    display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }
  @media (max-width: 520px) {
    .grid { grid-template-columns: 1fr 1fr; gap: 10px; }
  }
  .card {
    position: relative; display: flex; flex-direction: column; gap: 4px; height: 100%;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px; color: var(--text); text-decoration: none;
  }
  .card:hover { border-color: var(--accent); }
  .icon {
    display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center;
    border-radius: 10px; background: var(--accent-soft); color: var(--accent); margin-bottom: 6px;
  }
  .name { font-weight: 700; }
  .desc { color: var(--muted); font-size: 14px; line-height: 1.35; }
  .badge {
    position: absolute; top: 12px; right: 12px; font-size: 12px; font-weight: 600;
    color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
  }
  @media (max-width: 520px) {
    .card { padding: 12px; }
    .desc { font-size: 13px; }
    .badge { position: static; align-self: flex-start; margin-top: 6px; }
  }
</style>
