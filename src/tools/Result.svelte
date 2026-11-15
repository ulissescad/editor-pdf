<script lang="ts">
  // Resultado de uma ferramenta: baixar (um arquivo ou um ZIP), compartilhar e continuar no editor.
  import { canShareFiles, downloadBytes, shareFiles } from '../editor/output';
  import { formatSize } from './thumbs';
  import CheckCircle from '@lucide/svelte/icons/circle-check';
  import Download from '@lucide/svelte/icons/download';
  import Share from '@lucide/svelte/icons/share-2';
  import FilePen from '@lucide/svelte/icons/file-pen';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import type { Snippet } from 'svelte';
  import type { OutFile } from './handoff';

  let {
    files, zipName, summary, onedit, onorganize, onreset, extra,
  }: {
    files: OutFile[]; zipName: string; summary?: string;
    onedit?: (f: OutFile) => void; onorganize?: (f: OutFile) => void; onreset: () => void; extra?: Snippet;
  } = $props();

  let error = $state('');
  const total = $derived(files.reduce((n, f) => n + f.bytes.length, 0));
  const asFiles = $derived(files.map((f) => new File([f.bytes as BlobPart], f.name, { type: f.mime })));
  const canShare = $derived(canShareFiles(asFiles));
  const single = $derived(files.length === 1 ? files[0] : null);

  async function download() {
    error = '';
    if (single) { downloadBytes(single.bytes, single.name, single.mime); return; }
    const { zipSync } = await import('fflate');
    // PDFs e imagens já são comprimidos: o ZIP só guarda (mais rápido, mesmo tamanho)
    const zip = zipSync(Object.fromEntries(uniqueNames(files).map((f) => [f.name, f.bytes])), { level: 0 });
    downloadBytes(zip, zipName, 'application/zip');
  }

  async function share() {
    error = '';
    try { await shareFiles(asFiles); } catch (err) {
      console.error(err);
      error = 'Não foi possível compartilhar. Use “Baixar”.';
    }
  }

  function uniqueNames(list: OutFile[]) {
    const seen = new Map<string, number>();
    return list.map((f) => {
      const n = seen.get(f.name) ?? 0;
      seen.set(f.name, n + 1);
      return n ? { ...f, name: f.name.replace(/(\.[^.]+)$/, `-${n + 1}$1`) } : f;
    });
  }
</script>

<div class="panel result" role="status">
  <p class="done"><CheckCircle size={22} aria-hidden="true" /> <strong>Pronto!</strong> {summary ?? ''}</p>
  <ul class="files">
    {#each files.slice(0, 8) as f (f.name)}
      <li><span class="name">{f.name}</span><span class="size">{formatSize(f.bytes.length)}</span></li>
    {/each}
    {#if files.length > 8}<li class="more">e mais {files.length - 8} arquivo(s)</li>{/if}
  </ul>
  {#if files.length > 1}<p class="total">{files.length} arquivos · {formatSize(total)} no total</p>{/if}
  {@render extra?.()}
  <div class="go">
    <button class="button primary" onclick={download}>
      <Download size={20} aria-hidden="true" /> {single ? 'Baixar' : 'Baixar tudo (ZIP)'}
    </button>
    {#if canShare}<button class="button" onclick={share}><Share size={20} aria-hidden="true" /> Compartilhar</button>{/if}
    {#if single && onedit}<button class="button" onclick={() => onedit(single)}><FilePen size={20} aria-hidden="true" /> Abrir no editor</button>{/if}
    {#if single && onorganize}<button class="button" onclick={() => onorganize(single)}><LayoutGrid size={20} aria-hidden="true" /> Organizar páginas</button>{/if}
    <button class="button" onclick={onreset}><RotateCcw size={20} aria-hidden="true" /> Recomeçar</button>
  </div>
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</div>

<style>
  .result { margin-top: 12px; }
  .done { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; color: var(--ok-text); }
  .files { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .files li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 10px; background: var(--surface-2); border-radius: 8px; font-size: 15px; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .size { color: var(--muted); flex: none; }
  .more, .total { color: var(--muted); font-size: 14px; }
  .total { margin: 8px 0 0; }
</style>
