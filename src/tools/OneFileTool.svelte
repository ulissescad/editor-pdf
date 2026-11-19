<script lang="ts" module>
  import type { PDFDocumentProxy } from '../pdf/pdfjs';
  import type { OutFile } from './handoff';

  /** O PDF escolhido: bytes e, se a ferramenta pediu, o documento aberto no pdf.js. */
  export interface Picked { name: string; bytes: Uint8Array; pages: number; doc: PDFDocumentProxy | null }
  export interface RunResult { files: OutFile[]; summary?: string; note?: string; editable?: boolean }
  export type Progress = (text: string) => void;
</script>

<script lang="ts">
  import { t, tn } from '../lib/i18n.svelte';
  // Moldura das ferramentas de um arquivo só (M5): escolher o PDF → opções → resultado.
  // Cuida de abrir o arquivo, do aviso de PDF com senha (com atalho para “Desbloquear”), do progresso,
  // dos erros e da tela de resultado. Cada ferramenta só descreve as opções e o que fazer.
  import { onDestroy, onMount, type Component, type Snippet } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import Result from './Result.svelte';
  import { formatSize } from './thumbs';
  import { readPdfFiles, sendToTool, takeFiles, type ToolFile } from './handoff';
  import { bigFileNote, requestOpen } from '../editor/session';
  import { closePdf, openPdf } from '../pdf/pdfjs';
  import { baseName } from '../pdf/plan';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import LockOpen from '@lucide/svelte/icons/lock-open';

  let {
    id, action, icon: Icon, run, options, canRun = true, open = true, wide = false,
    onpick, onclear, after,
  }: {
    id: string;
    action: string;                 // texto do botão principal
    icon: Component;
    run: (f: Picked, progress: Progress) => Promise<RunResult>;
    options?: Snippet<[Picked]>;
    canRun?: boolean;
    open?: boolean;                 // abrir com o pdf.js (páginas, prévia); false = só os bytes
    wide?: boolean;
    onpick?: (f: Picked) => void | Promise<void>;
    onclear?: () => void;
    after?: Snippet<[Picked]>;      // abaixo do botão principal (ex.: prévia)
  } = $props();

  let file = $state<Picked | null>(null);
  let busy = $state('');
  let error = $state('');
  let locked = $state<ToolFile | null>(null);
  let big = $state<string | null>(null);
  let result = $state<RunResult | null>(null);

  onMount(() => {
    const handed = takeFiles(id);
    if (handed.length) load(handed[0]);
  });
  onDestroy(() => { closePdf(file?.doc); });

  async function choose(list: File[]) {
    error = '';
    const { ok } = await readPdfFiles(list);
    if (!ok.length) { error = t('Escolha um arquivo .pdf.'); return; }
    await load(ok[0]);
  }

  async function load(f: ToolFile) {
    error = '';
    locked = null;
    busy = t('Abrindo…');
    try {
      await clear();
      let doc: PDFDocumentProxy | null = null;
      if (open) {
        try {
          doc = await openPdf(f.bytes);
        } catch (err) {
          if ((err as { name?: string }).name === 'PasswordException') {
            locked = f;
            error = t('“{name}” é protegido por senha. Desbloqueie o arquivo primeiro.', { name: f.name });
            return;
          }
          throw err;
        }
      }
      // As opções só aparecem depois que a ferramenta leu o arquivo (senão o que a pessoa digitar
      // logo de cara seria sobrescrito pelos valores lidos)
      const picked: Picked = { name: f.name, bytes: f.bytes, pages: doc?.numPages ?? 0, doc };
      try {
        await onpick?.(picked);
      } catch (err) {
        await closePdf(doc);
        throw err;
      }
      file = picked;
      big = bigFileNote(f.bytes.length);
    } catch (err) {
      console.error(err);
      error = t('Não foi possível abrir “{name}”. Verifique se é um PDF válido.', { name: f.name });
    } finally {
      busy = '';
    }
  }

  async function go() {
    if (!file || !canRun) return;
    error = '';
    busy = t('Processando…');
    try {
      result = await run(file, (text) => { busy = text; });
    } catch (err) {
      console.error(err);
      error = (err as Error).message && (err as Error).name === 'ToolError'
        ? (err as Error).message
        : t('Não foi possível concluir. Tente novamente.');
    } finally {
      busy = '';
    }
  }

  async function clear() {
    const doc = file?.doc;
    file = null;
    result = null;
    big = null;
    onclear?.();
    await closePdf(doc);
  }

  async function reset() {
    await clear();
    error = '';
    locked = null;
  }
</script>

<ToolPage {id} {wide}>
  {#if result && file}
    <Result files={result.files} zipName="{baseName(file.name)}.zip" summary={result.summary} onreset={reset}
      onedit={result.editable === false ? undefined : (f) => requestOpen({ kind: 'file', bytes: f.bytes, name: f.name })}>
      {#snippet extra()}
        {#if result?.note}<p class="notice warn">{result.note}</p>{/if}
      {/snippet}
    </Result>
  {:else if !file}
    <FileDrop label={t('Escolher PDF')} onfiles={choose} />
  {:else}
    <!-- No computador, opções e prévia lado a lado -->
    <div class="work" class:side={!!after}>
      <!-- Formulário: Enter num campo (ex.: senha) aciona o botão principal -->
      <form class="panel" onsubmit={(e) => { e.preventDefault(); go(); }}>
        <p class="file"><strong>{file.name}</strong>{#if file.pages} · {tn(file.pages, '{n} página', '{n} páginas')}{/if} · {formatSize(file.bytes.length)}
          <button type="button" class="link" onclick={reset}>{t('Trocar arquivo')}</button></p>
        {#if options}<div class="options">{@render options(file)}</div>{/if}
        <div class="go">
          <button type="submit" class="button primary" disabled={!!busy || !canRun}>
            <Icon size={20} aria-hidden="true" /> {action}
          </button>
        </div>
        {@render notices()}
      </form>
      {#if after}<div class="aside">{@render after(file)}</div>{/if}
    </div>
  {/if}
  {#if !file || result}{@render notices()}{/if}
  {#if locked}
    {@const f = locked}
    <div class="go">
      <button class="button primary" onclick={() => sendToTool('desbloquear', [f])}><LockOpen size={20} aria-hidden="true" /> {t('Desbloquear este PDF')}</button>
    </div>
  {/if}
</ToolPage>

{#snippet notices()}
  {#if big && !result}<p class="notice warn">{big}</p>{/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
{/snippet}

<style>
  .work.side .aside { margin-top: 12px; }
  .aside > :global(.panel) { margin-top: 0; }
  @media (min-width: 900px) {
    .work.side { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 16px; align-items: start; }
    .work.side .aside { margin-top: 0; position: sticky; top: 72px; }
  }
  .file { margin: 0 0 14px; overflow-wrap: anywhere; }
  .link { border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; cursor: pointer; padding: 8px; }
</style>
