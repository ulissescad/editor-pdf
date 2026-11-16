<script lang="ts">
  // Prévia de uma página: desenha a página `index` de `doc` (pdf.js) ou a primeira página de `bytes`.
  // `overlay` fica por cima, no mesmo tamanho da página (ex.: a área do recorte).
  import type { Snippet } from 'svelte';
  import { closePdf, openPdf, type PDFDocumentProxy } from '../pdf/pdfjs';
  import Loader from '@lucide/svelte/icons/loader-circle';

  let {
    doc = null, bytes = null, index = 0, width = 320, maxVh = 0, label = 'Prévia', overlay,
  }: {
    doc?: PDFDocumentProxy | null; bytes?: Uint8Array | null; index?: number; width?: number; label?: string;
    /** Altura máxima em % da tela (a página inteira cabe na tela, sem rolar). 0 = sem limite. */
    maxVh?: number;
    overlay?: Snippet<[{ width: number; height: number }]>;
  } = $props();

  let canvas: HTMLCanvasElement;
  let size = $state<{ width: number; height: number } | null>(null);
  let drawing = $state(false);
  let token = 0;

  $effect(() => {
    const job = ++token;
    const src = bytes, d = doc, i = index, w = width;
    if (!src && !d) return;
    drawing = true;
    (async () => {
      let owned: PDFDocumentProxy | null = null;
      try {
        const pdf = src ? (owned = await openPdf(src)) : d!;
        const page = await pdf.getPage(src ? 1 : i + 1);
        const base = page.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (w / base.width) * ratio });
        const off = document.createElement('canvas'); // desenha fora da tela e troca de uma vez
        off.width = Math.floor(viewport.width);
        off.height = Math.floor(viewport.height);
        await page.render({ canvas: off, viewport, intent: 'print' }).promise;
        if (job !== token) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')!.drawImage(off, 0, 0);
        size = { width: base.width, height: base.height };
      } catch (err) {
        if (job === token) console.error(err);
      } finally {
        if (owned) await closePdf(owned);
        if (job === token) drawing = false;
      }
    })();
  });
</script>

<figure class="preview"
  style:max-width={maxVh && size ? `min(${width}px, calc(${maxVh}dvh * ${size.width / size.height}))` : `${width}px`}>
  <div class="sheet" style:aspect-ratio={size ? `${size.width} / ${size.height}` : '1 / 1.414'}>
    <canvas bind:this={canvas} aria-label={label}></canvas>
    {#if size && overlay}<div class="overlay">{@render overlay(size)}</div>{/if}
    {#if drawing}<span class="busy" aria-hidden="true"><Loader size={18} class="spin" /></span>{/if}
  </div>
</figure>

<style>
  .preview { margin: 0 auto; width: 100%; }
  .sheet { position: relative; width: 100%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .3); }
  canvas { display: block; width: 100%; height: 100%; }
  .overlay { position: absolute; inset: 0; }
  .busy { position: absolute; top: 6px; right: 6px; color: var(--muted); background: var(--surface); border-radius: 999px; display: flex; padding: 3px; }
</style>
