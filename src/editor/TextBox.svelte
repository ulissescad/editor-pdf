<script lang="ts">
  import { onMount } from 'svelte';
  import { FONTS, LINE, PAD, isItalic, minHeight, type TextObj } from './model';
  import { localSize } from './geom';
  import { HANDLES, startDrag } from './drag';
  import type { EditorState } from './state.svelte';

  let { obj, ed }: { obj: TextObj; ed: EditorState } = $props();

  let content: HTMLDivElement;
  let overflow = $state(false);
  let caret: { x: number; y: number } | null = null; // onde colocar o cursor ao entrar na edição

  const selected = $derived(ed.selectedId === obj.id);
  const editing = $derived(ed.editingId === obj.id);
  const geo = $derived.by(() => {
    void ed.layoutTick; // recalcula quando o zoom ou a página mudam
    return ed.view?.boxGeometry(obj) ?? { left: 0, top: 0, width: 0, height: 0, scale: 1, turn: 0, cw: 0, ch: 0 };
  });

  onMount(() => {
    try { content.contentEditable = 'plaintext-only'; } catch { content.contentEditable = 'true'; }
    content.textContent = obj.text;
    ed.contentEls.set(obj.id, content);
    return () => ed.contentEls.delete(obj.id);
  });

  // Texto alterado por fora (desfazer/refazer) enquanto não está em edição
  $effect(() => {
    const t = obj.text;
    if (!editing && content && content.innerText.replace(/\n$/, '') !== t) content.textContent = t;
  });

  // Indicador de texto cortado (caixa menor que o conteúdo)
  $effect(() => {
    void geo; void obj.text; void obj.style.size; void obj.style.font; void obj.style.bold;
    requestAnimationFrame(() => { if (content) overflow = content.scrollHeight > content.clientHeight + 1; });
  });

  // Entrar em edição: foco + cursor no ponto tocado (ou no fim)
  $effect(() => {
    if (!editing || !content || document.activeElement === content) return;
    content.focus({ preventScroll: true });
    placeCaret();
    if (matchMedia('(pointer: coarse)').matches) {
      // Espera o teclado virtual abrir e centraliza a caixa na área visível
      setTimeout(() => content?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
    }
  });

  function placeCaret() {
    const sel = window.getSelection();
    if (!sel) return;
    let range: Range | null = null;
    if (caret) {
      const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
      if (d.caretPositionFromPoint) {
        const p = d.caretPositionFromPoint(caret.x, caret.y);
        if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
      } else if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(caret.x, caret.y);
      }
      caret = null;
    }
    if (!range || !content.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(content);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Cresce a altura enquanto se digita (nunca encolhe sozinha)
  function autoGrow() {
    const need = content.scrollHeight / geo.scale;
    if (need > localSize(obj.rect, obj.rot).h + 0.5) ed.growTo(obj, need);
  }

  function onInput() {
    obj.text = content.innerText.replace(/\n$/, '');
    autoGrow();
    ed.scheduleSave();
  }

  function onBlur() {
    if (ed.editingId === obj.id) ed.stopEditing();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); ed.stopEditing(); content.blur(); }
    e.stopPropagation(); // atalhos do editor não valem dentro do texto
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  }

  // Depois de um toque, o navegador ainda gera um mousedown “de compatibilidade” no mesmo ponto.
  // Se ele cair numa alça ou na moldura, tiraria o foco do texto recém-criado: impedimos isso.
  function onMouseDown(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest('.tcontent')) e.preventDefault();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.dataset.h;
    const onGrip = target.classList.contains('grip');
    if (editing && !handle && !onGrip) return; // durante a edição o clique no texto é do navegador
    e.preventDefault();
    e.stopPropagation();
    if (!selected) ed.select(obj.id);
    // Arrastar move ou redimensiona; um toque sem arrastar entra na edição do texto
    startDrag(e, {
      ed, obj, scale: geo.scale, mode: handle ?? 'move',
      minW: Math.max(12, obj.style.size), minH: minHeight(obj.style),
      onTap: !handle && !onGrip ? (ev) => { caret = { x: ev.clientX, y: ev.clientY }; ed.startEditing(obj.id); } : undefined,
    });
  }

</script>

<!-- Arrastar/redimensionar com ponteiro; pelo teclado: setas movem, Delete apaga, Enter edita (Editor.svelte) -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="tbox"
  class:selected
  class:editing
  class:overflow
  data-id={obj.id}
  style:left="{geo.left}px"
  style:top="{geo.top}px"
  style:width="{geo.width}px"
  style:height="{geo.height}px"
  onpointerdown={onPointerDown}
  onmousedown={onMouseDown}
  role="group"
  aria-label="Caixa de texto"
>
  {#if selected}
    <div class="grip" title="Arraste para mover" aria-hidden="true">✥ mover</div>
  {/if}
  <div
    bind:this={content}
    class="tcontent"
    class:turned={geo.turn !== 0}
    style:width={geo.turn ? `${geo.cw}px` : null}
    style:height={geo.turn ? `${geo.ch}px` : null}
    style:transform={geo.turn ? `translate(-50%, -50%) rotate(${geo.turn}deg)` : null}
    role="textbox"
    aria-multiline="true"
    tabindex="-1"
    spellcheck="true"
    style:font-family={FONTS[obj.style.font].css}
    style:font-size="{obj.style.size * geo.scale}px"
    style:font-weight={obj.style.bold ? 700 : 400}
    style:font-style={isItalic(obj.style) ? 'italic' : 'normal'}
    style:color={obj.style.color}
    style:text-align={obj.style.align}
    style:line-height={LINE}
    style:padding="{PAD * geo.scale}px"
    oninput={onInput}
    onblur={onBlur}
    onkeydown={onKeydown}
    onpaste={onPaste}
  ></div>
  {#if selected}
    {#each HANDLES as h (h)}<span class="handle" data-h={h}></span>{/each}
  {/if}
</div>

<style>
  .tbox {
    position: absolute; pointer-events: auto; cursor: move; touch-action: none;
    outline: 1px dashed rgba(36, 87, 214, .5);
  }
  .tbox:hover { outline-color: #2457d6; }
  .tbox.selected { outline: 1.5px solid #2457d6; }
  .tbox.overflow { outline: 1.5px dashed #d13a3a; }
  .tbox.editing { cursor: text; }
  .tcontent {
    width: 100%; height: 100%; overflow: hidden; white-space: pre-wrap; overflow-wrap: break-word;
    outline: none; pointer-events: none; -webkit-user-select: text; user-select: text;
  }
  .tbox.editing .tcontent { pointer-events: auto; }
  /* Página girada depois de escrever: o texto gira junto com ela */
  .tcontent.turned { position: absolute; left: 50%; top: 50%; }
  .handle {
    position: absolute; width: 12px; height: 12px; background: #fff; border: 1.5px solid #2457d6; border-radius: 3px;
    touch-action: none;
  }
  .handle[data-h="nw"] { left: -7px; top: -7px; cursor: nwse-resize; }
  .handle[data-h="n"]  { left: calc(50% - 6px); top: -7px; cursor: ns-resize; }
  .handle[data-h="ne"] { right: -7px; top: -7px; cursor: nesw-resize; }
  .handle[data-h="e"]  { right: -7px; top: calc(50% - 6px); cursor: ew-resize; }
  .handle[data-h="se"] { right: -7px; bottom: -7px; cursor: nwse-resize; }
  .handle[data-h="s"]  { left: calc(50% - 6px); bottom: -7px; cursor: ns-resize; }
  .handle[data-h="sw"] { left: -7px; bottom: -7px; cursor: nesw-resize; }
  .handle[data-h="w"]  { left: -7px; top: calc(50% - 6px); cursor: ew-resize; }
  /* Toque: só os 4 cantos (ajustam largura e altura juntas), pequenos para não cobrir o texto,
     com área de toque invisível de ~44 px */
  @media (pointer: coarse) {
    .handle { width: 16px; height: 16px; border-width: 2px; border-radius: 50%; }
    .handle[data-h="n"], .handle[data-h="s"], .handle[data-h="e"], .handle[data-h="w"] { display: none; }
    .handle[data-h="nw"], .handle[data-h="sw"] { left: -9px; }
    .handle[data-h="ne"], .handle[data-h="se"] { right: -9px; }
    .handle[data-h="nw"], .handle[data-h="ne"] { top: -9px; }
    .handle[data-h="sw"], .handle[data-h="se"] { bottom: -9px; }
    .handle::after { content: ''; position: absolute; inset: -14px; }
  }
  .grip {
    position: absolute; left: -1px; top: -24px; height: 22px; padding: 0 8px;
    background: #2457d6; color: #fff; font: 600 12px/22px system-ui, sans-serif; border-radius: 4px 4px 0 0;
    cursor: move; user-select: none; touch-action: none; white-space: nowrap;
  }
  @media (pointer: coarse) {
    .grip { top: -34px; height: 30px; line-height: 30px; padding: 0 12px; font-size: 14px; }
  }
</style>
