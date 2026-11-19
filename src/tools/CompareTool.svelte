<script lang="ts">
  import { t, tn } from '../lib/i18n.svelte';
  // Comparar PDFs (PLANO.md, item 2.15): duas versões de um documento → o que saiu e o que entrou no texto,
  // marcado nas páginas. Compara só o texto: imagens e formatação não entram.
  import { onDestroy, tick } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import PagePreview from './PagePreview.svelte';
  import { formatSize } from './thumbs';
  import { openError, readPdfFiles } from './handoff';
  import { closePdf, openPdf, type PDFDocumentProxy } from '../pdf/pdfjs';
  import { baseName } from '../pdf/plan';
  import { downloadPdf } from '../editor/output';
  import { startsTight } from '../pdf/textdiff';
  import type { Comparison, Mark } from '../pdf/compare';
  import type { VRect } from '../editor/geom';
  import GitCompare from '@lucide/svelte/icons/git-compare-arrows';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Download from '@lucide/svelte/icons/download';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Loader from '@lucide/svelte/icons/loader-circle';

  interface Side { name: string; bytes: Uint8Array; doc: PDFDocumentProxy }
  type Slot = 'a' | 'b';

  const PAGE_OF_LIST = 100;

  let a = $state.raw<Side | null>(null);
  let b = $state.raw<Side | null>(null);
  let ignoreCase = $state(false);
  let busy = $state('');
  let error = $state('');
  let outcome = $state.raw<Comparison | null>(null);
  let at = $state(0);
  let showing = $state<Slot>('b');   // no celular, uma versão por vez
  let listed = $state(PAGE_OF_LIST);
  let viewer = $state<HTMLElement>();

  const current = $derived(outcome?.changes[at] ?? null);

  onDestroy(() => { closePdf(a?.doc); closePdf(b?.doc); });

  async function choose(slot: Slot, list: File[]) {
    error = '';
    const { ok } = await readPdfFiles(list);
    if (!ok.length) { error = t('Escolha um arquivo .pdf.'); return; }
    const f = ok[0];
    busy = t('Abrindo…');
    try {
      const side = { ...f, doc: await openPdf(f.bytes) };
      await closePdf((slot === 'a' ? a : b)?.doc);
      if (slot === 'a') a = side; else b = side;
    } catch (err) {
      console.error(err);
      error = openError(err, f.name);
    } finally {
      busy = '';
    }
  }

  function swap() { [a, b] = [b, a]; }

  async function compare() {
    if (!a || !b) return;
    error = '';
    try {
      const [{ readDocText, comparePdfs }, { canvasMeasure }] = await Promise.all([
        import('../pdf/compare'), import('../editor/textsel'),
      ]);
      busy = t('Lendo a versão antiga…');
      const ta = await readDocText(a.doc, (n, total) => { busy = t('Lendo a versão antiga: página {i} de {n}…', { i: n, n: total }); });
      const tb = await readDocText(b.doc, (n, total) => { busy = t('Lendo a versão nova: página {i} de {n}…', { i: n, n: total }); });
      const empty = !ta.words.length ? a : !tb.words.length ? b : null;
      if (empty) {
        error = t('“{name}” não tem texto para comparar (provavelmente é um documento digitalizado).', { name: empty.name });
        return;
      }
      busy = t('Comparando…');
      await new Promise((r) => setTimeout(r, 30));
      outcome = comparePdfs(ta, tb, canvasMeasure(), { ignoreCase });
      listed = PAGE_OF_LIST;
      go(0);
    } catch (err) {
      console.error(err);
      error = t('Não foi possível comparar estes arquivos.');
    } finally {
      busy = '';
    }
  }

  async function go(i: number, scroll = false) {
    at = i;
    const c = outcome?.changes[i];
    // No celular, mostra o lado em que a diferença aparece
    if (c) showing = c.b1 > c.b0 ? 'b' : 'a';
    if (scroll) { await tick(); viewer?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }

  async function download(slot: Slot) {
    const side = slot === 'a' ? a : b;
    if (!side || !outcome) return;
    error = '';
    busy = t('Gerando o PDF marcado…');
    try {
      const { markPdf, REMOVED_RGB, ADDED_RGB } = await import('../pdf/compare');
      const bytes = await markPdf(side.bytes, slot === 'a' ? outcome.marksA : outcome.marksB, slot === 'a' ? REMOVED_RGB : ADDED_RGB);
      downloadPdf(bytes, `${baseName(side.name)}-${slot === 'a' ? t('antiga-marcada') : t('nova-marcada')}.pdf`);
    } catch (err) {
      console.error(err);
      error = t('Não foi possível gerar o PDF marcado.');
    } finally {
      busy = '';
    }
  }

  const again = () => { outcome = null; error = ''; };
  const pct = (r: VRect, s: { width: number; height: number }) =>
    `left:${(r.x / s.width) * 100}%;top:${(r.y / s.height) * 100}%;width:${(r.w / s.width) * 100}%;height:${(r.h / s.height) * 100}%`;
</script>

<ToolPage id="comparar" wide>
  {#if !outcome}
    <div class="slots">
      {@render slot('a', t('Versão antiga'), a)}
      <button type="button" class="button swap" onclick={swap} disabled={!a && !b} aria-label={t('Trocar as versões de lugar')}>
        <ArrowLeftRight size={18} aria-hidden="true" />
      </button>
      {@render slot('b', t('Versão nova'), b)}
    </div>
    <div class="panel opts">
      <label class="check"><input type="checkbox" bind:checked={ignoreCase}> {t('Ignorar maiúsculas e acentos')}</label>
      <p class="hint">{t('Compara só o texto. Mudanças em imagens, cores ou posição não aparecem, e PDFs digitalizados não têm texto para comparar.')}</p>
      <div class="go">
        <button class="button primary" onclick={compare} disabled={!a || !b || !!busy}><GitCompare size={20} aria-hidden="true" /> {t('Comparar')}</button>
      </div>
    </div>
  {:else}
    {@const n = outcome.changes.length}
    <div class="panel summary" role="status">
      {#if n}
        <p><strong>{tn(n, '{n} diferença', '{n} diferenças')}</strong> ·
          <span class="out">{tn(outcome.removedWords, '{n} item removido', '{n} itens removidos')}</span> ·
          <span class="in">{tn(outcome.addedWords, '{n} item adicionado', '{n} itens adicionados')}</span></p>
      {:else}
        <p class="same"><strong>{t('Nenhuma diferença no texto.')}</strong> {t('Imagens e formatação não são comparadas.')}</p>
      {/if}
      <div class="go">
        {#if n}
          <button class="button" onclick={() => download('b')} disabled={!!busy}><Download size={20} aria-hidden="true" /> {t('Baixar versão nova marcada')}</button>
          <button class="button" onclick={() => download('a')} disabled={!!busy}><Download size={20} aria-hidden="true" /> {t('Baixar versão antiga marcada')}</button>
        {/if}
        <button class="button" onclick={again}><RotateCcw size={20} aria-hidden="true" /> {t('Comparar outros')}</button>
      </div>
    </div>

    {#if n && current && a && b}
      <div class="layout">
        <div class="viewer" bind:this={viewer}>
          <div class="pager">
            <button type="button" class="button small" aria-label={t('Diferença anterior')} disabled={at === 0} onclick={() => go(at - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
            <span aria-live="polite">{t('Diferença {i} de {n}', { i: at + 1, n })}</span>
            <button type="button" class="button small" aria-label={t('Próxima diferença')} disabled={at === n - 1} onclick={() => go(at + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
          </div>
          <fieldset class="seg which" aria-label={t('Versão mostrada')}>
            <label><input type="radio" bind:group={showing} value="a"> {t('Versão antiga')}</label>
            <label><input type="radio" bind:group={showing} value="b"> {t('Versão nova')}</label>
          </fieldset>
          <div class="pages">
            {@render side('a', t('Versão antiga'), a.doc, current.pageA, outcome.marksA.get(current.pageA) ?? [])}
            {@render side('b', t('Versão nova'), b.doc, current.pageB, outcome.marksB.get(current.pageB) ?? [])}
          </div>
        </div>

        <ol class="changes" aria-label={t('Lista de diferenças')}>
          {#each outcome.changes.slice(0, listed) as c, i (i)}
            <li>
              <button type="button" class="change" class:on={i === at} aria-current={i === at ? 'true' : undefined} onclick={() => go(i, true)}>
                <span class="where">{i + 1} · {t('página {n}', { n: c.pageA + 1 })}{c.pageA !== c.pageB ? ` → ${c.pageB + 1}` : ''}</span>
                <span class="text">
                  {#if c.before}<span class="ctx">…{c.before} </span>{/if}
                  {#if c.removed}<del>{c.removed}</del>{/if}
                  {#if c.removed && c.added}{' '}{/if}
                  {#if c.added}<ins>{c.added}</ins>{/if}
                  {#if c.after}<span class="ctx">{startsTight(c.after) ? '' : ' '}{c.after}…</span>{/if}
                </span>
              </button>
            </li>
          {/each}
          {#if n > listed}
            <li><button type="button" class="button" onclick={() => (listed += PAGE_OF_LIST)}>{t('Mostrar mais ({n})', { n: n - listed })}</button></li>
          {/if}
        </ol>
      </div>
    {/if}
  {/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</ToolPage>

{#snippet slot(id: Slot, title: string, f: Side | null)}
  <section class="panel slot" aria-label={title}>
    <h2>{title}</h2>
    {#if f}
      <p class="file"><strong>{f.name}</strong> · {tn(f.doc.numPages, '{n} página', '{n} páginas')} · {formatSize(f.bytes.length)}</p>
    {/if}
    <FileDrop label={f ? t('Trocar arquivo') : t('Escolher: {what}', { what: title })} compact={!!f} hint="" onfiles={(l) => choose(id, l)} />
  </section>
{/snippet}

{#snippet side(id: Slot, title: string, doc: PDFDocumentProxy, index: number, marks: Mark[])}
  <figure class="page" class:hide={showing !== id}>
    <figcaption>{title} · {t('página {n}', { n: index + 1 })}</figcaption>
    <PagePreview {doc} {index} width={520} maxVh={76} label="{title}, {t('página {n}', { n: index + 1 })}">
      {#snippet overlay(size)}
        {#each marks as m, k (k)}
          <span class="mark {id}" class:now={m.change === at} style={pct(m.view, size)}></span>
        {/each}
      {/snippet}
    </PagePreview>
  </figure>
{/snippet}

<style>
  .slots { display: grid; gap: 10px; }
  .slots .panel + .panel { margin-top: 0; }
  .swap { justify-self: center; width: var(--tap); padding: 0; transform: rotate(90deg); }
  @media (min-width: 760px) {
    .slots { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; }
    .slot { align-self: stretch; }
    .swap { transform: none; }
  }
  .file { margin: 0 0 10px; overflow-wrap: anywhere; font-size: 15px; }
  .opts { margin-top: 12px; }
  .check { display: inline-flex; align-items: center; gap: 8px; min-height: var(--tap); font-weight: 600; cursor: pointer; }
  .check input { width: 20px; height: 20px; flex: none; }
  .hint { color: var(--muted); font-size: 14px; margin: 4px 0 0; }
  .summary p { margin: 0; }
  .summary .go { margin-top: 12px; }
  .out { color: var(--err-text); font-weight: 600; }
  .in { color: var(--ok-text); font-weight: 600; }
  .same { color: var(--ok-text); }
  .layout { display: grid; gap: 12px; margin-top: 12px; }
  @media (min-width: 1000px) {
    .layout { grid-template-columns: minmax(0, 1fr) 320px; align-items: start; }
    .changes { max-height: calc(100dvh - 96px); overflow-y: auto; position: sticky; top: 72px; }
  }
  .viewer { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px; scroll-margin-top: 68px; min-width: 0; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 12px; font-weight: 600; margin-bottom: 8px; }
  .pager .button { min-width: var(--tap); min-height: var(--tap); padding: 0; }
  .which { justify-content: center; margin-bottom: 10px; }
  .pages { display: grid; gap: 12px; }
  .page { margin: 0; min-width: 0; }
  .page.hide { display: none; }
  figcaption { font-size: 14px; font-weight: 600; color: var(--muted); text-align: center; margin-bottom: 6px; }
  @media (min-width: 760px) {
    .which { display: none; }
    .pages { grid-template-columns: 1fr 1fr; }
    .page.hide { display: block; }
  }
  .mark { position: absolute; mix-blend-mode: multiply; pointer-events: none; opacity: .4; }
  .mark.a { background: #ef4444; }
  .mark.b { background: #22c55e; }
  .mark.now { opacity: .75; outline: 2px solid #1d2330; outline-offset: 1px; }
  .changes { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; align-content: start; }
  .change {
    display: block; width: 100%; text-align: left; font: inherit; font-size: 14px; line-height: 1.4; color: var(--text); cursor: pointer;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; min-height: var(--tap);
  }
  .change:hover { border-color: var(--accent); }
  .change.on { border-color: var(--accent); background: var(--accent-soft); }
  .where { display: block; color: var(--muted); font-size: 12px; font-weight: 600; }
  .text { overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; line-clamp: 5; overflow: hidden; }
  .ctx { color: var(--muted); }
  del { background: var(--err-bg); color: var(--err-text); text-decoration: line-through; border-radius: 3px; padding: 0 2px; }
  ins { background: var(--ok-bg); color: var(--ok-text); text-decoration: underline; border-radius: 3px; padding: 0 2px; }
</style>
