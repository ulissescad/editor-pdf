<script lang="ts">
  import type { EditorState } from './state.svelte';
  import type { Preview } from './sketch';
  import { viewSize } from './geom';

  // O que está sendo desenhado agora (antes de virar objeto), sobre a página, em pt na página vista.
  let { ed, p }: { ed: EditorState; p: Preview } = $props();

  const frame = $derived.by(() => {
    void ed.layoutTick;
    const view = ed.view;
    const [pw, ph] = viewSize(ed.geo(p.page));
    const s = view?.scaleOf(p.page) ?? 1;
    const [left, top] = view?.viewToContainer(p.page, 0, 0) ?? [0, 0];
    return { left, top, pw, ph, width: pw * s, height: ph * s };
  });
</script>

<svg class="sketch" style:left="{frame.left}px" style:top="{frame.top}px" width={frame.width} height={frame.height}
  viewBox="0 0 {frame.pw} {frame.ph}" aria-hidden="true">
  {#if p.kind === 'path'}
    <path d={p.d} fill="none" stroke={p.color} stroke-width={p.width} stroke-opacity={p.opacity ?? 1}
      stroke-linecap="round" stroke-linejoin="round" />
  {:else if p.kind === 'shape'}
    <g transform="translate({p.x} {p.y})">
      {#if p.fill}<path d={p.fill} fill={p.color} stroke={p.color === '#ffffff' ? '#9aa4b5' : 'none'} stroke-width="0.75" stroke-dasharray="3 2" />{/if}
      {#if p.stroke}<path d={p.stroke} fill="none" stroke={p.color} stroke-width={p.width} stroke-linecap="round" stroke-linejoin="round" />{/if}
    </g>
  {:else}
    {#each p.rects as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} fill={p.color} fill-opacity={p.opacity} />{/each}
  {/if}
</svg>

<style>
  .sketch { position: absolute; pointer-events: none; overflow: visible; }
</style>
