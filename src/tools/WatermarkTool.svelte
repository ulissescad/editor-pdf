<script lang="ts">
  // Marca d’água (PLANO.md, item 2.8): texto ou imagem, com opacidade, na diagonal ou em mosaico.
  // A prévia é o resultado de verdade (a página com a marca, desenhada pelo pdf.js).
  import type { PDFDocument } from '@cantoo/pdf-lib';
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import PagePreview from './PagePreview.svelte';
  import PageChoice from './PageChoice.svelte';
  import Pager from './Pager.svelte';
  import FileDrop from './FileDrop.svelte';
  import { ToolError } from './handoff';
  import { baseName } from '../pdf/plan';
  import { WATERMARK_DEFAULTS, type WatermarkOptions } from '../pdf/stamp';
  import Droplets from '@lucide/svelte/icons/droplets';

  const o = $state<WatermarkOptions>({ ...WATERMARK_DEFAULTS });
  let selection = $state<number[] | null>(null);
  let imageName = $state('');
  let imageError = $state('');
  let src = $state.raw<PDFDocument | null>(null);
  let pages = $state(0);
  let at = $state(0);
  let preview = $state.raw<Uint8Array | null>(null);

  const ready = $derived(o.kind === 'text' ? !!o.text.trim() : !!o.image);

  async function pick(f: Picked) {
    const { loadPdf } = await import('../pdf/pages');
    pages = f.pages;
    at = 0;
    src = await loadPdf(f.bytes);
  }

  // Prévia: refeita um instante depois da última mudança
  $effect(() => {
    const opts = $state.snapshot(o) as WatermarkOptions;
    const doc = src, i = at;
    if (!doc || (opts.kind === 'text' ? !opts.text.trim() : !opts.image)) return;
    const timer = setTimeout(async () => {
      try {
        const { addWatermark, singlePage } = await import('../pdf/stamp');
        const one = await singlePage(doc, i);
        await addWatermark(one, opts);
        preview = await one.save();
      } catch (err) { console.error(err); }
    }, 250);
    return () => clearTimeout(timer);
  });

  async function chooseImage(files: File[]) {
    imageError = '';
    try {
      const { loadImageFile } = await import('../editor/images');
      const a = await loadImageFile(files[0]);
      o.image = { bytes: a.bytes, mime: a.mime, w: a.w, h: a.h };
      imageName = files[0].name;
    } catch {
      imageError = 'Não foi possível abrir esta imagem. Use JPG ou PNG.';
    }
  }

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    if (selection && !selection.length) throw new ToolError('Escolha as páginas que recebem a marca d’água.');
    progress('Aplicando a marca d’água…');
    const [{ loadPdf }, { addWatermark }] = await Promise.all([import('../pdf/pages'), import('../pdf/stamp')]);
    const doc = await loadPdf(f.bytes);
    const { replaced } = await addWatermark(doc, $state.snapshot(o) as WatermarkOptions, selection);
    const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    const n = selection?.length ?? f.pages;
    return {
      files: [{ name: `${baseName(f.name)}-marca-dagua.pdf`, bytes, mime: 'application/pdf' }],
      summary: `Marca d’água aplicada em ${n} página${n === 1 ? '' : 's'}.`,
      note: replaced ? `${replaced} caractere(s) não existem na fonte do PDF e saíram como “?”.` : undefined,
    };
  }

  function clear() { src = null; preview = null; }
</script>

<OneFileTool id="marca-dagua" action="Aplicar marca d’água" icon={Droplets} {run} canRun={ready} onpick={pick} onclear={clear} wide>
  {#snippet options(f)}
    <div class="row">
      <span class="label" id="wk-l">Tipo</span>
      <fieldset class="seg" aria-labelledby="wk-l">
        <label><input type="radio" bind:group={o.kind} value="text"> Texto</label>
        <label><input type="radio" bind:group={o.kind} value="image"> Imagem</label>
      </fieldset>
    </div>
    {#if o.kind === 'text'}
      <div class="row">
        <label class="label" for="wm-text">Texto</label>
        <input id="wm-text" type="text" bind:value={o.text} maxlength="80">
      </div>
      <div class="inline">
        <label class="color">Cor <input type="color" bind:value={o.color}></label>
        <label class="check"><input type="checkbox" bind:checked={o.bold}> Negrito</label>
      </div>
      <div class="row">
        <span class="label" id="wd-l">Direção</span>
        <fieldset class="seg" aria-labelledby="wd-l">
          <label><input type="radio" bind:group={o.diagonal} value={true}> Diagonal</label>
          <label><input type="radio" bind:group={o.diagonal} value={false}> Horizontal</label>
        </fieldset>
      </div>
    {:else}
      <div class="row">
        <span class="label">Imagem</span>
        <FileDrop label={imageName ? 'Trocar imagem' : 'Escolher imagem'} accept="image/png,image/jpeg,image/webp" compact onfiles={chooseImage} />
        {#if imageName}<p class="hint">{imageName}</p>{/if}
        {#if imageError}<p class="notice err">{imageError}</p>{/if}
      </div>
    {/if}
    <div class="row">
      <span class="label" id="wl-l">Posição</span>
      <fieldset class="seg" aria-labelledby="wl-l">
        <label><input type="radio" bind:group={o.tile} value={false}> Uma no centro</label>
        <label><input type="radio" bind:group={o.tile} value={true}> Mosaico</label>
      </fieldset>
    </div>
    <div class="row">
      <label class="label" for="wm-size">Tamanho · {Math.round(o.scale * 100)}%</label>
      <input id="wm-size" type="range" min="0.2" max="1" step="0.05" bind:value={o.scale}>
    </div>
    <div class="row">
      <label class="label" for="wm-op">Opacidade · {Math.round(o.opacity * 100)}%</label>
      <input id="wm-op" type="range" min="0.05" max="1" step="0.05" bind:value={o.opacity}>
    </div>
    <div class="row">
      <span class="label" id="wu-l">Camada</span>
      <fieldset class="seg" aria-labelledby="wu-l">
        <label><input type="radio" bind:group={o.under} value={false}> Por cima do conteúdo</label>
        <label><input type="radio" bind:group={o.under} value={true}> Por baixo</label>
      </fieldset>
      {#if o.under}<p class="hint">Por baixo, a marca fica escondida em páginas digitalizadas (a foto da página cobre tudo).</p>{/if}
    </div>
    <PageChoice pages={f.pages} bind:selection />
  {/snippet}
  {#snippet after(f)}
    {#if ready}
      <div class="panel prev">
        <h2>Prévia</h2>
        <PagePreview bytes={preview} width={460} label="Prévia da página {at + 1} com a marca d’água" />
        {#if f.pages > 1}<Pager bind:index={at} pages={f.pages} />{/if}
      </div>
    {/if}
  {/snippet}
</OneFileTool>

<style>
  .inline { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; }
  .color { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; }
  .color input { width: 48px; height: 40px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; background: var(--surface); }
  .check { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-weight: 600; font-size: 15px; cursor: pointer; }
  .check input { width: 20px; height: 20px; }
  input[type="range"] { width: 100%; max-width: 420px; min-height: 32px; accent-color: var(--accent); }
</style>
