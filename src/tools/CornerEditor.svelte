<script lang="ts">
  import { t, tk } from '../lib/i18n.svelte';
  // Marcar os 4 cantos do documento na foto: arrastar com o dedo ou o mouse, ou usar as setas do teclado.
  // Enquanto arrasta, uma lupa no canto oposto mostra o que está embaixo do dedo.
  import type { Pt, Quad } from '../pdf/perspective';

  let { src, width, height, quad = $bindable(), onrelease }: {
    src: string; width: number; height: number; quad: Quad; onrelease?: () => void;
  } = $props();

  const NAMES = [tk('Canto superior esquerdo'), tk('Canto superior direito'), tk('Canto inferior direito'), tk('Canto inferior esquerdo')];
  const LOUPE = 112, ZOOM = 3;

  let stage: HTMLElement;
  let img: HTMLImageElement;
  let loupe = $state<HTMLCanvasElement>();
  let active = $state(-1);
  let offset: Pt = [0, 0];

  const points = $derived(quad.map((p) => p.join(',')).join(' '));
  // A lupa fica no lado oposto ao canto arrastado, para o dedo não cobrir
  const loupeRight = $derived(active >= 0 && quad[active][0] < width / 2);

  function toImage(e: PointerEvent): Pt {
    const b = stage.getBoundingClientRect();
    return [((e.clientX - b.left) / b.width) * width, ((e.clientY - b.top) / b.height) * height];
  }

  function place(i: number, x: number, y: number) {
    const next = quad.map((p) => [...p]) as Quad;
    next[i] = [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
    quad = next;
  }

  function down(e: PointerEvent, i: number) {
    if (e.button > 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    const [x, y] = toImage(e);
    offset = [quad[i][0] - x, quad[i][1] - y]; // o canto não pula para o centro do dedo
    active = i;
  }

  function move(e: PointerEvent, i: number) {
    if (active !== i) return;
    const [x, y] = toImage(e);
    place(i, x + offset[0], y + offset[1]);
  }

  function up(i: number) {
    if (active !== i) return;
    active = -1;
    onrelease?.();
  }

  function key(e: KeyboardEvent, i: number) {
    const step = (e.shiftKey ? 0.05 : 0.01) * Math.max(width, height);
    const d: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    place(i, quad[i][0] + m[0], quad[i][1] + m[1]);
    onrelease?.();
  }

  $effect(() => {
    if (active < 0 || !loupe) return;
    const [x, y] = quad[active];
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    loupe.width = loupe.height = LOUPE * ratio;
    const ctx = loupe.getContext('2d')!;
    // Quantos pixels da foto cabem na lupa, com o aumento em relação ao que aparece na tela
    const span = (LOUPE / ZOOM) * (width / stage.getBoundingClientRect().width);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(img, x - span / 2, y - span / 2, span, span, 0, 0, loupe.width, loupe.height);
    const c = loupe.width / 2;
    for (const color of ['#000', '#fff']) {
      ctx.strokeStyle = color;
      ctx.lineWidth = (color === '#000' ? 3 : 1) * ratio;
      ctx.beginPath();
      ctx.moveTo(c - 14 * ratio, c); ctx.lineTo(c + 14 * ratio, c);
      ctx.moveTo(c, c - 14 * ratio); ctx.lineTo(c, c + 14 * ratio);
      ctx.stroke();
    }
  });
</script>

<div class="outer">
  <div class="stage" bind:this={stage} style:aspect-ratio="{width} / {height}"
    style:max-width="min(100%, calc(68dvh * {width / height}))">
    <img bind:this={img} {src} alt={t('Foto do documento')} draggable="false">
    <svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true">
      <path class="shade" fill-rule="evenodd" d="M0 0H{width}V{height}H0Z M{quad.map((p) => p.join(' ')).join('L')}Z" />
      <polygon class="edge" {points} vector-effect="non-scaling-stroke" />
    </svg>
    {#each quad as p, i (i)}
      <button type="button" class="handle" class:active={active === i} aria-label={t(NAMES[i])}
        style:left="{(p[0] / width) * 100}%" style:top="{(p[1] / height) * 100}%"
        onpointerdown={(e) => down(e, i)} onpointermove={(e) => move(e, i)}
        onpointerup={() => up(i)} onpointercancel={() => up(i)} onkeydown={(e) => key(e, i)}><span></span></button>
    {/each}
    {#if active >= 0}
      <canvas bind:this={loupe} class="loupe" class:right={loupeRight} style:width="{LOUPE}px" style:height="{LOUPE}px" aria-hidden="true"></canvas>
    {/if}
  </div>
</div>

<style>
  /* Folga para as alças das bordas não saírem da tela */
  .outer { padding: 14px; background: #20242c; border-radius: 12px; }
  .stage { position: relative; margin: 0 auto; width: 100%; user-select: none; -webkit-user-select: none; }
  img { display: block; width: 100%; height: 100%; pointer-events: none; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .shade { fill: rgba(0, 0, 0, .5); }
  .edge { fill: none; stroke: #5b8cff; stroke-width: 2; }
  .handle {
    position: absolute; width: 48px; height: 48px; margin: -24px 0 0 -24px; padding: 0; border: 0; background: none;
    display: flex; align-items: center; justify-content: center; cursor: grab; touch-action: none; border-radius: 50%;
  }
  .handle span { width: 20px; height: 20px; border-radius: 50%; background: rgba(36, 87, 214, .35); border: 3px solid #fff; box-shadow: 0 0 0 1.5px #2457d6, 0 1px 4px rgba(0, 0, 0, .5); }
  .handle.active { cursor: grabbing; }
  .handle.active span { background: transparent; }
  .handle:focus-visible { outline: 3px solid #fff; outline-offset: -6px; }
  .loupe { position: absolute; top: 6px; left: 6px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, .5); pointer-events: none; }
  .loupe.right { left: auto; right: 6px; }
</style>
