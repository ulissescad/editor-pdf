<script lang="ts">
  import type { EditorState } from './state.svelte';

  let { ed, onpick }: { ed: EditorState; onpick?: () => void } = $props();

  const WIDTH = 120;
  const rendered = new WeakSet<HTMLCanvasElement>();

  // Desenha a miniatura só quando ela aparece na lista (documentos grandes)
  function thumb(canvas: HTMLCanvasElement, n: number) {
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting) || rendered.has(canvas) || !ed.doc) return;
      rendered.add(canvas);
      io.disconnect();
      const page = await ed.doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (WIDTH / base.width) * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      await page.render({ canvas, viewport }).promise.catch(() => {});
    }, { rootMargin: '200px' });
    io.observe(canvas);
    return { destroy: () => io.disconnect() };
  }

  function pick(n: number) {
    ed.view?.goToPage(n);
    onpick?.();
  }
</script>

<!-- Documento novo (ex.: depois de organizar as páginas): miniaturas desenhadas de novo -->
{#key ed.doc}
<ol class="thumbs" aria-label="Páginas">
  {#each { length: ed.pages } as _, i (i)}
    <li>
      <button class:current={ed.currentPage === i + 1} aria-current={ed.currentPage === i + 1 ? 'page' : undefined}
        aria-label="Ir para a página {i + 1}" onclick={() => pick(i + 1)}>
        <canvas use:thumb={i + 1} width={WIDTH} height={Math.round(WIDTH * 1.41)}></canvas>
        <span>{i + 1}</span>
      </button>
    </li>
  {/each}
</ol>
{/key}

<style>
  .thumbs { list-style: none; margin: 0; padding: 12px; display: grid; gap: 12px; justify-items: center; }
  button { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 8px; font: inherit; font-size: 13px; }
  canvas { display: block; width: 120px; height: auto; background: #fff; border: 2px solid transparent; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .current canvas { border-color: var(--accent); }
  .current { color: var(--accent); font-weight: 700; }
</style>
