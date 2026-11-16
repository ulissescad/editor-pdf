<script lang="ts">
  // Números de página (PLANO.md, item 2.9): posição, formato (“1 de N”…), capa sem número e número inicial.
  import type { PDFDocument } from '@cantoo/pdf-lib';
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import PagePreview from './PagePreview.svelte';
  import Pager from './Pager.svelte';
  import { ToolError } from './handoff';
  import { baseName } from '../pdf/plan';
  import { NUMBER_DEFAULTS, numberLabel, type NumberOptions, type NumPos } from '../pdf/stamp';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';

  const o = $state<NumberOptions>({ ...NUMBER_DEFAULTS });
  let src = $state.raw<PDFDocument | null>(null);
  let pages = $state(0);
  let at = $state(0);
  let preview = $state.raw<Uint8Array | null>(null);

  const POSITIONS: Array<{ id: NumPos; label: string }> = [
    { id: 'tl', label: 'Em cima, à esquerda' }, { id: 'tc', label: 'Em cima, no centro' }, { id: 'tr', label: 'Em cima, à direita' },
    { id: 'bl', label: 'Embaixo, à esquerda' }, { id: 'bc', label: 'Embaixo, no centro' }, { id: 'br', label: 'Embaixo, à direita' },
  ];
  const valid = $derived(Number.isInteger(o.from) && o.from >= 1 && o.from <= Math.max(1, pages) && Number.isInteger(o.start) && o.start >= 0);
  const example = $derived(valid ? numberLabel(o.from - 1, pages, o) : null);

  async function pick(f: Picked) {
    const { loadPdf } = await import('../pdf/pages');
    pages = f.pages;
    at = 0;
    src = await loadPdf(f.bytes);
  }

  $effect(() => {
    const opts = $state.snapshot(o) as NumberOptions;
    const doc = src, i = at, n = pages;
    if (!doc || !valid) return;
    const timer = setTimeout(async () => {
      try {
        const { addPageNumbers, singlePage } = await import('../pdf/stamp');
        const one = await singlePage(doc, i);
        await addPageNumbers(one, opts, () => numberLabel(i, n, opts));
        preview = await one.save();
      } catch (err) { console.error(err); }
    }, 200);
    return () => clearTimeout(timer);
  });

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    if (!valid) throw new ToolError('Confira a primeira página numerada e o número inicial.');
    progress('Numerando as páginas…');
    const [{ loadPdf }, { addPageNumbers }] = await Promise.all([import('../pdf/pages'), import('../pdf/stamp')]);
    const doc = await loadPdf(f.bytes);
    await addPageNumbers(doc, $state.snapshot(o) as NumberOptions);
    const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    const n = f.pages - o.from + 1;
    return {
      files: [{ name: `${baseName(f.name)}-numerado.pdf`, bytes, mime: 'application/pdf' }],
      summary: `${n} página${n === 1 ? '' : 's'} numerada${n === 1 ? '' : 's'}.`,
    };
  }
</script>

<OneFileTool id="numerar" action="Numerar páginas" icon={ListOrdered} {run} canRun={valid} onpick={pick} onclear={() => { src = null; preview = null; }} wide>
  {#snippet options(f)}
    <div class="row">
      <span class="label" id="np-l">Posição</span>
      <div class="spots" role="radiogroup" aria-labelledby="np-l">
        {#each POSITIONS as p (p.id)}
          <label class="spot {p.id}" title={p.label}>
            <input type="radio" bind:group={o.position} value={p.id} aria-label={p.label}>
            <span class="dot" aria-hidden="true"></span>
          </label>
        {/each}
      </div>
    </div>
    <div class="row">
      <label class="label" for="nf">Formato</label>
      <select id="nf" bind:value={o.format}>
        <option value="n">1</option>
        <option value="n-de">1 de {f.pages}</option>
        <option value="pag">Página 1</option>
        <option value="pag-de">Página 1 de {f.pages}</option>
        <option value="traco">– 1 –</option>
      </select>
    </div>
    <div class="nums">
      <div class="row">
        <label class="label" for="nfrom">Começar na página</label>
        <input id="nfrom" type="number" min="1" max={f.pages} step="1" bind:value={o.from}>
      </div>
      <div class="row">
        <label class="label" for="nstart">Com o número</label>
        <input id="nstart" type="number" min="0" step="1" bind:value={o.start}>
      </div>
    </div>
    <p class="hint">
      {#if o.from > 1}As páginas antes da {o.from} (capa) ficam sem número. {/if}
      {#if example}A página {o.from} recebe “{example}”.{:else}Confira os números.{/if}
    </p>
    <div class="nums">
      <div class="row">
        <label class="label" for="nsize">Tamanho</label>
        <select id="nsize" bind:value={o.size}>
          <option value={9}>Pequeno</option>
          <option value={11}>Médio</option>
          <option value={14}>Grande</option>
        </select>
      </div>
      <div class="row">
        <label class="label" for="nmargin">Distância da borda</label>
        <select id="nmargin" bind:value={o.margin}>
          <option value={18}>Perto</option>
          <option value={28}>Média</option>
          <option value={42}>Longe</option>
        </select>
      </div>
    </div>
  {/snippet}
  {#snippet after(f)}
    <div class="panel prev">
      <h2>Prévia</h2>
      <PagePreview bytes={preview} width={460} label="Prévia da página {at + 1} numerada" />
      {#if f.pages > 1}<Pager bind:index={at} pages={f.pages} />{/if}
    </div>
  {/snippet}
</OneFileTool>

<style>
  .spots {
    display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: 1fr 1fr; gap: 0;
    width: 132px; aspect-ratio: 1 / 1.3; border: 2px solid var(--border); border-radius: 8px; background: var(--surface);
    padding: 4px;
  }
  .spot { display: flex; justify-content: center; cursor: pointer; padding: 4px; }
  .spot.tl, .spot.tc, .spot.tr { align-items: flex-start; }
  .spot.bl, .spot.bc, .spot.br { align-items: flex-end; }
  .spot input { position: absolute; opacity: 0; pointer-events: none; }
  .dot { width: 28px; height: 28px; border-radius: 6px; border: 2px solid var(--border); background: var(--surface-2); }
  .spot:has(input:checked) .dot { background: var(--accent); border-color: var(--accent); }
  .spot:has(input:focus-visible) .dot { outline: 3px solid var(--accent); outline-offset: 2px; }
  .nums { display: flex; flex-wrap: wrap; gap: 14px; }
  .nums .row { min-width: 140px; }
  input[type="number"], select {
    min-height: var(--tap); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px;
    background: var(--surface); color: var(--text); font: inherit; width: 100%; max-width: 200px;
  }
</style>
