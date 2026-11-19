<script lang="ts">
  import { t, tk, tn } from '../lib/i18n.svelte';
  // Digitalizar com a câmera (PLANO.md, item 2.14): foto → marcar os 4 cantos → endireitar e limpar → PDF.
  // Os cantos são marcados à mão (sem detecção automática por IA, R2). Tudo acontece no aparelho.
  import { onDestroy, untrack } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import Result from './Result.svelte';
  import CornerEditor from './CornerEditor.svelte';
  import { moveItem, sortable } from './sortable';
  import type { OutFile } from './handoff';
  import { requestOpen } from '../editor/session';
  import { drawScaled, loadImageFile } from '../editor/images';
  import type { ImageAsset } from '../editor/model';
  import { defaultQuad, isValidQuad, type PageFormat, type Pt, type Quad, type ScanFilter, type Turn } from '../pdf/perspective';
  import { decodeAsset, renderScan, scanAsset } from '../pdf/scan';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Grip from '@lucide/svelte/icons/grip-vertical';
  import Crop from '@lucide/svelte/icons/crop';
  import Check from '@lucide/svelte/icons/check';
  import FileOutput from '@lucide/svelte/icons/file-output';
  import Loader from '@lucide/svelte/icons/loader-circle';

  interface ScanPage {
    key: number; name: string;
    source: ImageAsset; sourceUrl: string;
    quad: Quad; filter: ScanFilter; turn: Turn;
    out: ImageAsset | null; outUrl: string; page: Pt | null;
    format: PageFormat;  // formato com que `out` foi gerada
  }

  const FILTERS: Array<[ScanFilter, string]> = [['doc', tk('Documento')], ['color', tk('Original')], ['gray', tk('Cinza')], ['bw', tk('Preto e branco')]];

  let pages = $state.raw<ScanPage[]>([]);
  let editing = $state<number | null>(null);
  let quad = $state.raw<Quad>([[0, 0], [1, 0], [1, 1], [0, 1]]);
  let filter = $state<ScanFilter>('doc');
  let format = $state<PageFormat>('auto');
  let busy = $state('');
  let error = $state('');
  let result = $state<OutFile | null>(null);
  let preview = $state<HTMLCanvasElement>();
  let seq = 0;

  let source: HTMLCanvasElement | null = null;  // foto em edição, inteira
  let small: HTMLCanvasElement | null = null;   // a mesma foto reduzida, para a prévia

  const current = $derived(pages.find((p) => p.key === editing) ?? null);
  const validQuad = $derived(current ? isValidQuad(quad, current.source.w * current.source.h * 0.01) : false);
  const ready = $derived(pages.filter((p) => p.out));

  onDestroy(() => pages.forEach(release));

  function release(p: ScanPage) {
    URL.revokeObjectURL(p.sourceUrl);
    if (p.outUrl) URL.revokeObjectURL(p.outUrl);
  }

  const urlOf = (a: ImageAsset) => URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime }));
  const isImage = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(f.name);
  const patch = (key: number, change: Partial<ScanPage>) => { pages = pages.map((p) => (p.key === key ? { ...p, ...change } : p)); };

  async function addFiles(list: File[]) {
    error = '';
    const bad: string[] = [];
    let firstNew: number | null = null;
    for (const [n, f] of list.entries()) {
      if (!isImage(f)) { bad.push(f.name); continue; }
      busy = t('Preparando a foto {i} de {n}…', { i: n + 1, n: list.length });
      try {
        const asset = await loadImageFile(f);
        const key = seq++;
        firstNew ??= key;
        pages = [...pages, {
          key, name: f.name, source: asset, sourceUrl: urlOf(asset),
          quad: defaultQuad(asset.w, asset.h), filter, turn: 0, out: null, outUrl: '', page: null, format,
        }];
      } catch (err) {
        console.error(err);
        bad.push(f.name);
      }
    }
    busy = '';
    if (bad.length) error = t('Não foi possível usar: {list}. Use JPG, PNG ou WebP.', { list: bad.join(', ') });
    if (firstNew !== null && editing === null) await edit(firstNew);
  }

  async function edit(key: number) {
    const p = pages.find((x) => x.key === key);
    if (!p) return;
    busy = t('Abrindo a foto…');
    try {
      source = await decodeAsset(p.source);
      small = drawScaled(source, 640);
      quad = p.quad;
      filter = p.filter;
      editing = key;
    } catch (err) {
      console.error(err);
      error = t('Não foi possível abrir esta foto.');
    } finally {
      busy = '';
    }
  }

  // Prévia do resultado: refeita ao soltar um canto e ao trocar o filtro
  function drawPreview() {
    if (!small || !source || !preview || !current || !validQuad) return;
    const k = small.width / source.width;
    const scaled = quad.map(([x, y]) => [x * k, y * k]) as Quad;
    const { canvas } = renderScan(small, { quad: scaled, filter, turn: current.turn, format }, 640);
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d')!.drawImage(canvas, 0, 0);
  }

  $effect(() => {
    // Só estas dependências: arrastar um canto não recalcula a cada movimento (o onrelease cuida disso)
    void [filter, format, editing, preview];
    untrack(drawPreview);
  });

  async function render(p: ScanPage, canvas: HTMLCanvasElement) {
    const { asset, page } = await scanAsset(canvas, { quad: p.quad, filter: p.filter, turn: p.turn, format });
    if (p.outUrl) URL.revokeObjectURL(p.outUrl);
    patch(p.key, { out: asset, outUrl: urlOf(asset), page, quad: p.quad, filter: p.filter, turn: p.turn, format });
  }

  /** Abre a próxima foto que ainda não foi ajustada (fotos escolhidas juntas). */
  async function editNext() {
    const next = pages.find((p) => !p.out);
    if (next) await edit(next.key);
  }

  async function apply() {
    if (!current || !source || !validQuad) return;
    busy = t('Endireitando a página…');
    error = '';
    await tick();
    try {
      await render({ ...current, quad, filter }, source);
      source = small = null;
      editing = null;
      await editNext();
    } catch (err) {
      console.error(err);
      error = t('Não foi possível processar esta foto. Tente novamente.');
    } finally {
      busy = '';
    }
  }

  /** Deixa a tela mostrar o aviso antes de um cálculo pesado. */
  const tick = () => new Promise((r) => setTimeout(r, 30));

  function cancelEdit() {
    const p = current;
    source = small = null;
    editing = null;
    if (p && !p.out) remove(p); // foto nova que a pessoa desistiu de usar
    editNext();
  }

  async function rotate(p: ScanPage) {
    busy = t('Girando…');
    await tick();
    try {
      await render({ ...p, turn: ((p.turn + 1) % 4) as Turn }, await decodeAsset(p.source));
    } catch (err) {
      console.error(err);
      error = t('Não foi possível girar esta página.');
    } finally {
      busy = '';
    }
  }

  function remove(p: ScanPage) {
    release(p);
    pages = pages.filter((x) => x.key !== p.key);
  }

  const move = (from: number, to: number) => { if (to >= 0 && to < pages.length) pages = moveItem(pages, from, to); };

  async function build() {
    error = '';
    busy = t('Gerando o PDF…');
    try {
      // Mudou o formato depois de ajustar? As páginas são refeitas com o formato atual
      for (const [i, p] of ready.entries()) {
        busy = t('Preparando a página {i} de {n}…', { i: i + 1, n: ready.length });
        await tick();
        if (p.format !== format) await render(p, await decodeAsset(p.source));
      }
      busy = t('Gerando o PDF…');
      const { imagesToPdf } = await import('../pdf/pages');
      const images = pages.filter((p) => p.out).map((p) => ({ ...p.out!, page: p.page! }));
      const bytes = await imagesToPdf(images, { size: 'image', orientation: 'auto', margin: 0 });
      result = { name: `${t('digitalizado')}.pdf`, bytes, mime: 'application/pdf' };
    } catch (err) {
      console.error(err);
      error = t('Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      busy = '';
    }
  }

  function reset() {
    pages.forEach(release);
    pages = [];
    result = null;
    editing = null;
  }
</script>

<ToolPage id="digitalizar" wide>
  {#if result}
    <Result files={[result]} zipName="{t('digitalizado')}.zip" summary={tn(ready.length, '{n} página.', '{n} páginas.')}
      onedit={(f) => requestOpen({ kind: 'file', bytes: f.bytes, name: f.name })} onreset={reset} />
  {:else if current}
    <div class="work">
      <div class="panel">
        <h2>{t('Marque os 4 cantos do documento')}</h2>
        <CornerEditor src={current.sourceUrl} width={current.source.w} height={current.source.h} bind:quad onrelease={drawPreview} />
        {#if !validQuad}<p class="notice warn" role="alert">{t('Os cantos se cruzaram ou estão perto demais. Arraste cada um para o seu canto do documento.')}</p>{/if}
      </div>
      <div class="panel side">
        <div class="options">
          <div class="row">
            <span class="label" id="flt-l">{t('Aparência')}</span>
            <fieldset class="seg" aria-labelledby="flt-l">
              {#each FILTERS as [id, label] (id)}
                <label><input type="radio" bind:group={filter} value={id}> {t(label)}</label>
              {/each}
            </fieldset>
          </div>
          <div class="row">
            <span class="label">{t('Prévia')}</span>
            <canvas bind:this={preview} class="preview" aria-label={t('Prévia da página endireitada')}></canvas>
          </div>
        </div>
        <div class="go">
          <button class="button primary" onclick={apply} disabled={!!busy || !validQuad}><Check size={20} aria-hidden="true" /> {t('Usar esta página')}</button>
          <button class="button" onclick={cancelEdit} disabled={!!busy}>{t('Cancelar')}</button>
        </div>
      </div>
    </div>
  {:else}
    {#if pages.length}
      <ol class="grid" aria-label={t('Páginas digitalizadas, em ordem')} use:sortable={{ item: '.card', handle: '.grip', onmove: move }}>
        {#each pages as p, i (p.key)}
          <li class="card">
            <span class="sheet"><img src={p.outUrl || p.sourceUrl} alt={t('Página {n}', { n: i + 1 })} draggable="false"></span>
            <span class="foot">
              <span class="grip" aria-hidden="true" title={t('Arraste para mudar a ordem')}><Grip size={18} /></span>
              <span class="num">{i + 1}</span>
              <button class="icon" aria-label={t('Mover a página {n} para antes', { n: i + 1 })} disabled={i === 0} onclick={() => move(i, i - 1)}><ArrowLeft size={18} /></button>
              <button class="icon" aria-label={t('Mover a página {n} para depois', { n: i + 1 })} disabled={i === pages.length - 1} onclick={() => move(i, i + 1)}><ArrowRight size={18} /></button>
              <button class="icon" aria-label={t('Ajustar os cantos da página {n}', { n: i + 1 })} onclick={() => edit(p.key)}><Crop size={18} /></button>
              <button class="icon" aria-label={t('Girar a página {n}', { n: i + 1 })} disabled={!p.out || !!busy} onclick={() => rotate(p)}><RotateCw size={18} /></button>
              <button class="icon danger" aria-label={t('Remover a página {n}', { n: i + 1 })} onclick={() => remove(p)}><Trash size={18} /></button>
            </span>
          </li>
        {/each}
      </ol>
    {/if}
    <FileDrop label={pages.length ? t('Adicionar página') : t('Escolher fotos')} accept="image/*" multiple camera
      compact={pages.length > 0} hint={t('Fotografe o documento sobre um fundo escuro, com boa luz')} onfiles={addFiles} />

    {#if ready.length}
      <div class="panel opts">
        <div class="options">
          <div class="row">
            <span class="label" id="fmt-l">{t('Tamanho da página')}</span>
            <fieldset class="seg" aria-labelledby="fmt-l">
              <label><input type="radio" bind:group={format} value="auto"> {t('Automático')}</label>
              <label><input type="radio" bind:group={format} value="a4"> A4</label>
              <label><input type="radio" bind:group={format} value="letter"> {t('Carta')}</label>
            </fieldset>
            <p class="hint">{t('Automático mantém a proporção do documento fotografado (e usa A4 ou Carta quando for o caso).')}</p>
          </div>
        </div>
        <div class="go">
          <button class="button primary" onclick={build} disabled={!!busy}><FileOutput size={20} aria-hidden="true" /> {t('Gerar PDF')}</button>
        </div>
      </div>
    {/if}
  {/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</ToolPage>

<style>
  .work { display: grid; gap: 12px; }
  .work .panel + .panel { margin-top: 0; }
  @media (min-width: 900px) {
    .work { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); align-items: start; }
    .side { position: sticky; top: 72px; }
  }
  .preview { display: block; max-width: 100%; max-height: 34dvh; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .3); }
  .grid {
    list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }
  @media (max-width: 460px) { .grid { grid-template-columns: 1fr; } }
  .card { display: flex; flex-direction: column; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 8px; user-select: none; -webkit-user-select: none; }
  .card:global(.sorting) { opacity: .6; outline: 2px dashed var(--accent); }
  .sheet { display: flex; align-items: center; justify-content: center; aspect-ratio: 1 / 1.2; background: var(--surface-2); border-radius: 8px; overflow: hidden; }
  img { max-width: 100%; max-height: 100%; display: block; pointer-events: none; }
  .foot { display: flex; align-items: center; flex-wrap: wrap; }
  .grip { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 44px; cursor: grab; touch-action: none; color: var(--muted); }
  .num { font-weight: 700; margin-right: auto; }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 8px; background: none; color: var(--text); cursor: pointer; }
  .icon:hover:not(:disabled) { background: var(--surface-2); }
  .icon:disabled { opacity: .3; cursor: default; }
  .icon.danger { color: var(--err-text); }
  .opts { margin-top: 12px; }
</style>
