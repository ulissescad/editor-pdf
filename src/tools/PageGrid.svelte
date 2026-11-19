<script lang="ts" module>
  export interface PageItem {
    key: string;
    src: number;        // arquivo de origem (-1 = página em branco)
    index: number;      // página no arquivo de origem (0-based)
    rotate: number;     // giro a somar ao da página
    blank?: { width: number; height: number };
  }
  let seq = 0;
  export const pageKey = () => `p${(seq++).toString(36)}`;
  export const itemsFor = (src: number, count: number): PageItem[] =>
    Array.from({ length: count }, (_, index) => ({ key: pageKey(), src, index, rotate: 0 }));
</script>

<script lang="ts">
  import { t, tn } from '../lib/i18n.svelte';
  // Grade de páginas para organizar: selecionar, reordenar (arrastar ou botões), girar, duplicar,
  // excluir e inserir página em branco. Pensada primeiro para o toque.
  import { thumb, type Thumbs } from './thumbs';
  import { moveItem, sortable } from './sortable';
  import { normRot } from '../editor/geom';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Copy from '@lucide/svelte/icons/copy';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import FilePlus from '@lucide/svelte/icons/file-plus-2';
  import Grip from '@lucide/svelte/icons/grip-vertical';
  import CheckSquare from '@lucide/svelte/icons/square-check-big';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';

  let {
    items = $bindable(), thumbs, sourceNames = [], sizeOf, extraActions,
  }: {
    items: PageItem[];
    thumbs: Thumbs;
    sourceNames?: string[];
    /** Tamanho da página como se vê (para a página em branco nova ter o mesmo tamanho). */
    sizeOf: (it: PageItem) => { width: number; height: number };
    extraActions?: Snippet;
  } = $props();

  let selected = $state<string[]>([]);
  let announce = $state('');
  const multi = $derived(sourceNames.length > 1);
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Seleção some quando a página some
  $effect(() => {
    const keys = new Set(items.map((i) => i.key));
    if (selected.some((k) => !keys.has(k))) selected = selected.filter((k) => keys.has(k));
  });

  const isSel = (k: string) => selected.includes(k);
  function toggle(k: string) { selected = isSel(k) ? selected.filter((x) => x !== k) : [...selected, k]; }
  const selIdx = () => items.flatMap((it, i) => (isSel(it.key) ? [i] : []));

  function rotate(delta: number) {
    items = items.map((it) => (isSel(it.key) ? { ...it, rotate: normRot(it.rotate + delta) } : it));
    announce = tn(selected.length, '{n} página girada.', '{n} páginas giradas.');
  }

  function remove() {
    const n = selected.length;
    if (n >= items.length) { announce = t('O documento precisa de pelo menos uma página.'); return; }
    items = items.filter((it) => !isSel(it.key));
    selected = [];
    announce = tn(n, '{n} página excluída.', '{n} páginas excluídas.');
  }

  function duplicate() {
    const out: PageItem[] = [];
    const added: string[] = [];
    for (const it of items) {
      out.push(it);
      if (isSel(it.key)) { const c = { ...it, key: pageKey() }; out.push(c); added.push(c.key); }
    }
    items = out;
    selected = added;
    announce = tn(added.length, '{n} página duplicada.', '{n} páginas duplicadas.');
  }

  /** Move as selecionadas uma posição para trás (-1) ou para frente (+1). */
  function shift(dir: -1 | 1) {
    let list = items.slice();
    const idx = selIdx();
    const order = dir < 0 ? idx : idx.reverse();
    for (const i of order) {
      const j = i + dir;
      if (j < 0 || j >= list.length || isSel(list[j].key)) continue;
      list = moveItem(list, i, j);
    }
    items = list;
  }

  function addBlank() {
    const idx = selIdx();
    const at = idx.length ? idx[idx.length - 1] + 1 : items.length;
    const ref = items[Math.min(at, items.length) - 1] ?? items[0];
    const size = ref ? sizeOf(ref) : { width: 595.28, height: 841.89 };
    const it: PageItem = { key: pageKey(), src: -1, index: 0, rotate: 0, blank: size };
    items = [...items.slice(0, at), it, ...items.slice(at)];
    selected = [it.key];
    announce = t('Página em branco inserida.');
  }
</script>

<div class="grid-wrap">
  <ol class="grid" aria-label={t('Páginas')} use:sortable={{ item: '.card', handle: '.grip', onmove: (a, b) => (items = moveItem(items, a, b)) }}>
    {#each items as it, i (it.key)}
      {@const sel = isSel(it.key)}
      <li class="card" class:sel data-key={it.key}>
        <button class="pick" aria-pressed={sel} aria-label={t('Página {n}', { n: i + 1 }) + (multi && !it.blank ? ' ' + t('(arquivo {f})', { f: LETTERS[it.src] ?? String(it.src + 1) }) : '') + (it.blank ? ' ' + t('em branco') : '') + (it.rotate ? ', ' + t('girada {deg}°', { deg: it.rotate }) : '')}
          onclick={() => toggle(it.key)}>
          <span class="sheet">
            {#if it.blank}
              <span class="blank" style:aspect-ratio="{normRot(it.rotate) % 180 ? it.blank.height : it.blank.width} / {normRot(it.rotate) % 180 ? it.blank.width : it.blank.height}"></span>
            {:else}
              <canvas use:thumb={{ thumbs, src: it.src, index: it.index, rotate: it.rotate }} width="140" height="198"></canvas>
            {/if}
          </span>
          {#if sel}<span class="check" aria-hidden="true"><CheckSquare size={20} /></span>{/if}
        </button>
        <span class="foot">
          <span class="grip" data-drag title={t('Arraste para mover')} aria-hidden="true"><Grip size={18} /></span>
          <span class="num">{i + 1}</span>
          {#if multi && !it.blank}<span class="src" title={sourceNames[it.src]}>{LETTERS[it.src] ?? it.src + 1}</span>{/if}
        </span>
      </li>
    {/each}
  </ol>
</div>

<div class="bar" role="toolbar" aria-label={t('Ações nas páginas')}>
  {#if selected.length}
    <span class="count">{selected.length} selecionada{selected.length === 1 ? '' : 's'}</span>
    <button class="act" onclick={() => rotate(-90)} aria-label={t('Girar para a esquerda')}><RotateCcw size={20} /><span>{t('Girar')} ←</span></button>
    <button class="act" onclick={() => rotate(90)} aria-label={t('Girar para a direita')}><RotateCw size={20} /><span>{t('Girar')} →</span></button>
    <button class="act" onclick={() => shift(-1)} aria-label={t('Mover para trás')}><ArrowLeft size={20} /><span>{t('Antes')}</span></button>
    <button class="act" onclick={() => shift(1)} aria-label={t('Mover para frente')}><ArrowRight size={20} /><span>{t('Depois')}</span></button>
    <button class="act" onclick={duplicate} aria-label={t('Duplicar')}><Copy size={20} /><span>{t('Duplicar')}</span></button>
    <button class="act danger" onclick={remove} aria-label={t('Excluir')}><Trash size={20} /><span>{t('Excluir')}</span></button>
    <button class="act" onclick={() => (selected = [])} aria-label={t('Limpar seleção')}><X size={20} /><span>{t('Limpar')}</span></button>
  {:else}
    <span class="count hint">{t('Toque nas páginas para selecionar. Arraste pela alça para mudar a ordem.')} <Grip size={14} aria-hidden="true" /></span>
    <button class="act" onclick={() => (selected = items.map((i) => i.key))}><CheckSquare size={20} /><span>{t('Todas')}</span></button>
  {/if}
  <button class="act" onclick={addBlank} aria-label={t('Inserir página em branco')}><FilePlus size={20} /><span>{t('Em branco')}</span></button>
  {@render extraActions?.()}
</div>
<p class="visually-hidden" aria-live="polite">{announce}</p>

<style>
  .grid {
    list-style: none; margin: 0; padding: 0; display: grid; gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  }
  @media (max-width: 420px) { .grid { grid-template-columns: repeat(3, 1fr); gap: 10px; } }
  .card { display: flex; flex-direction: column; align-items: center; gap: 4px; user-select: none; -webkit-user-select: none; }
  .card:global(.sorting) { opacity: .55; }
  .card:global(.sorting) .sheet { outline: 2px dashed var(--accent); }
  .pick {
    position: relative; width: 100%; aspect-ratio: 1 / 1.25; display: flex; align-items: center; justify-content: center;
    border: 2px solid transparent; border-radius: 10px; background: var(--surface-2); padding: 6px; cursor: pointer;
  }
  .sel .pick { border-color: var(--accent); background: var(--accent-soft); }
  .sheet { position: absolute; inset: 6px; display: flex; align-items: center; justify-content: center; }
  canvas, .blank {
    display: block; max-width: 100%; max-height: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
  }
  canvas { width: auto; height: auto; }
  .blank { width: 100%; height: auto; max-height: 100%; }
  .check { position: absolute; top: 4px; right: 4px; color: var(--accent); background: var(--surface); border-radius: 6px; display: flex; }
  .foot { display: flex; align-items: center; gap: 4px; font-size: 14px; color: var(--muted); }
  .grip {
    display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 8px;
    cursor: grab; touch-action: none; color: var(--muted);
  }
  .grip:hover { background: var(--surface-2); }
  .num { font-weight: 700; color: var(--text); min-width: 1.5em; }
  .src { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 0 7px; background: var(--accent-soft); color: var(--accent); }

  .bar {
    position: sticky; bottom: 0; z-index: 4; margin: 14px -16px 0; padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
    background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -4px 14px rgba(0, 0, 0, .06);
  }
  .count { font-weight: 700; margin-right: auto; padding: 0 6px; font-size: 14px; }
  .count.hint { font-weight: 400; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; flex: 1 1 220px; }
  .act {
    display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 10px; border: 1px solid var(--border);
    border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .act:hover { border-color: var(--accent); }
  .act.danger { color: var(--err-text); }
  @media (max-width: 640px) {
    .bar { gap: 2px; justify-content: space-between; }
    .count { flex-basis: 100%; }
    .act { flex-direction: column; gap: 2px; min-height: 52px; padding: 2px 6px; font-size: 12px; border: 0; flex: 1 0 52px; }
  }
</style>
