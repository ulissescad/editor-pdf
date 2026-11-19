<script lang="ts">
  // Imagens para PDF (PLANO.md, item 2.4): fotos e imagens (JPG, PNG, WebP…), inclusive da câmera do
  // celular, uma por página. As fotos são reduzidas para no máximo 2400 px e respeitam a orientação.
  import { onDestroy, onMount } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import Result from './Result.svelte';
  import { moveItem, sortable } from './sortable';
  import { takeFiles, type OutFile } from './handoff';
  import { requestOpen } from '../editor/session';
  import { assetFromCanvas, loadImageFile } from '../editor/images';
  import type { ImageAsset } from '../editor/model';
  import type { Orientation, PageSizeId } from '../pdf/pages';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Grip from '@lucide/svelte/icons/grip-vertical';
  import FileOutput from '@lucide/svelte/icons/file-output';
  import Loader from '@lucide/svelte/icons/loader-circle';

  interface Entry { key: number; name: string; asset: ImageAsset; url: string }

  let entries = $state<Entry[]>([]);
  let size = $state<PageSizeId>('a4');
  let orientation = $state<Orientation>('auto');
  let margin = $state(20);
  let busy = $state('');
  let error = $state('');
  let result = $state<OutFile | null>(null);
  let seq = 0;

  onDestroy(() => entries.forEach((e) => URL.revokeObjectURL(e.url)));
  // Imagens compartilhadas de outro app chegam prontas
  onMount(() => {
    const handed = takeFiles('imagens-para-pdf');
    if (handed.length) addFiles(handed.map((f) => new File([f.bytes as BlobPart], f.name)));
  });

  const urlOf = (a: ImageAsset) => URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime }));
  const isImage = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(f.name);

  async function addFiles(list: File[]) {
    error = '';
    const bad: string[] = [];
    for (const [n, f] of list.entries()) {
      if (!isImage(f)) { bad.push(f.name); continue; }
      busy = `Preparando imagem ${n + 1} de ${list.length}…`;
      try {
        const asset = await loadImageFile(f);
        entries = [...entries, { key: seq++, name: f.name, asset, url: urlOf(asset) }];
      } catch (err) {
        console.error(err);
        bad.push(f.name);
      }
    }
    busy = '';
    if (bad.length) error = `Não foi possível usar: ${bad.join(', ')}. Use JPG, PNG ou WebP.`;
  }

  /** Gira a imagem 90° (redesenhando), para fotos que saíram deitadas. */
  async function rotate(e: Entry) {
    const bmp = await createImageBitmap(new Blob([e.asset.bytes as BlobPart], { type: e.asset.mime }));
    const canvas = document.createElement('canvas');
    canvas.width = bmp.height;
    canvas.height = bmp.width;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const asset = await assetFromCanvas(canvas, e.asset.mime, 0.9);
    URL.revokeObjectURL(e.url);
    entries = entries.map((x) => (x.key === e.key ? { ...x, asset, url: urlOf(asset) } : x));
  }

  function remove(e: Entry) {
    URL.revokeObjectURL(e.url);
    entries = entries.filter((x) => x.key !== e.key);
  }
  const move = (from: number, to: number) => { if (to >= 0 && to < entries.length) entries = moveItem(entries, from, to); };

  async function build() {
    error = '';
    busy = 'Gerando o PDF…';
    try {
      const { imagesToPdf } = await import('../pdf/pages');
      const bytes = await imagesToPdf(entries.map((e) => e.asset), { size, orientation, margin });
      const first = entries[0].name.replace(/\.[^.]+$/, '') || 'imagens';
      result = { name: `${entries.length > 1 ? 'imagens' : first}.pdf`, bytes, mime: 'application/pdf' };
    } catch (err) {
      console.error(err);
      error = 'Não foi possível gerar o PDF. Tente novamente.';
    } finally {
      busy = '';
    }
  }

  function reset() {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    entries = [];
    result = null;
  }
</script>

<ToolPage id="imagens-para-pdf" wide>
  {#if result}
    <Result files={[result]} zipName="imagens.zip" summary="{entries.length} página{entries.length === 1 ? '' : 's'}."
      onedit={(f) => requestOpen({ kind: 'file', bytes: f.bytes, name: f.name })} onreset={reset} />
  {:else}
    {#if entries.length}
      <ol class="grid" aria-label="Imagens, na ordem das páginas" use:sortable={{ item: '.card', handle: '.grip', onmove: move }}>
        {#each entries as e, i (e.key)}
          <li class="card">
            <span class="sheet"><img src={e.url} alt="Imagem {i + 1}: {e.name}" draggable="false"></span>
            <span class="foot">
              <span class="grip" aria-hidden="true" title="Arraste para mudar a ordem"><Grip size={18} /></span>
              <span class="num">{i + 1}</span>
              <button class="icon" aria-label="Mover a imagem {i + 1} para antes" disabled={i === 0} onclick={() => move(i, i - 1)}><ArrowLeft size={18} /></button>
              <button class="icon" aria-label="Mover a imagem {i + 1} para depois" disabled={i === entries.length - 1} onclick={() => move(i, i + 1)}><ArrowRight size={18} /></button>
              <button class="icon" aria-label="Girar a imagem {i + 1}" onclick={() => rotate(e)}><RotateCw size={18} /></button>
              <button class="icon danger" aria-label="Remover a imagem {i + 1}" onclick={() => remove(e)}><Trash size={18} /></button>
            </span>
          </li>
        {/each}
      </ol>
    {/if}
    <FileDrop label={entries.length ? 'Adicionar imagens' : 'Escolher imagens'} accept="image/*" multiple camera
      compact={entries.length > 0} onfiles={addFiles} />

    {#if entries.length}
      <div class="panel opts">
        <div class="options">
          <div class="row">
            <span class="label" id="size-l">Tamanho da página</span>
            <fieldset class="seg" aria-labelledby="size-l">
              <label><input type="radio" bind:group={size} value="a4"> A4</label>
              <label><input type="radio" bind:group={size} value="letter"> Carta</label>
              <label><input type="radio" bind:group={size} value="image"> Igual à imagem</label>
            </fieldset>
          </div>
          {#if size !== 'image'}
            <div class="row">
              <span class="label" id="ori-l">Orientação</span>
              <fieldset class="seg" aria-labelledby="ori-l">
                <label><input type="radio" bind:group={orientation} value="auto"> Automática</label>
                <label><input type="radio" bind:group={orientation} value="portrait"> Retrato</label>
                <label><input type="radio" bind:group={orientation} value="landscape"> Paisagem</label>
              </fieldset>
            </div>
          {/if}
          <div class="row">
            <span class="label" id="mar-l">Margem</span>
            <fieldset class="seg" aria-labelledby="mar-l">
              <label><input type="radio" bind:group={margin} value={0}> Sem margem</label>
              <label><input type="radio" bind:group={margin} value={20}> Pequena</label>
              <label><input type="radio" bind:group={margin} value={40}> Grande</label>
            </fieldset>
          </div>
        </div>
        <div class="go">
          <button class="button primary" onclick={build} disabled={!!busy}><FileOutput size={20} aria-hidden="true" /> Gerar PDF</button>
        </div>
      </div>
    {/if}
  {/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</ToolPage>

<style>
  .grid {
    list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  @media (max-width: 420px) { .grid { grid-template-columns: 1fr 1fr; gap: 8px; } }
  .card { display: flex; flex-direction: column; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 8px; user-select: none; -webkit-user-select: none; }
  .card:global(.sorting) { opacity: .6; outline: 2px dashed var(--accent); }
  .sheet { display: flex; align-items: center; justify-content: center; aspect-ratio: 1 / 1.2; background: var(--surface-2); border-radius: 8px; overflow: hidden; }
  img { max-width: 100%; max-height: 100%; display: block; pointer-events: none; }
  .foot { display: flex; align-items: center; flex-wrap: wrap; }
  .grip { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 40px; cursor: grab; touch-action: none; color: var(--muted); }
  .num { font-weight: 700; margin-right: auto; }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 8px; background: none; color: var(--text); cursor: pointer; }
  .icon:hover:not(:disabled) { background: var(--surface-2); }
  .icon:disabled { opacity: .3; cursor: default; }
  .icon.danger { color: var(--err-text); }
  .opts { margin-top: 12px; }
</style>
