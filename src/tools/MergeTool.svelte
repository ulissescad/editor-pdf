<script lang="ts">
  // Juntar PDFs (PLANO.md, item 2.1): vários arquivos em um, na ordem escolhida.
  import { onDestroy, onMount } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import Result from './Result.svelte';
  import { Thumbs, formatSize, thumb } from './thumbs';
  import { moveItem, sortable } from './sortable';
  import { openError, readPdfFiles, sendToTool, takeFiles, type OutFile, type ToolFile } from './handoff';
  import { requestOpen } from '../editor/session';
  import { allPages, baseName } from '../pdf/plan';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Grip from '@lucide/svelte/icons/grip-vertical';
  import Merge from '@lucide/svelte/icons/merge';
  import Loader from '@lucide/svelte/icons/loader-circle';

  interface Entry extends ToolFile { key: number; src: number; pages: number }

  const thumbs = new Thumbs();
  let entries = $state<Entry[]>([]);
  let busy = $state('');
  let error = $state('');
  let result = $state<OutFile | null>(null);
  let seq = 0;

  onDestroy(() => { thumbs.destroy(); });

  const totalPages = $derived(entries.reduce((n, e) => n + e.pages, 0));

  // PDFs compartilhados de outro app chegam prontos
  onMount(() => { const files = takeFiles('juntar'); if (files.length) addPdfs(files); });

  async function addFiles(list: File[]) {
    error = '';
    const { ok, rejected } = await readPdfFiles(list);
    await addPdfs(ok, rejected.length ? [`Não é PDF: ${rejected.join(', ')}`] : []);
  }

  async function addPdfs(ok: ToolFile[], problems: string[] = []) {
    busy = 'Abrindo…';
    try {
      for (const f of ok) {
        try {
          const src = await thumbs.add(f.bytes);
          entries = [...entries, { ...f, key: seq++, src, pages: thumbs.pages(src) }];
        } catch (err) {
          console.error(err);
          problems.push(openError(err, f.name));
        }
      }
    } finally {
      busy = '';
    }
    error = problems.join(' ');
  }

  const move = (from: number, to: number) => { if (to >= 0 && to < entries.length) entries = moveItem(entries, from, to); };
  const remove = (key: number) => { entries = entries.filter((e) => e.key !== key); };

  async function merge() {
    error = '';
    busy = 'Juntando…';
    try {
      const { assemble } = await import('../pdf/pages');
      const bytes = await assemble(entries.map((e) => e.bytes), entries.flatMap((e, i) => allPages(i, e.pages)));
      result = { name: `${baseName(entries[0].name)}-junto.pdf`, bytes, mime: 'application/pdf' };
    } catch (err) {
      console.error(err);
      error = (err as Error).name === 'EncryptedError' ? openError(err) : 'Não foi possível juntar os arquivos. Tente novamente.';
    } finally {
      busy = '';
    }
  }

  async function reset() {
    result = null;
    entries = [];
    await thumbs.destroy();
  }
</script>

<ToolPage id="juntar">
  {#if result}
    <Result files={[result]} zipName="junto.zip" summary="{entries.length} arquivos, {totalPages} páginas."
      onedit={(f) => requestOpen({ kind: 'file', bytes: f.bytes, name: f.name })}
      onorganize={(f) => sendToTool('organizar', [f])} onreset={reset} />
  {:else}
    {#if entries.length}
      <ol class="list" aria-label="Arquivos, na ordem em que serão juntados"
        use:sortable={{ item: '.entry', handle: '.grip', onmove: move }}>
        {#each entries as e, i (e.key)}
          <li class="entry">
            <span class="grip" aria-hidden="true" title="Arraste para mudar a ordem"><Grip size={20} /></span>
            <canvas use:thumb={{ thumbs, src: e.src, index: 0, width: 56 }} width="56" height="79"></canvas>
            <span class="info">
              <span class="name">{i + 1}. {e.name}</span>
              <span class="meta">{e.pages} página{e.pages === 1 ? '' : 's'} · {formatSize(e.bytes.length)}</span>
            </span>
            <span class="btns">
              <button class="icon" aria-label="Subir {e.name}" disabled={i === 0} onclick={() => move(i, i - 1)}><ArrowUp size={20} /></button>
              <button class="icon" aria-label="Descer {e.name}" disabled={i === entries.length - 1} onclick={() => move(i, i + 1)}><ArrowDown size={20} /></button>
              <button class="icon danger" aria-label="Remover {e.name}" onclick={() => remove(e.key)}><Trash size={20} /></button>
            </span>
          </li>
        {/each}
      </ol>
    {/if}
    <FileDrop label={entries.length ? 'Adicionar PDFs' : 'Escolher PDFs'} multiple compact={entries.length > 0} onfiles={addFiles} />
    {#if entries.length === 1}<p class="note">Adicione pelo menos mais um PDF.</p>{/if}
    {#if entries.length > 1}
      <div class="go">
        <button class="button primary" onclick={merge} disabled={!!busy}><Merge size={20} aria-hidden="true" /> Juntar {entries.length} PDFs</button>
        <span class="note">{totalPages} páginas no total</span>
      </div>
    {/if}
  {/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</ToolPage>

<style>
  .list { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 8px; }
  .entry {
    display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 12px; user-select: none; -webkit-user-select: none;
  }
  .entry:global(.sorting) { opacity: .6; outline: 2px dashed var(--accent); }
  .grip { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 44px; color: var(--muted); cursor: grab; touch-action: none; flex: none; }
  canvas { width: 56px; height: auto; flex: none; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .25); }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--muted); font-size: 14px; }
  .btns { display: flex; flex: none; }
  .icon {
    display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 10px;
    background: none; color: var(--text); cursor: pointer;
  }
  .icon:hover:not(:disabled) { background: var(--surface-2); }
  .icon:disabled { opacity: .3; cursor: default; }
  .icon.danger { color: var(--err-text); }
  .note { color: var(--muted); font-size: 14px; }
  @media (max-width: 480px) {
    .btns .icon { width: 40px; }
    canvas { width: 44px; }
  }
</style>
