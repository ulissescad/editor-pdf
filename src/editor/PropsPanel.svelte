<script lang="ts">
  import { FONTS, isFixed, isItalic, type Align, type FontId, type MarkupType, type ShapeType } from './model';
  import { SYMBOL_DEFS, SYMBOL_IDS } from './symbols';
  import {
    HIGHLIGHT_COLORS, INK_WIDTHS, MARKUP_LABELS, NOTE_COLORS, SHAPE_LABELS, SHAPE_WIDTHS, STROKE_COLORS, shapeFamily,
  } from './draw';
  import type { EditorState } from './state.svelte';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import AlignStart from '@lucide/svelte/icons/text-align-start';
  import AlignCenter from '@lucide/svelte/icons/text-align-center';
  import AlignEnd from '@lucide/svelte/icons/text-align-end';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash from '@lucide/svelte/icons/trash';
  import Calendar from '@lucide/svelte/icons/calendar';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import TextCursorInput from '@lucide/svelte/icons/text-cursor-input';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import WrapText from '@lucide/svelte/icons/text-wrap';
  import Highlighter from '@lucide/svelte/icons/highlighter';
  import Underline from '@lucide/svelte/icons/underline';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import Square from '@lucide/svelte/icons/square';
  import Circle from '@lucide/svelte/icons/circle';
  import Slash from '@lucide/svelte/icons/slash';
  import MoveUpRight from '@lucide/svelte/icons/move-up-right';
  import Eraser from '@lucide/svelte/icons/eraser';
  import PencilLine from '@lucide/svelte/icons/pencil-line';

  let { ed }: { ed: EditorState } = $props();

  const SWATCHES = ['#000000', '#1a3cc8', '#c62828', '#2e7d32'];
  const ALIGNS: { value: Align; label: string; icon: typeof AlignStart }[] = [
    { value: 'left', label: 'Alinhar à esquerda', icon: AlignStart },
    { value: 'center', label: 'Centralizar', icon: AlignCenter },
    { value: 'right', label: 'Alinhar à direita', icon: AlignEnd },
  ];
  const s = $derived(ed.style);
  const sel = $derived(ed.selected);
  // O que o painel mostra: o objeto selecionado ou, sem seleção, a ferramenta ativa
  const TOOL_MODE: Partial<Record<string, string>> = { stamp: 'symbol', field: 'field', markup: 'markup', ink: 'ink', shape: 'shape', note: 'note' };
  const mode = $derived(sel?.kind ?? TOOL_MODE[ed.tool] ?? 'text');
  const field = $derived(sel?.kind === 'field' ? sel : null);
  const coarse = matchMedia('(pointer: coarse)').matches;

  const MARKUP_ICONS: Record<MarkupType, typeof Highlighter> = { highlight: Highlighter, underline: Underline, strike: Strikethrough };
  const SHAPE_ICONS: Record<ShapeType, typeof Square> = { rect: Square, ellipse: Circle, line: Slash, arrow: MoveUpRight, whiteout: Eraser };
  const markType = $derived(sel?.kind === 'markup' ? sel.type : ed.markupType);
  const markColor = $derived(sel?.kind === 'markup' ? sel.color : ed.markupColors[markType]);
  const shapeType = $derived(sel?.kind === 'shape' ? sel.shape : ed.shapeType);
  const shapes = $derived(sel?.kind === 'shape' ? shapeFamily(sel.shape) : (Object.keys(SHAPE_LABELS) as ShapeType[]));
  const marker = $derived(sel?.kind === 'ink' ? sel.opacity !== undefined : ed.inkMarker);

  // Botões que não tiram o foco do texto em edição
  const keepFocus = (e: PointerEvent) => e.preventDefault();
  const setSize = (v: number) => { if (v >= 4 && v <= 96) ed.setStyle({ size: Math.round(v * 2) / 2 }); };
  const setFieldSize = (v: number) => { if (v >= 5 && v <= 36) ed.setField({ size: v }); };
</script>

<div class="props" role="toolbar" aria-label={mode === 'text' ? 'Formatação do texto' : 'Propriedades'}>
  {#if mode === 'text'}
    <select aria-label="Fonte" value={s.font} onchange={(e) => ed.setStyle({ font: e.currentTarget.value as FontId })}>
      {#each Object.entries(FONTS) as [id, f] (id)}<option value={id}>{f.label}</option>{/each}
    </select>

    <div class="group" role="group" aria-label="Tamanho da fonte">
      <button class="icon" aria-label="Diminuir fonte" onpointerdown={keepFocus} onclick={() => setSize(s.size - 1)}><Minus size={18} /></button>
      <input aria-label="Tamanho em pontos" type="number" min="4" max="96" step="0.5" value={s.size}
        onchange={(e) => setSize(Number(e.currentTarget.value))}>
      <button class="icon" aria-label="Aumentar fonte" onpointerdown={keepFocus} onclick={() => setSize(s.size + 1)}><Plus size={18} /></button>
    </div>

    <div class="group" role="group" aria-label="Estilo">
      <button class="icon" aria-label="Negrito" aria-pressed={s.bold} onpointerdown={keepFocus} onclick={() => ed.setStyle({ bold: !s.bold })}><b>N</b></button>
      <button class="icon" aria-label="Itálico" aria-pressed={isItalic(s)} disabled={!FONTS[s.font].italic}
      title={FONTS[s.font].italic ? 'Itálico' : 'Esta fonte não tem itálico'}
      onpointerdown={keepFocus} onclick={() => ed.setStyle({ italic: !s.italic })}><i>I</i></button>
    </div>

    <div class="group" role="group" aria-label="Alinhamento">
      {#each ALIGNS as a (a.value)}
        {@const Icon = a.icon}
        <button class="icon" aria-label={a.label} aria-pressed={s.align === a.value} onpointerdown={keepFocus}
          onclick={() => ed.setStyle({ align: a.value })}><Icon size={18} /></button>
      {/each}
    </div>

    <div class="group" role="group" aria-label="Cor">
      {#each SWATCHES as c (c)}
        <button class="swatch" aria-label="Cor {c}" aria-pressed={s.color === c} style:--c={c} onpointerdown={keepFocus}
          onclick={() => ed.setStyle({ color: c })}></button>
      {/each}
      <input class="color" type="color" aria-label="Outra cor" value={s.color} oninput={(e) => ed.setStyle({ color: e.currentTarget.value })}>
    </div>

  {:else if mode === 'symbol'}
    <div class="group" role="group" aria-label="Símbolo">
      {#each SYMBOL_IDS as id (id)}
        <button class="icon sym" aria-label={SYMBOL_DEFS[id].label} title={SYMBOL_DEFS[id].label} aria-pressed={ed.stamp === id}
          onclick={() => ed.setSymbol({ symbol: id })}>{SYMBOL_DEFS[id].char}</button>
      {/each}
      {#if !sel}
        <button class="icon text" aria-label="Data de hoje" title="Data de hoje" aria-pressed={ed.stamp === 'date'}
          onclick={() => (ed.stamp = 'date')}><Calendar size={18} /><span>Data</span></button>
      {/if}
    </div>
    {#if ed.stamp !== 'date' || sel}
      <div class="group" role="group" aria-label="Cor do símbolo">
        {#each SWATCHES as c (c)}
          <button class="swatch" aria-label="Cor {c}" aria-pressed={ed.symbolColor === c} style:--c={c}
            onclick={() => ed.setSymbol({ color: c })}></button>
        {/each}
      </div>
    {/if}
    {#if !sel}<span class="hint">Toque na página para marcar.</span>{/if}

  {:else if mode === 'field'}
    <div class="group" role="group" aria-label="Tipo de campo">
      <button class="icon text" aria-pressed={(field?.type ?? ed.fieldType) === 'text'} onclick={() => ed.setField({ type: 'text' })}>
        <TextCursorInput size={18} /><span>Texto</span></button>
      <button class="icon text" aria-pressed={(field?.type ?? ed.fieldType) === 'check'} onclick={() => ed.setField({ type: 'check' })}>
        <SquareCheck size={18} /><span>Caixa</span></button>
    </div>
    {#if field}
      <label class="name">Nome
        <input type="text" value={field.name} aria-label="Nome do campo" autocomplete="off" spellcheck="false"
          onchange={(e) => ed.setField({ name: e.currentTarget.value })}>
      </label>
      {#if field.type === 'text'}
        <div class="group" role="group" aria-label="Tamanho da fonte do campo">
          <button class="icon" aria-label="Diminuir fonte do campo" onclick={() => setFieldSize(field.size - 1)}><Minus size={18} /></button>
          <span class="num" aria-live="polite">{field.size}</span>
          <button class="icon" aria-label="Aumentar fonte do campo" onclick={() => setFieldSize(field.size + 1)}><Plus size={18} /></button>
          <button class="icon" aria-label="Várias linhas" title="Várias linhas" aria-pressed={field.multiline}
            onclick={() => ed.setField({ multiline: !field.multiline })}><WrapText size={18} /></button>
        </div>
      {/if}
    {:else}
      <button class="action" onclick={() => ed.detectFields()} disabled={!!ed.busy}><ScanSearch size={18} /> Detectar campos</button>
      <span class="hint">Toque na página para criar um campo.</span>
    {/if}

  {:else if mode === 'markup'}
    <div class="group" role="group" aria-label="Tipo de marcação">
      {#each Object.keys(MARKUP_LABELS) as MarkupType[] as t (t)}
        {@const Icon = MARKUP_ICONS[t]}
        <button class="icon text" aria-pressed={markType === t} onclick={() => ed.setMarkup({ type: t })}><Icon size={18} /><span>{MARKUP_LABELS[t]}</span></button>
      {/each}
    </div>
    <div class="group" role="group" aria-label="Cor da marcação">
      {#each markType === 'highlight' ? HIGHLIGHT_COLORS : STROKE_COLORS as c (c)}
        <button class="swatch" aria-label="Cor {c}" aria-pressed={markColor === c} style:--c={c} onclick={() => ed.setMarkup({ color: c })}></button>
      {/each}
    </div>
    {#if !sel}<span class="hint">{coarse ? 'Arraste o dedo sobre o texto (dois dedos rolam).' : 'Arraste sobre o texto.'} Fora do texto, desenha um retângulo.</span>{/if}

  {:else if mode === 'ink'}
    {#if sel?.kind !== 'ink' || !marker}
      <div class="group" role="group" aria-label="Espessura">
        {#each INK_WIDTHS as wd (wd.value)}
          <button class="icon text" aria-pressed={!marker && (sel?.kind === 'ink' ? sel.width : ed.inkWidth) === wd.value}
            onclick={() => ed.setInk({ width: wd.value })}>
            <span class="stroke" style:height="{Math.max(1, wd.value * 0.8)}px"></span><span>{wd.label}</span></button>
        {/each}
        {#if !sel}
          <button class="icon text" aria-pressed={marker} onclick={() => ed.setInk({ marker: !marker })}><Highlighter size={18} /><span>Marca-texto</span></button>
        {/if}
      </div>
      <div class="group" role="group" aria-label="Cor da caneta">
        {#each STROKE_COLORS as c (c)}
          <button class="swatch" aria-label="Cor {c}" aria-pressed={!marker && (sel?.kind === 'ink' ? sel.color : ed.inkColor) === c} style:--c={c}
            onclick={() => ed.setInk({ color: c })}></button>
        {/each}
      </div>
    {/if}
    {#if !sel}<span class="hint">{coarse ? 'Desenhe com um dedo; dois dedos rolam e dão zoom.' : 'Desenhe arrastando na página.'}</span>{/if}

  {:else if mode === 'shape'}
    <div class="group" role="group" aria-label="Forma">
      {#each shapes as t (t)}
        {@const Icon = SHAPE_ICONS[t]}
        <button class="icon text" aria-label={SHAPE_LABELS[t]} title={SHAPE_LABELS[t]} aria-pressed={shapeType === t}
          onclick={() => ed.setShape({ shape: t })}><Icon size={18} /><span class="lbl">{SHAPE_LABELS[t]}</span></button>
      {/each}
    </div>
    {#if shapeType !== 'whiteout'}
      <div class="group" role="group" aria-label="Espessura do traço">
        {#each SHAPE_WIDTHS as wd (wd.value)}
          <button class="icon" aria-label="Traço {wd.label.toLowerCase()}" title="Traço {wd.label.toLowerCase()}"
            aria-pressed={(sel?.kind === 'shape' ? sel.width : ed.shapeWidth) === wd.value}
            onclick={() => ed.setShape({ width: wd.value })}><span class="stroke" style:height="{wd.value}px"></span></button>
        {/each}
      </div>
      <div class="group" role="group" aria-label="Cor da forma">
        {#each STROKE_COLORS as c (c)}
          <button class="swatch" aria-label="Cor {c}" aria-pressed={(sel?.kind === 'shape' ? sel.color : ed.shapeColor) === c} style:--c={c}
            onclick={() => ed.setShape({ color: c })}></button>
        {/each}
      </div>
    {:else if !sel}
      <span class="hint">O corretivo cobre com branco, mas o texto continua no arquivo. Para apagar de verdade, use “Tarjar”.</span>
    {/if}
    {#if !sel && shapeType !== 'whiteout'}<span class="hint">Arraste na página para desenhar.</span>{/if}

  {:else if mode === 'note'}
    <div class="group" role="group" aria-label="Cor da nota">
      {#each NOTE_COLORS as c (c)}
        <button class="swatch" aria-label="Cor {c}" aria-pressed={(sel?.kind === 'note' ? sel.color : ed.noteColor) === c} style:--c={c}
          onclick={() => ed.setNote({ color: c })}></button>
      {/each}
    </div>
    {#if sel}
      <button class="action" onclick={() => ed.startEditing(sel.id)}><PencilLine size={18} /> Editar comentário</button>
    {:else}
      <span class="hint">Toque na página para deixar um comentário.</span>
    {/if}

  {:else if mode === 'image'}
    <span class="hint">{sel?.kind === 'image' && sel.signature ? 'Assinatura' : 'Imagem'}: arraste para mover e use os cantos para mudar o tamanho.</span>
  {/if}

  {#if sel}
    <div class="group" role="group" aria-label="Objeto selecionado">
      {#if !isFixed(sel)}
        <button class="icon" aria-label="Duplicar" title="Duplicar (Ctrl+D)" onclick={() => ed.duplicate()}><Copy size={18} /></button>
      {/if}
      <button class="icon danger" aria-label="Excluir" title="Excluir (Delete)" onclick={() => ed.remove()}><Trash size={18} /></button>
    </div>
  {/if}
</div>

<style>
  .props { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .group { display: flex; align-items: center; gap: 2px; }
  select, input[type="number"], input[type="text"] {
    height: 40px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit;
  }
  select { padding: 0 6px; max-width: 170px; }
  input[type="number"] { width: 58px; text-align: center; padding: 0 2px; }
  input[type="text"] { width: 150px; padding: 0 8px; }
  .name { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
  .num { min-width: 28px; text-align: center; }
  .icon {
    display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 40px; height: 40px;
    border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text); font: 600 17px/1 Georgia, serif; cursor: pointer;
  }
  .icon.text { font: 600 14px/1 system-ui, sans-serif; padding: 0 8px; }
  .icon.sym { font: 700 20px/1 system-ui, sans-serif; }
  .icon:hover:not(:disabled) { border-color: var(--border); }
  .icon:disabled { opacity: .35; cursor: default; }
  .icon[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .action {
    display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border: 1px solid var(--accent);
    border-radius: 8px; background: var(--accent-soft); color: var(--accent); font: 600 14px/1 system-ui, sans-serif; cursor: pointer; white-space: nowrap;
  }
  .hint { color: var(--muted); font-size: 13px; }
  .stroke { display: inline-block; width: 18px; background: currentColor; border-radius: 2px; }
  @media (max-width: 899px) { .lbl { display: none; } }
  .danger { color: var(--err-text); }
  .swatch { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--surface); background: var(--c); box-shadow: 0 0 0 1px var(--border); cursor: pointer; margin: 0 2px; }
  .swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
  .color { width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; background: var(--surface); cursor: pointer; }
  @media (pointer: coarse) {
    .icon, .action { min-width: 44px; height: 44px; }
    select, input[type="number"], input[type="text"] { height: 44px; }
    .swatch { width: 34px; height: 34px; }
  }
</style>
