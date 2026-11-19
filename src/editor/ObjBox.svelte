<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { FONTS, LINE, keepsAspect, type FieldObj, type ImageObj, type InkObj, type NoteObj, type ShapeObj, type SymbolObj } from './model';
  import { SYMBOL_DEFS } from './symbols';
  import { NOTE_ICON, SHAPE_LABELS, inkPath, shapeGeometry } from './draw';
  import { localSize, toView, viewSize } from './geom';
  import { CORNERS, HANDLES, startDrag } from './drag';
  import { keepAboveKeyboard } from './keyboard';
  import type { EditorState } from './state.svelte';

  // Imagens, assinaturas, símbolos, campos de formulário, caneta, formas e notas
  // (as caixas de texto têm o TextBox; destaques, o MarkBox).
  let { obj, ed }: { obj: ImageObj | SymbolObj | FieldObj | InkObj | ShapeObj | NoteObj; ed: EditorState } = $props();

  let input = $state<HTMLInputElement | HTMLTextAreaElement>();
  const selected = $derived(ed.selectedId === obj.id);
  const editing = $derived(ed.editingId === obj.id);
  const geo = $derived.by(() => {
    void ed.layoutTick; // recalcula quando o zoom ou a página mudam
    return ed.view?.boxGeometry(obj) ?? { left: 0, top: 0, width: 0, height: 0, scale: 1, turn: 0, cw: 0, ch: 0 };
  });
  const handles = $derived(
    obj.kind === 'note' ? [] : keepsAspect(obj) || (obj.kind === 'field' && obj.type === 'check') ? CORNERS : HANDLES,
  );
  const local = $derived(localSize(obj.rect, obj.rot)); // tamanho do conteúdo (pt), sem giro
  // Nota perto da borda direita: o balão do comentário abre para a esquerda
  const popLeft = $derived.by(() => {
    if (obj.kind !== 'note') return false;
    const g = ed.geo(obj.page);
    return toView(obj.rect, g).x > viewSize(g)[0] * 0.55;
  });
  // Traços (caneta, formas vazadas): só o traço recebe o toque; o vazio deixa passar para o que está embaixo
  const passThrough = $derived(obj.kind === 'ink' || (obj.kind === 'shape' && obj.shape !== 'whiteout'));
  const hitWidth = $derived(obj.kind === 'ink' || obj.kind === 'shape' ? obj.width + 14 / geo.scale : 0);
  // Só objetos pequenos nas duas dimensões (símbolos, caixinhas) ganham área de toque extra;
  // num campo baixo e largo ela cobriria o campo vizinho
  const small = $derived(geo.width < 32 && geo.height < 32);
  const label = $derived(
    obj.kind === 'image' ? (obj.signature ? t('Assinatura') : t('Imagem'))
      : obj.kind === 'symbol' ? t('Símbolo {name}', { name: t(SYMBOL_DEFS[obj.symbol].label).toLowerCase() })
      : obj.kind === 'ink' ? (obj.opacity !== undefined ? t('Marca-texto') : t('Desenho à mão'))
      : obj.kind === 'shape' ? t(SHAPE_LABELS[obj.shape])
      : obj.kind === 'note' ? `${t('Nota')}${obj.text ? `: ${obj.text}` : ''}`
      : t('Campo {name}', { name: obj.name }),
  );

  // Entrar na edição de um campo de texto: foco + teclado virtual
  $effect(() => {
    if (!editing || !input || document.activeElement === input) return;
    input.focus({ preventScroll: true });
    const len = input.value.length;
    input.setSelectionRange(len, len);
  });
  $effect(() => (editing && input ? keepAboveKeyboard(input) : undefined));

  function tap() {
    if (obj.kind === 'note') { ed.startEditing(obj.id); return; }
    if (obj.kind !== 'field') return;
    if (obj.type === 'check') { obj.value = obj.value ? '' : 'sim'; ed.commit(); }
    else ed.startEditing(obj.id);
  }

  // Depois de um toque o navegador gera um mousedown “de compatibilidade”: não deixa tirar o foco do campo
  function onMouseDown(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest('.fvalue, .note-pop')) e.preventDefault();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.dataset.h;
    const onGrip = target.classList.contains('grip');
    if (editing && !handle && !onGrip) return; // digitando no campo
    e.preventDefault();
    e.stopPropagation();
    if (!selected) ed.select(obj.id);
    const min = obj.kind === 'field' && obj.type === 'text' ? [20, 8] : obj.kind === 'ink' || obj.kind === 'shape' ? [4, 4] : [6, 6];
    startDrag(e, {
      ed, obj, scale: geo.scale, mode: handle ?? 'move', minW: min[0], minH: min[1],
      aspect: keepsAspect(obj), onLongPress: (x, y) => ed.openMenu(obj.id, x, y), onTap: handle || onGrip ? undefined : tap,
    });
  }

  function onInput() {
    if (!input) return;
    if (obj.kind === 'field') obj.value = input.value;
    else if (obj.kind === 'note') obj.text = input.value;
    else return;
    ed.scheduleSave();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' || (e.key === 'Enter' && input instanceof HTMLInputElement)) {
      e.preventDefault();
      ed.stopEditing();
      input?.blur();
    }
    e.stopPropagation(); // atalhos do editor não valem dentro do campo
  }
</script>

<!-- Arrastar/redimensionar com ponteiro; pelo teclado: setas movem, Delete apaga, Enter edita (Editor.svelte) -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="obox {obj.kind}"
  class:selected
  class:editing
  class:small
  class:check={obj.kind === 'field' && obj.type === 'check'}
  class:pass={passThrough}
  class:whiteout={obj.kind === 'shape' && obj.shape === 'whiteout'}
  data-id={obj.id}
  style:left="{geo.left}px"
  style:top="{geo.top}px"
  style:width="{geo.width}px"
  style:height="{geo.height}px"
  onpointerdown={onPointerDown}
  onmousedown={onMouseDown}
  role={obj.kind === 'field' && obj.type === 'check' ? 'checkbox' : 'group'}
  aria-checked={obj.kind === 'field' && obj.type === 'check' ? !!obj.value : undefined}
  aria-label={label}
>
  {#if selected && obj.kind !== 'note'}
    <div class="grip" title={t('Arraste para mover')} aria-hidden="true">✥ {obj.kind === 'field' ? obj.name : t('mover')}</div>
  {/if}

  <div class="inner" class:turned={geo.turn !== 0}
    style:width={geo.turn ? `${geo.cw}px` : null}
    style:height={geo.turn ? `${geo.ch}px` : null}
    style:transform={geo.turn ? `translate(-50%, -50%) rotate(${geo.turn}deg)` : null}>
  {#if obj.kind === 'image'}
    <img src={ed.imageUrl(obj.imageId)} alt="" draggable="false">
  {:else if obj.kind === 'symbol'}
    {@const def = SYMBOL_DEFS[obj.symbol]}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={def.path} fill={def.stroke ? 'none' : obj.color} stroke={def.stroke ? obj.color : 'none'}
        stroke-width={def.stroke ?? 0} stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  {:else if obj.kind === 'ink'}
    {@const d = inkPath(obj.paths, local.w, local.h)}
    <svg viewBox="0 0 {local.w} {local.h}" preserveAspectRatio="none" aria-hidden="true">
      <path class="hit" {d} stroke-width={hitWidth} />
      <path {d} fill="none" stroke={obj.color} stroke-width={obj.width} stroke-opacity={obj.opacity ?? 1}
        stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  {:else if obj.kind === 'shape'}
    {@const sg = shapeGeometry(obj, local.w, local.h)}
    <svg viewBox="0 0 {local.w} {local.h}" preserveAspectRatio="none" aria-hidden="true">
      {#if sg.stroke}<path class="hit" d={sg.stroke} stroke-width={hitWidth} />{/if}
      {#if sg.fill}<path class="hit-fill" d={sg.fill} fill={obj.color} />{/if}
      {#if sg.stroke}
        <path d={sg.stroke} fill="none" stroke={obj.color} stroke-width={obj.width} stroke-linecap="round" stroke-linejoin="round" />
      {/if}
    </svg>
  {:else if obj.kind === 'note'}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={NOTE_ICON.body} fill={obj.color} stroke={NOTE_ICON.ink} stroke-width="1.2" />
      <path d={NOTE_ICON.lines} fill="none" stroke={NOTE_ICON.ink} stroke-width="1.5" />
    </svg>
  {:else if obj.type === 'check'}
    {#if obj.value}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={SYMBOL_DEFS.check.path} fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" /></svg>
    {/if}
  {:else if obj.multiline}
    <textarea bind:this={input} class="fvalue" value={obj.value} aria-label={t('Valor de {name}', { name: obj.name })} tabindex="-1" spellcheck="true"
      style:font-family={FONTS.sans.css} style:font-size="{obj.size * geo.scale}px" style:line-height={LINE}
      style:padding="{2 * geo.scale}px"
      oninput={onInput} onblur={() => ed.editingId === obj.id && ed.stopEditing()} onkeydown={onKeydown}></textarea>
  {:else}
    <input bind:this={input} class="fvalue" value={obj.value} aria-label={t('Valor de {name}', { name: obj.name })} tabindex="-1" spellcheck="true"
      style:font-family={FONTS.sans.css} style:font-size="{obj.size * geo.scale}px" style:padding="0 {2 * geo.scale}px"
      oninput={onInput} onblur={() => ed.editingId === obj.id && ed.stopEditing()} onkeydown={onKeydown}>
  {/if}
  </div>

  {#if selected}
    {#each handles as h (h)}<span class="handle" data-h={h}></span>{/each}
  {/if}

  {#if obj.kind === 'note' && editing}
    <div class="note-pop" class:left={popLeft} style:--c={obj.color}>
      <textarea bind:this={input} value={obj.text} placeholder={t('Escreva o comentário')} aria-label={t('Texto da nota')} rows="4"
        oninput={onInput} onblur={() => ed.editingId === obj.id && ed.stopEditing()} onkeydown={onKeydown}></textarea>
      <small>{t('O comentário vai para o PDF como nota: aparece ao tocar no ícone.')}</small>
    </div>
  {/if}
</div>

<style>
  .obox { position: absolute; pointer-events: auto; cursor: move; touch-action: none; -webkit-touch-callout: none; }
  .obox.image, .obox.symbol { outline: 1px dashed transparent; }
  .obox:hover { outline: 1px dashed #2457d6; }
  .obox.selected { outline: 1.5px solid #2457d6; }
  /* Campos: fundo azul-claro como os campos do pdf.js, borda roxa para diferenciar das caixas de texto */
  .obox.field { background: rgba(122, 63, 209, .1); outline: 1px dashed rgba(122, 63, 209, .7); }
  .obox.field.selected { outline: 1.5px solid #7a3fd1; }
  .obox.field.check { background: rgba(122, 63, 209, .14); }
  .obox.editing { cursor: text; }
  .obox.note.editing { cursor: move; }
  /* Caneta e formas vazadas: só o traço recebe o toque (a área vazia deixa tocar no que está embaixo) */
  .obox.pass { pointer-events: none; outline: 0; }
  .obox.pass.selected { pointer-events: auto; outline: 1.5px dashed #2457d6; }
  .obox.whiteout:not(.selected) { outline: 0; }
  .hit { fill: none; stroke: transparent; stroke-linecap: round; stroke-linejoin: round; pointer-events: stroke; cursor: pointer; }
  .hit-fill { pointer-events: fill; }
  /* Objetos pequenos (símbolos, caixinhas): área de toque maior, invisível */
  @media (pointer: coarse) { .obox.small::before { content: ''; position: absolute; inset: -8px; } }
  .inner { width: 100%; height: 100%; }
  /* Página girada depois de colocar o objeto: ele gira junto com ela */
  .inner.turned { position: absolute; left: 50%; top: 50%; }
  img, svg { display: block; width: 100%; height: 100%; pointer-events: none; user-select: none; -webkit-user-drag: none; }
  .fvalue {
    display: block; width: 100%; height: 100%; margin: 0; border: 0; background: transparent; color: #000;
    outline: none; resize: none; overflow: hidden; pointer-events: none; box-sizing: border-box;
  }
  .obox.editing .fvalue { pointer-events: auto; }
  .handle {
    position: absolute; width: 12px; height: 12px; background: #fff; border: 1.5px solid #2457d6; border-radius: 3px; touch-action: none;
  }
  .handle[data-h="nw"] { left: -7px; top: -7px; cursor: nwse-resize; }
  .handle[data-h="n"]  { left: calc(50% - 6px); top: -7px; cursor: ns-resize; }
  .handle[data-h="ne"] { right: -7px; top: -7px; cursor: nesw-resize; }
  .handle[data-h="e"]  { right: -7px; top: calc(50% - 6px); cursor: ew-resize; }
  .handle[data-h="se"] { right: -7px; bottom: -7px; cursor: nwse-resize; }
  .handle[data-h="s"]  { left: calc(50% - 6px); bottom: -7px; cursor: ns-resize; }
  .handle[data-h="sw"] { left: -7px; bottom: -7px; cursor: nesw-resize; }
  .handle[data-h="w"]  { left: -7px; top: calc(50% - 6px); cursor: ew-resize; }
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
    position: absolute; left: -1px; top: -24px; height: 22px; padding: 0 8px; max-width: 240px; overflow: hidden; text-overflow: ellipsis;
    background: #2457d6; color: #fff; font: 600 12px/22px system-ui, sans-serif; border-radius: 4px 4px 0 0;
    cursor: move; user-select: none; touch-action: none; white-space: nowrap;
  }
  .field .grip { background: #7a3fd1; }
  .note-pop {
    position: absolute; left: 0; top: calc(100% + 6px); z-index: 2; width: 240px; padding: 8px; cursor: default;
    background: var(--surface); color: var(--text); border: 1px solid var(--border); border-top: 4px solid var(--c);
    border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, .22);
  }
  .note-pop.left { left: auto; right: 0; }
  .note-pop textarea {
    display: block; width: 100%; box-sizing: border-box; resize: vertical; min-height: 72px; padding: 6px 8px;
    border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: 15px/1.35 system-ui, sans-serif;
  }
  .note-pop small { display: block; margin-top: 4px; color: var(--muted); font: 12px/1.3 system-ui, sans-serif; }
  @media (pointer: coarse) {
    .grip { top: -34px; height: 30px; line-height: 30px; padding: 0 12px; font-size: 14px; }
  }
</style>
