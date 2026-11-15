<script lang="ts">
  // Organizar páginas (PLANO.md, item 2.3): reordenar, girar, excluir, duplicar e inserir páginas em branco.
  // Aceita mais de um PDF (as páginas dos novos arquivos entram no fim).
  import { onDestroy, onMount } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import PageGrid, { itemsFor, type PageItem } from './PageGrid.svelte';
  import Result from './Result.svelte';
  import { Thumbs } from './thumbs';
  import { openError, readPdfFiles, takeFiles, type OutFile, type ToolFile } from './handoff';
  import { requestOpen } from '../editor/session';
  import { baseName, type PageSpec } from '../pdf/plan';
  import { normRot } from '../editor/geom';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import Check from '@lucide/svelte/icons/check';

  const thumbs = new Thumbs();
  let sources = $state<ToolFile[]>([]);
  let items = $state<PageItem[]>([]);
  let busy = $state('');
  let error = $state('');
  let result = $state<OutFile | null>(null);
  let addInput = $state<HTMLInputElement>();

  onMount(() => { const files = takeFiles('organizar'); if (files.length) add(files); });
  onDestroy(() => { thumbs.destroy(); });

  async function addFiles(list: File[] | FileList | null | undefined) {
    error = '';
    const { ok, rejected } = await readPdfFiles(list);
    if (rejected.length) error = `Não é PDF: ${rejected.join(', ')}`;
    await add(ok);
  }

  async function add(files: ToolFile[]) {
    if (!files.length) return;
    busy = 'Abrindo…';
    try {
      for (const f of files) {
        try {
          const src = await thumbs.add(f.bytes); // só entra na lista se abrir
          sources = [...sources, f];
          items = [...items, ...itemsFor(src, thumbs.pages(src))];
        } catch (err) {
          console.error(err);
          error = openError(err, f.name);
        }
      }
    } finally {
      busy = '';
    }
  }

  function sizeOf(it: PageItem) {
    if (it.blank) return it.blank;
    const s = thumbs.size(it.src, it.index) ?? { width: 595.28, height: 841.89 };
    return normRot(it.rotate) % 180 ? { width: s.height, height: s.width } : s;
  }

  async function build() {
    error = '';
    busy = 'Gerando o PDF…';
    try {
      const { Assembler } = await import('../pdf/pages');
      const asm = await Assembler.load(sources.map((s) => s.bytes));
      const specs: PageSpec[] = items.map((it) => (it.blank
        ? { blank: true as const, width: it.blank.width, height: it.blank.height }
        : { src: it.src, index: it.index, rotate: it.rotate }));
      const bytes = await asm.build(specs);
      const name = `${baseName(sources[0].name)}-organizado.pdf`;
      result = { name, bytes, mime: 'application/pdf' };
    } catch (err) {
      console.error(err);
      error = (err as Error).name === 'EncryptedError' ? openError(err) : 'Não foi possível gerar o PDF. Tente novamente.';
    } finally {
      busy = '';
    }
  }

  async function reset() {
    result = null;
    await thumbs.destroy();
    sources = [];
    items = [];
  }
</script>

<ToolPage id="organizar" wide>
  {#if result}
    <Result files={[result]} zipName="paginas.zip" summary="{items.length} página(s) no novo PDF."
      onedit={(f) => requestOpen({ kind: 'file', bytes: f.bytes, name: f.name })} onreset={reset} />
  {:else if !sources.length}
    <FileDrop label="Escolher PDF" multiple onfiles={addFiles} />
    <p class="note">Depois de escolher, toque nas páginas para girar, excluir, duplicar ou mudar de lugar.</p>
  {:else}
    <div class="files">
      {#each sources as s, i (i)}<span class="chip">{sources.length > 1 ? `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] ?? i + 1}: ` : ''}{s.name}</span>{/each}
      <span class="chip muted">{items.length} página{items.length === 1 ? '' : 's'}</span>
    </div>
    <PageGrid bind:items {thumbs} sourceNames={sources.map((s) => s.name)} {sizeOf}>
      {#snippet extraActions()}
        <button class="act-add" onclick={() => addInput?.click()}><FilePlus size={20} aria-hidden="true" /><span>Adicionar PDF</span></button>
        <button class="button primary save" onclick={build} disabled={!!busy || !items.length}><Check size={20} aria-hidden="true" /> Gerar PDF</button>
      {/snippet}
    </PageGrid>
    <input bind:this={addInput} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="Adicionar PDF"
      onchange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ''; }}>
  {/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</ToolPage>

<style>
  .note { color: var(--muted); font-size: 14px; text-align: center; }
  .files { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .chip { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; font-size: 14px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip.muted { color: var(--muted); }
  .act-add {
    display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 10px; border: 1px solid var(--border);
    border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .save { margin-left: auto; }
  @media (max-width: 640px) {
    .act-add { flex-direction: column; gap: 2px; min-height: 52px; padding: 2px 6px; font-size: 12px; border: 0; flex: 1 0 52px; }
    .save { flex-basis: 100%; margin-top: 4px; }
  }
</style>
