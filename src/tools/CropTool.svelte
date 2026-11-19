<script lang="ts">
  import { t, tk, tn } from '../lib/i18n.svelte';
  // Recortar margens (PLANO.md, item 2.10): margens em mm (iguais ou por lado) ou automático, que corta o
  // espaço em branco em volta do conteúdo de cada página. A prévia mostra o que fica.
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import PagePreview from './PagePreview.svelte';
  import PageChoice from './PageChoice.svelte';
  import Pager from './Pager.svelte';
  import { ToolError } from './handoff';
  import { baseName } from '../pdf/plan';
  import { MM, applyCrop, clampMargins, contentBounds, marginsFromBounds, type Margins } from '../pdf/crop';
  import type { PDFDocumentProxy } from '../pdf/pdfjs';
  import Crop from '@lucide/svelte/icons/crop';

  let mode = $state<'manual' | 'auto'>('manual');
  let same = $state(true);
  let all = $state(15);                     // mm
  const sides = $state({ top: 15, right: 15, bottom: 15, left: 15 });
  let pad = $state(5);                      // mm de folga no automático
  let selection = $state<number[] | null>(null);
  let at = $state(0);
  let doc = $state.raw<PDFDocumentProxy | null>(null);
  let auto = $state.raw(new Map<number, Margins>()); // margens automáticas já calculadas (sem folga)
  let measuring = $state(false);

  const manual = $derived<Margins>(same
    ? { top: all * MM, right: all * MM, bottom: all * MM, left: all * MM }
    : { top: sides.top * MM, right: sides.right * MM, bottom: sides.bottom * MM, left: sides.left * MM });
  const numbersOk = $derived(same ? all >= 0 : Object.values(sides).every((v) => typeof v === 'number' && v >= 0));

  /** Margens do conteúdo da página (pt, sem folga), desenhando a página em baixa resolução. */
  async function measure(d: PDFDocumentProxy, i: number): Promise<Margins> {
    const hit = auto.get(i);
    if (hit) return hit;
    const { renderPage } = await import('../pdf/raster');
    const r = await renderPage(d, i, 50);
    const data = r.canvas.getContext('2d')!.getImageData(0, 0, r.canvas.width, r.canvas.height).data;
    const b = contentBounds(data, r.canvas.width, r.canvas.height);
    const m = marginsFromBounds(b, r.canvas.width, r.canvas.height, r.scale, 0);
    r.canvas.width = r.canvas.height = 0;
    auto = new Map(auto).set(i, m);
    return m;
  }

  const withPad = (m: Margins): Margins => {
    const p = pad * MM;
    return { top: Math.max(0, m.top - p), right: Math.max(0, m.right - p), bottom: Math.max(0, m.bottom - p), left: Math.max(0, m.left - p) };
  };

  // No automático, mede a página da prévia
  $effect(() => {
    if (mode !== 'auto' || !doc || auto.has(at)) return;
    measuring = true;
    measure(doc, at).catch(console.error).finally(() => { measuring = false; });
  });

  const applies = (i: number) => !selection || selection.includes(i);

  function marginsFor(i: number): Margins | null {
    if (!applies(i)) return null;
    if (mode === 'manual') return manual;
    const m = auto.get(i);
    return m ? withPad(m) : null;
  }

  async function pick(f: Picked) { doc = f.doc; at = 0; auto = new Map(); }

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    if (selection && !selection.length) throw new ToolError(t('Escolha as páginas que serão recortadas.'));
    if (mode === 'auto') {
      for (let i = 0; i < f.pages; i++) {
        if (!applies(i)) continue;
        progress(t('Medindo a página {i} de {n}…', { i: i + 1, n: f.pages }));
        await measure(f.doc!, i);
      }
    }
    progress(t('Recortando…'));
    const { loadPdf } = await import('../pdf/pages');
    const pdf = await loadPdf(f.bytes);
    applyCrop(pdf, marginsFor);
    const bytes = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false });
    const n = selection?.length ?? f.pages;
    return {
      files: [{ name: `${baseName(f.name)}-${t('recortado')}.pdf`, bytes, mime: 'application/pdf' }],
      summary: tn(n, '{n} página recortada.', '{n} páginas recortadas.'),
      note: t('O recorte esconde as bordas em qualquer leitor, mas o conteúdo de fora continua dentro do arquivo. Para apagar informação de verdade, use “Tarjar informações”.'),
    };
  }

  /** Área que fica, em % da página vista (para a prévia). */
  function keep(size: { width: number; height: number }) {
    const m0 = marginsFor(at);
    if (!m0) return null;
    const m = clampMargins(m0, [size.width, size.height]);
    return {
      left: (m.left / size.width) * 100, top: (m.top / size.height) * 100,
      width: ((size.width - m.left - m.right) / size.width) * 100, height: ((size.height - m.top - m.bottom) / size.height) * 100,
    };
  }
</script>

<OneFileTool id="recortar" action={t('Recortar páginas')} icon={Crop} {run} canRun={numbersOk} onpick={pick}
  onclear={() => { doc = null; auto = new Map(); }} wide>
  {#snippet options(f)}
    <div class="row">
      <span class="label" id="cm-l">{t('Como recortar')}</span>
      <fieldset class="seg" aria-labelledby="cm-l">
        <label><input type="radio" bind:group={mode} value="manual"> {t('Margens fixas')}</label>
        <label><input type="radio" bind:group={mode} value="auto"> {t('Automático (tira o branco)')}</label>
      </fieldset>
    </div>
    {#if mode === 'manual'}
      <label class="check"><input type="checkbox" bind:checked={same}> {t('Mesma medida nos 4 lados')}</label>
      {#if same}
        <div class="row">
          <label class="label" for="c-all">{t('Margem a cortar (mm)')}</label>
          <input id="c-all" type="number" min="0" step="1" bind:value={all}>
        </div>
      {:else}
        <div class="sides">
          {#each [['top', tk('Em cima')], ['bottom', tk('Embaixo')], ['left', tk('Esquerda')], ['right', tk('Direita')]] as [k, label] (k)}
            <div class="row">
              <label class="label" for="c-{k}">{t(label)} (mm)</label>
              <input id="c-{k}" type="number" min="0" step="1" bind:value={sides[k as keyof typeof sides]}>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="row">
        <label class="label" for="c-pad">{t('Folga em volta do conteúdo (mm)')}</label>
        <input id="c-pad" type="number" min="0" step="1" bind:value={pad}>
        <p class="hint">{t('Cada página é recortada no próprio conteúdo. Funciona também com páginas digitalizadas (fundo branco).')}</p>
      </div>
    {/if}
    <PageChoice pages={f.pages} bind:selection />
  {/snippet}
  {#snippet after(f)}
    <div class="panel prev">
      <h2>{t('Prévia')}</h2>
      <PagePreview doc={f.doc} index={at} width={460} label={t('Página {n}', { n: at + 1 })}>
        {#snippet overlay(size)}
          {@const k = keep(size)}
          {#if k}
            <div class="keep" style:left="{k.left}%" style:top="{k.top}%" style:width="{k.width}%" style:height="{k.height}%"></div>
          {/if}
        {/snippet}
      </PagePreview>
      {#if measuring}<p class="hint center">{t('Medindo o conteúdo…')}</p>{/if}
      {#if !applies(at)}<p class="hint center">{t('Esta página não será recortada.')}</p>{/if}
      {#if f.pages > 1}<Pager bind:index={at} pages={f.pages} />{/if}
    </div>
  {/snippet}
</OneFileTool>

<style>
  .check { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-weight: 600; font-size: 15px; cursor: pointer; }
  .check input { width: 20px; height: 20px; }
  .sides { display: grid; grid-template-columns: repeat(2, minmax(0, 200px)); gap: 12px; }
  input[type="number"] {
    min-height: var(--tap); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px;
    background: var(--surface); color: var(--text); font: inherit; width: 100%; max-width: 200px;
  }
  /* O que fica: moldura tracejada; o que sai: escurecido em volta */
  .keep { position: absolute; outline: 2px dashed var(--accent); box-shadow: 0 0 0 9999px rgba(20, 30, 50, .45); }
  .prev :global(.sheet) { overflow: hidden; }
  .center { text-align: center; margin-top: 8px; }
</style>
