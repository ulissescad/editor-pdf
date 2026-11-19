<script lang="ts">
  import { t, tn } from '../lib/i18n.svelte';
  // Tarjar informações (PLANO.md, item 2.11): marcar áreas arrastando sobre a página (dedo ou mouse) ou
  // procurar no texto (palavras, CPF, CNPJ, e-mail, telefone). Ao aplicar, as páginas com tarja viram
  // imagem com os retângulos pintados, e o conteúdo original delas sai do arquivo.
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import PagePreview from './PagePreview.svelte';
  import Pager from './Pager.svelte';
  import { ToolError } from './handoff';
  import { baseName } from '../pdf/plan';
  import type { VRect } from '../editor/geom';
  import type { PDFDocumentProxy } from '../pdf/pdfjs';
  import { PATTERNS, findMatches, queryRegex, type PatternId } from '../pdf/redact';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';

  let doc = $state.raw<PDFDocumentProxy | null>(null);
  let at = $state(0);
  let rects = $state.raw(new Map<number, VRect[]>());
  let draft = $state<VRect | null>(null);
  let chosen = $state(-1);
  let query = $state('');
  let found = $state('');
  let searching = $state(false);
  let clearMetadata = $state(true);

  const total = $derived([...rects.values()].reduce((n, r) => n + r.length, 0));
  const pagesMarked = $derived([...rects.values()].filter((r) => r.length).length);
  const here = $derived(rects.get(at) ?? []);

  function setPage(i: number, list: VRect[]) {
    const next = new Map(rects);
    if (list.length) next.set(i, list); else next.delete(i);
    rects = next;
  }

  // ---------- desenhar com o dedo ou o mouse ----------
  let start: [number, number] | null = null;
  let layer: HTMLElement | null = null;
  let pageSize = { width: 1, height: 1 };

  function toPt(e: PointerEvent): [number, number] {
    const b = layer!.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - b.left, 0), b.width), y = Math.min(Math.max(e.clientY - b.top, 0), b.height);
    return [(x / b.width) * pageSize.width, (y / b.height) * pageSize.height];
  }

  function down(e: PointerEvent, size: { width: number; height: number }) {
    if (e.button > 0) return;
    layer = e.currentTarget as HTMLElement;
    pageSize = size;
    layer.setPointerCapture(e.pointerId);
    start = toPt(e);
    chosen = -1;
    draft = { x: start[0], y: start[1], w: 0, h: 0 };
  }
  function move(e: PointerEvent) {
    if (!start) return;
    const [x, y] = toPt(e);
    draft = { x: Math.min(x, start[0]), y: Math.min(y, start[1]), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]) };
  }
  function up() {
    if (draft && draft.w >= 3 && draft.h >= 3) setPage(at, [...here, draft]);
    start = null;
    draft = null;
  }

  function remove(i: number) {
    setPage(at, here.filter((_, k) => k !== i));
    chosen = -1;
  }

  const pct = (r: VRect, s: { width: number; height: number }) =>
    `left:${(r.x / s.width) * 100}%;top:${(r.y / s.height) * 100}%;width:${(r.w / s.width) * 100}%;height:${(r.h / s.height) * 100}%`;

  // ---------- procurar no texto ----------
  async function search(re: RegExp | null, folded: boolean, what: string) {
    if (!doc || !re) return;
    searching = true;
    found = '';
    try {
      const [{ textRuns, canvasMeasure }, { toView }] = await Promise.all([
        import('../editor/textsel'), import('../editor/geom'),
      ]);
      const measure = canvasMeasure();
      let hits = 0;
      const touched = new Set<number>();
      let next = new Map(rects);
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);
        const tc = await page.getTextContent();
        const runs = textRuns(tc.items as never[], tc.styles as never);
        const geo = { view: page.view, rotate: page.rotate };
        const list = [...(next.get(i) ?? [])];
        for (const quads of findMatches(runs, re, { folded, measure, pad: 1.5 })) {
          hits++;
          touched.add(i);
          for (const q of quads) {
            const v = toView(q, geo);
            if (!list.some((r) => Math.abs(r.x - v.x) < 0.5 && Math.abs(r.y - v.y) < 0.5 && Math.abs(r.w - v.w) < 0.5)) list.push(v);
          }
        }
        if (list.length) next = next.set(i, list);
      }
      rects = new Map(next);
      found = hits
        ? `${what}: ${tn(hits, '{n} ocorrência marcada', '{n} ocorrências marcadas')} ${tn(touched.size, 'em {n} página.', 'em {n} páginas.')}`
        : `${what}: ${t('nada encontrado no texto. Em PDFs digitalizados (fotos de páginas), marque as áreas arrastando sobre a página.')}`;
      if (hits && !touched.has(at)) at = Math.min(...touched);
    } catch (err) {
      console.error(err);
      found = t('Não foi possível procurar no texto deste PDF.');
    } finally {
      searching = false;
    }
  }

  async function searchQuery() {
    await search(queryRegex(query), true, `“${query.trim()}”`);
  }

  const searchPattern = (id: PatternId) => search(PATTERNS[id].re, false, t(PATTERNS[id].label));

  async function pick(f: Picked) { doc = f.doc; at = 0; rects = new Map(); found = ''; }

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    if (!total) throw new ToolError(t('Marque pelo menos uma área para tarjar.'));
    const { redactPdf } = await import('../pdf/raster');
    const bytes = await redactPdf(f.bytes, rects, {
      dpi: 200, clearMetadata,
      onProgress: (done, n) => progress(done < n ? t('Tarjando a página {i} de {n}…', { i: done + 1, n }) : t('Montando o PDF…')),
    });
    return {
      files: [{ name: `${baseName(f.name)}-${t('tarjado')}.pdf`, bytes, mime: 'application/pdf' }],
      summary: `${tn(total, '{n} tarja', '{n} tarjas')} ${tn(pagesMarked, 'em {n} página', 'em {n} páginas')}: ${t('o conteúdo coberto foi removido do arquivo.')}`,
      note: t('As páginas com tarja viraram imagem: o texto delas não pode mais ser selecionado nem pesquisado.'),
    };
  }
</script>

<OneFileTool id="tarjar" action={total ? tn(total, 'Aplicar {n} tarja', 'Aplicar {n} tarjas') : t('Aplicar tarjas')} icon={Eraser}
  {run} canRun={total > 0 && !searching} onpick={pick} onclear={() => { doc = null; rects = new Map(); }} wide>
  {#snippet options()}
    <div class="row">
      <label class="label" for="rq">{t('Procurar no texto e tarjar')}</label>
      <div class="find">
        <input id="rq" type="search" bind:value={query} placeholder={t('Nome, número…')} autocomplete="off"
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchQuery(); } }}>
        <button type="button" class="button" onclick={searchQuery} disabled={!query.trim() || searching}><Search size={18} aria-hidden="true" /> {t('Marcar')}</button>
      </div>
      <div class="chips" role="group" aria-label={t('Marcar padrões')}>
        {#each Object.entries(PATTERNS) as [id, p] (id)}
          <button type="button" class="button small" onclick={() => searchPattern(id as PatternId)} disabled={searching}>{t('Todos os {label}s', { label: t(p.label) })}</button>
        {/each}
      </div>
      {#if found}<p class="notice info" role="status">{found}</p>{/if}
    </div>
    <label class="check"><input type="checkbox" bind:checked={clearMetadata}> {t('Remover também o título, o autor e as outras propriedades do documento')}</label>
    <p class="hint">{t('Ao aplicar, cada página com tarja vira uma imagem: o que está embaixo da tarja deixa de existir no arquivo (não dá para copiar nem recuperar).')}</p>
  {/snippet}
  {#snippet after(f)}
    <div class="panel pages">
      <div class="head">
        <h2>{t('Marque as áreas')}</h2>
        <span class="count">{tn(total, '{n} tarja', '{n} tarjas')}</span>
        {#if total}<button type="button" class="button small" onclick={() => { rects = new Map(); chosen = -1; }}>{t('Limpar tudo')}</button>{/if}
      </div>
      <p class="hint">{t('Arraste sobre a página para cobrir uma área. Toque numa tarja para removê-la.')}</p>
      <PagePreview doc={f.doc} index={at} width={560} maxVh={70} label={t('Página {n}', { n: at + 1 })}>
        {#snippet overlay(size)}
          <div class="draw" role="application" aria-label={t('Área da página {n} para marcar tarjas', { n: at + 1 })}
            onpointerdown={(e) => down(e, size)} onpointermove={move} onpointerup={up} onpointercancel={up}>
            {#each here as r, i (i)}
              <button type="button" class="bar" class:chosen={chosen === i} style={pct(r, size)}
                aria-label={t('Tarja {n}', { n: i + 1 })} aria-pressed={chosen === i} onpointerdown={(e) => e.stopPropagation()}
                onclick={() => (chosen = chosen === i ? -1 : i)}></button>
            {/each}
            {#if chosen >= 0 && here[chosen]}
              {@const r = here[chosen]}
              <button type="button" class="rm" style:left="{(r.x / size.width) * 100}%" style:top="{((r.y + r.h) / size.height) * 100}%"
                onpointerdown={(e) => e.stopPropagation()} onclick={() => remove(chosen)}>
                <X size={18} aria-hidden="true" /> {t('Remover tarja')}
              </button>
            {/if}
            {#if draft}<div class="bar draft" style={pct(draft, size)}></div>{/if}
          </div>
        {/snippet}
      </PagePreview>
      {#if f.pages > 1}<Pager bind:index={at} pages={f.pages} />{/if}
    </div>
  {/snippet}
</OneFileTool>

<style>
  .find { display: flex; gap: 8px; max-width: 520px; }
  .find input {
    flex: 1; min-width: 0; min-height: var(--tap); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px;
    background: var(--surface); color: var(--text); font: inherit;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .check { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-weight: 600; font-size: 15px; cursor: pointer; }
  .check input { width: 20px; height: 20px; flex: none; }
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .head h2 { margin: 0; }
  .count { color: var(--muted); font-weight: 600; flex: 1; }
  /* Um dedo desenha a tarja (sem rolar a página por baixo) */
  .draw { position: absolute; inset: 0; touch-action: none; cursor: crosshair; user-select: none; -webkit-user-select: none; }
  .bar { position: absolute; background: #000; border: 0; padding: 0; margin: 0; cursor: pointer; opacity: .85; }
  .bar.draft { opacity: .6; pointer-events: none; }
  .bar.chosen { outline: 3px solid var(--accent); outline-offset: 1px; opacity: 1; }
  .rm {
    position: absolute; margin-top: 6px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; min-height: 40px;
    background: var(--err-text); color: #fff; border: 0; border-radius: 999px; padding: 0 14px; font: inherit; font-weight: 700;
    font-size: 14px; z-index: 2; cursor: pointer; box-shadow: 0 2px 6px rgba(0, 0, 0, .3);
  }
</style>
