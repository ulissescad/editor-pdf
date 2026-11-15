<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { EditorState } from './state.svelte';
  import { PdfView } from './viewer';
  import { takePending, isPdfFile, readPdf } from './session';
  import { canShareFiles, disposePrint, downloadPdf, printPdf, sharePdf } from './output';
  import { LINE, PAD, clamp } from './model';
  import TextBox from './TextBox.svelte';
  import PropsPanel from './PropsPanel.svelte';
  import Thumbnails from './Thumbnails.svelte';
  import SearchBar from './SearchBar.svelte';
  import DraftList from '../components/DraftList.svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Undo from '@lucide/svelte/icons/undo-2';
  import Redo from '@lucide/svelte/icons/redo-2';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import MoveHorizontal from '@lucide/svelte/icons/move-horizontal';
  import Search from '@lucide/svelte/icons/search';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import Printer from '@lucide/svelte/icons/printer';
  import Share from '@lucide/svelte/icons/share-2';
  import Download from '@lucide/svelte/icons/download';
  import More from '@lucide/svelte/icons/ellipsis-vertical';
  import Pointer from '@lucide/svelte/icons/mouse-pointer-2';
  import TypeIcon from '@lucide/svelte/icons/type';
  import Files from '@lucide/svelte/icons/files';
  import FileUp from '@lucide/svelte/icons/file-up';
  import X from '@lucide/svelte/icons/x';
  import Check from '@lucide/svelte/icons/check';
  import Loader from '@lucide/svelte/icons/loader-circle';

  const ed = new EditorState();
  let container: HTMLDivElement;
  let viewerDiv: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let searchOpen = $state(false);
  let thumbsOpen = $state(false);
  let menuOpen = $state(false);
  let dragging = $state(false);
  let drawRect = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  const canShare = canShareFiles();
  const wide = matchMedia('(min-width: 900px)');
  let isWide = $state(wide.matches);
  $effect(() => {
    const onChange = (e: MediaQueryListEvent) => (isWide = e.matches);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  });

  const showProps = $derived(ed.hasDoc && (ed.tool === 'text' || !!ed.selected));
  const fmtTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  onMount(async () => {
    ed.view = await PdfView.create(container, viewerDiv, {
      onLayout: () => ed.layoutTick++,
      onScale: (s) => (ed.scale = s),
      onPage: (p) => (ed.currentPage = p),
      onPagesInit: () => { ed.currentPage = 1; },
      onFind: (r) => (ed.find = { ...ed.find, ...r }),
    });
    const pending = takePending();
    if (pending?.kind === 'file') await ed.openBytes(pending.bytes, pending.name);
    else if (pending?.kind === 'draft') await ed.openDraft(pending.hash);
    if (ed.doc) thumbsOpen = isWide && ed.pages > 1;
    if (import.meta.env.DEV) (window as unknown as { __ed: EditorState }).__ed = ed; // depuração local
    document.documentElement.dataset.editorReady = 'true';
  });

  onDestroy(() => {
    ed.close(); // salva o rascunho pendente e libera o documento (worker do pdf.js)
    ed.view?.destroy();
    disposePrint();
    delete document.documentElement.dataset.editorReady;
  });

  // Salva o rascunho ao trocar de app ou fechar a aba (importante no celular)
  function onVisibility() { if (document.visibilityState === 'hidden') ed.flushSave(); }

  // ================= abrir arquivo =================
  async function openFile(file: File | undefined) {
    if (!file) return;
    const bytes = await readPdf(file);
    if (!bytes) { ed.status = { kind: 'err', text: 'Escolha um arquivo .pdf.' }; return; }
    await ed.flushSave();
    await ed.openBytes(bytes, /\.pdf$/i.test(file.name) ? file.name : `${file.name}.pdf`);
    searchOpen = false;
    thumbsOpen = isWide && ed.pages > 1;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    openFile([...(e.dataTransfer?.files ?? [])].find(isPdfFile) ?? e.dataTransfer?.files[0]);
  }

  // ================= criar caixa de texto =================
  // Ferramenta Texto: toque/clique cria uma caixa de uma linha; arrastar (com mouse/caneta) desenha o tamanho.
  function onContainerPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest('.tbox')) return;
    const pageEl = target.closest<HTMLElement>('.page');
    if (ed.tool !== 'text' || !pageEl || !ed.view) {
      if (ed.selectedId) ed.select(null);
      return;
    }
    const view = ed.view;
    const page = Number(pageEl.dataset.pageNumber) - 1;
    const [px0, py0, px1, py1] = view.pageBounds(page);
    const [x0, y0] = view.clientToPdf(page, e.clientX, e.clientY);
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') e.preventDefault();
    if (ed.selectedId) ed.select(null);
    let rect: { x: number; y: number; w: number; h: number } | null = null;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch') return; // no toque, arrastar rola a página
      if (!rect && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
      const [x1, y1] = view.clientToPdf(page, ev.clientX, ev.clientY);
      const left = clamp(Math.min(x0, x1), px0, px1), right = clamp(Math.max(x0, x1), px0, px1);
      const top = clamp(Math.max(y0, y1), py0, py1), bottom = clamp(Math.min(y0, y1), py0, py1);
      rect = { x: left, y: top, w: right - left, h: top - bottom };
      const s = view.scaleOf(page);
      const [l, t] = view.toContainer(page, rect.x, rect.y);
      drawRect = { left: l, top: t, width: rect.w * s, height: rect.h * s };
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      drawRect = null;
      if (ev.type === 'pointercancel') return; // o toque virou rolagem
      if (ev.pointerType === 'touch' && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 10) return;
      if (rect && rect.w >= 8) {
        ed.addText(page, rect);
      } else {
        // Caixa de uma linha, centralizada verticalmente no ponto tocado
        const h = ed.style.size * LINE + 2 * PAD;
        const w = Math.max(40, Math.min(200, px1 - x0 - 2));
        ed.addText(page, { x: x0 - PAD, y: y0 + h / 2, w, h });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  // ================= saídas =================
  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    ed.busy = label;
    try {
      return await fn();
    } catch (err) {
      console.error(err);
      ed.status = { kind: 'err', text: 'Não foi possível gerar o PDF. Tente novamente.' };
    } finally {
      ed.busy = null;
    }
  }
  const download = () => withBusy('Gerando o PDF…', async () => downloadPdf(await ed.buildPdf(), ed.outputName));
  const share = () => withBusy('Preparando para compartilhar…', async () => { await sharePdf(await ed.buildPdf(), ed.outputName); });
  const print = () => withBusy('Preparando a impressão…', async () => {
    const bytes = await ed.buildPdf();
    await printPdf(bytes, (n, total) => (ed.busy = `Preparando a impressão… ${n}/${total}`));
  });

  // ================= atalhos =================
  function onKeydown(e: KeyboardEvent) {
    if (!ed.hasDoc) return;
    const mod = e.ctrlKey || e.metaKey;
    const typing = (e.target as HTMLElement).closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"])');
    const k = e.key.toLowerCase();
    if (mod && k === 'f') { e.preventDefault(); searchOpen = true; return; }
    if (mod && k === 'p') { e.preventDefault(); print(); return; }
    if (mod && k === 's') { e.preventDefault(); download(); return; }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) ed.redo(); else ed.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); ed.redo(); return; }
    if (mod && k === 'c') { ed.copy(); return; }
    if (mod && k === 'v') { e.preventDefault(); ed.paste(); return; }
    if (mod && k === 'd') { e.preventDefault(); ed.duplicate(); return; }
    if (!ed.selected) { if (e.key === 'Escape' && ed.tool === 'text') ed.tool = 'select'; return; }
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ed.remove(); }
    else if (e.key === 'Escape') ed.select(null);
    else if (e.key === 'Enter') { e.preventDefault(); ed.startEditing(ed.selected.id); }
    else if (moves[e.key]) { e.preventDefault(); ed.nudge(...moves[e.key]); }
  }

  function setTool(t: 'select' | 'text') {
    ed.tool = t;
    if (t === 'select') ed.status = null;
    else ed.status = { kind: 'info', text: isWide
      ? 'Clique na página para criar uma caixa de texto, ou arraste para desenhá-la no tamanho certo.'
      : 'Toque na página onde quer escrever. Arraste a caixa para mover e use as alças para mudar o tamanho.' };
  }

  const saveLabel = $derived(
    ed.saving === 'pending' ? 'Salvando…' : ed.saving === 'saved' ? 'Salvo neste aparelho' : ed.saving === 'error' ? 'Rascunho não salvo' : '',
  );
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document onvisibilitychange={onVisibility} />

<div class="editor" class:text-mode={ed.tool === 'text'}
  role="application" aria-label="Editor de PDF"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={(e) => { if (e.target === e.currentTarget) dragging = false; }}
  ondrop={onDrop}>

  <header class="top">
    <a class="icon" href="#/" aria-label="Voltar ao início" title="Início"><ArrowLeft size={22} /></a>
    <div class="title">
      <strong title={ed.fileName}>{ed.hasDoc ? ed.fileName : 'Editor de PDF'}</strong>
      {#if ed.hasDoc}
        <small>
          {ed.pages} página{ed.pages === 1 ? '' : 's'}
          {#if saveLabel}· <span class="save save-{ed.saving}">{#if ed.saving === 'saved'}<Check size={12} />{/if}{saveLabel}</span>{/if}
        </small>
      {/if}
    </div>
    {#if ed.hasDoc}
      <button class="icon" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!ed.canUndo} onclick={() => ed.undo()}><Undo size={20} /></button>
      <button class="icon" aria-label="Refazer" title="Refazer (Ctrl+Y)" disabled={!ed.canRedo} onclick={() => ed.redo()}><Redo size={20} /></button>
      <div class="wide-only group">
        <button class="icon" aria-label="Diminuir zoom" onclick={() => ed.view?.zoomBy(1 / 1.2)}><ZoomOut size={20} /></button>
        <span class="zoom" aria-live="polite">{Math.round(ed.scale * 100)}%</span>
        <button class="icon" aria-label="Aumentar zoom" onclick={() => ed.view?.zoomBy(1.2)}><ZoomIn size={20} /></button>
        <button class="icon" aria-label="Ajustar à largura" title="Ajustar à largura" onclick={() => ed.view?.fitWidth()}><MoveHorizontal size={20} /></button>
        <span class="sep"></span>
        <button class="icon" aria-label="Miniaturas das páginas" aria-pressed={thumbsOpen} onclick={() => (thumbsOpen = !thumbsOpen)}><PanelLeft size={20} /></button>
        <button class="icon" aria-label="Buscar" title="Buscar (Ctrl+F)" aria-pressed={searchOpen} onclick={() => (searchOpen = !searchOpen)}><Search size={20} /></button>
        <button class="icon" aria-label="Imprimir" title="Imprimir (Ctrl+P)" onclick={print}><Printer size={20} /></button>
        {#if canShare}<button class="icon" aria-label="Compartilhar" onclick={share}><Share size={20} /></button>{/if}
      </div>
      <button class="primary" onclick={download} disabled={!!ed.busy} title="Baixar (Ctrl+S)">
        <Download size={18} /><span class="label">Baixar</span>
      </button>
      <div class="narrow-only menu-wrap">
        <button class="icon" aria-label="Mais opções" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}><More size={22} /></button>
        {#if menuOpen}
          <div class="menu" role="menu">
            {#if canShare}<button role="menuitem" onclick={() => { menuOpen = false; share(); }}><Share size={18} /> Compartilhar</button>{/if}
            <button role="menuitem" onclick={() => { menuOpen = false; print(); }}><Printer size={18} /> Imprimir</button>
            <button role="menuitem" onclick={() => { menuOpen = false; ed.view?.fitWidth(); }}><MoveHorizontal size={18} /> Ajustar à largura</button>
            <button role="menuitem" onclick={() => { menuOpen = false; fileInput.click(); }}><FileUp size={18} /> Abrir outro PDF</button>
          </div>
        {/if}
      </div>
    {/if}
  </header>

  {#if ed.hasDoc}
    <nav class="tools" aria-label="Ferramentas">
      <button aria-pressed={ed.tool === 'select'} onclick={() => setTool('select')}><Pointer size={20} /><span>Selecionar</span></button>
      <button aria-pressed={ed.tool === 'text'} onclick={() => setTool('text')}><TypeIcon size={20} /><span>Texto</span></button>
      <button class="narrow-only" aria-pressed={thumbsOpen} onclick={() => (thumbsOpen = !thumbsOpen)}><Files size={20} /><span>Páginas</span></button>
      <button class="narrow-only" aria-pressed={searchOpen} onclick={() => (searchOpen = !searchOpen)}><Search size={20} /><span>Buscar</span></button>
    </nav>
  {/if}

  <div class="msgs">
    {#if searchOpen && ed.hasDoc}<SearchBar {ed} onclose={() => (searchOpen = false)} />{/if}
    {#if ed.restoredAt}
      <div class="msg info" role="status">
        <span>Rascunho de {fmtTime.format(ed.restoredAt)} restaurado.</span>
        <button class="link" onclick={() => ed.discardDraft()}>Começar do zero</button>
        <button class="icon small" aria-label="Fechar aviso" onclick={() => (ed.restoredAt = null)}><X size={16} /></button>
      </div>
    {/if}
    {#if ed.status}
      <div class="msg {ed.status.kind}" role={ed.status.kind === 'err' ? 'alert' : 'status'} id="status">
        <span>{ed.status.text}</span>
        <button class="icon small" aria-label="Fechar aviso" onclick={() => ed.dismissStatus()}><X size={16} /></button>
      </div>
    {/if}
    {#if ed.busy}<div class="msg info" role="status"><Loader size={16} class="spin" /> <span>{ed.busy}</span></div>{/if}
  </div>

  <div class="middle">
    {#if thumbsOpen && ed.hasDoc}
      <aside class="thumbs" aria-label="Miniaturas">
        <div class="thumbs-head narrow-only">
          <strong>Páginas</strong>
          <button class="icon" aria-label="Fechar páginas" onclick={() => (thumbsOpen = false)}><X size={20} /></button>
        </div>
        <Thumbnails {ed} onpick={() => { if (!isWide) thumbsOpen = false; }} />
      </aside>
    {/if}

    <div class="main" class:dragging>
      <!-- O pdf.js exige um container com posição absoluta. O pointerdown aqui cria caixas de texto
           sobre a página (área de desenho); os campos e as caixas têm seus próprios controles acessíveis. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="viewer-container" bind:this={container} onpointerdown={onContainerPointerDown} hidden={!ed.hasDoc}>
        <div class="pdfViewer" bind:this={viewerDiv}></div>
        <div class="object-layer">
          {#each ed.objects as obj (obj.id)}<TextBox {obj} {ed} />{/each}
          {#if drawRect}
            <div class="draw-rect" style:left="{drawRect.left}px" style:top="{drawRect.top}px" style:width="{drawRect.width}px" style:height="{drawRect.height}px"></div>
          {/if}
        </div>
      </div>

      {#if ed.hasDoc}
        <div class="page-badge" aria-live="polite">{ed.currentPage} / {ed.pages}</div>
      {:else}
        <div class="empty">
          {#if ed.loading}
            <p><Loader size={20} class="spin" /> Abrindo…</p>
          {:else}
            <div class="card">
              <h1>Abra um PDF para editar</h1>
              <p>Preencha formulários e escreva em qualquer PDF. O arquivo não sai do seu aparelho.</p>
              <button class="primary big" onclick={() => fileInput.click()}><FileUp size={20} /> Abrir PDF</button>
              <p class="hint">ou arraste o arquivo para cá</p>
            </div>
            <DraftList onopen={(h) => ed.openDraft(h).then(() => (thumbsOpen = isWide && ed.pages > 1))} />
          {/if}
        </div>
      {/if}
    </div>

    {#if showProps}
      <aside class="props" aria-label="Formatação"><PropsPanel {ed} /></aside>
    {/if}
  </div>

  <input bind:this={fileInput} type="file" accept="application/pdf,.pdf" hidden
    onchange={(e) => { openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}>
</div>

<style>
  .editor {
    position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text);
    height: 100dvh; font-size: 15px;
  }
  /* ---------- barra superior ---------- */
  .top {
    display: flex; align-items: center; gap: 4px; padding: 6px 8px; padding-top: calc(6px + env(safe-area-inset-top));
    background: var(--surface); border-bottom: 1px solid var(--border); min-height: 56px;
  }
  .title { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; padding: 0 4px; }
  .title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title small { color: var(--muted); font-size: 12px; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .save { display: inline-flex; align-items: center; gap: 2px; }
  .save-saved { color: var(--ok-text); }
  .save-error { color: var(--err-text); }
  .group { display: flex; align-items: center; gap: 2px; }
  .zoom { min-width: 3.5em; text-align: center; color: var(--muted); font-size: 14px; }
  .sep { width: 1px; height: 24px; background: var(--border); margin: 0 4px; }
  .icon {
    display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex: none;
    border: 0; border-radius: 10px; background: none; color: var(--text); cursor: pointer; text-decoration: none;
  }
  .icon:hover:not(:disabled) { background: var(--surface-2); }
  .icon:disabled { opacity: .35; cursor: default; }
  .icon[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
  .icon.small { width: 32px; height: 32px; }
  .primary {
    display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 16px; flex: none;
    border: 0; border-radius: 10px; background: var(--accent); color: var(--accent-text); font: inherit; font-weight: 700; cursor: pointer;
  }
  .primary:disabled { opacity: .6; }
  .primary.big { height: 52px; font-size: 17px; padding: 0 24px; }
  .menu-wrap { position: relative; }
  .menu {
    position: absolute; right: 0; top: 48px; z-index: 30; min-width: 220px; display: flex; flex-direction: column;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 6px; box-shadow: 0 8px 28px rgba(0,0,0,.2);
  }
  .menu button { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .menu button:hover { background: var(--surface-2); }

  /* ---------- ferramentas ---------- */
  .tools { display: flex; gap: 4px; padding: 6px 8px; background: var(--surface); border-bottom: 1px solid var(--border); }
  .tools button {
    display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; border: 1px solid transparent;
    border-radius: 10px; background: none; color: var(--text); font: inherit; font-weight: 600; cursor: pointer;
  }
  .tools button:hover { background: var(--surface-2); }
  .tools button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .tools button.narrow-only { display: none; }

  /* ---------- mensagens ---------- */
  .msg { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px; font-size: 14px; border-bottom: 1px solid var(--border); }
  .msg span { flex: 1; }
  .msg.ok { background: var(--ok-bg); color: var(--ok-text); }
  .msg.warn { background: var(--warn-bg); color: var(--warn-text); }
  .msg.err { background: var(--err-bg); color: var(--err-text); }
  .msg.info { background: var(--accent-soft); color: var(--text); }
  .link { border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; cursor: pointer; padding: 8px; }
  .msg :global(.spin), .empty :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ---------- área central ---------- */
  .middle { flex: 1; min-height: 0; display: flex; position: relative; }
  .main { position: relative; flex: 1; min-width: 0; }
  .main.dragging { outline: 3px solid var(--accent); outline-offset: -3px; }
  .viewer-container { position: absolute; inset: 0; overflow: auto; touch-action: pan-x pan-y; -webkit-overflow-scrolling: touch; }
  .viewer-container[hidden] { display: none; }
  .viewer-container :global(.pdfViewer) { position: relative; padding-bottom: 72px; }
  .viewer-container :global(.pdfViewer .page) { box-shadow: 0 1px 4px rgba(0,0,0,.18); margin: 12px auto; }
  .text-mode .viewer-container :global(.pdfViewer .page) { cursor: crosshair; }
  .object-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 1000; pointer-events: none; }
  .draw-rect { position: absolute; border: 1.5px dashed #2457d6; background: rgba(36, 87, 214, .08); }
  .page-badge {
    position: absolute; right: 12px; bottom: 12px; z-index: 5; padding: 4px 10px; border-radius: 999px;
    background: rgba(20, 24, 32, .75); color: #fff; font-size: 13px; font-weight: 600; pointer-events: none;
  }
  .thumbs { width: 168px; flex: none; overflow: auto; background: var(--surface); border-right: 1px solid var(--border); }
  .props { width: 280px; flex: none; overflow: auto; padding: 12px; background: var(--surface); border-left: 1px solid var(--border); }
  .props :global(.props) { flex-direction: column; align-items: stretch; }
  .props :global(.props select) { max-width: none; }
  .empty { position: absolute; inset: 0; overflow: auto; padding: 24px 16px; display: flex; flex-direction: column; align-items: center; }
  .empty > * { width: 100%; max-width: 560px; }
  .card { background: var(--surface); border: 2px dashed var(--border); border-radius: 16px; padding: 28px 20px; text-align: center; }
  .card h1 { font-size: 22px; margin: 0 0 8px; }
  .card p { color: var(--muted); margin: 0 0 16px; }
  .card .hint { margin: 12px 0 0; font-size: 14px; }

  .narrow-only { display: none; }
  @media (max-width: 899px) {
    .wide-only { display: none; }
    .narrow-only { display: revert; }
    .primary .label { display: none; }
    .primary { padding: 0 12px; }
    /* ferramentas embaixo, como app */
    .tools {
      order: 10; justify-content: space-around; border-bottom: 0; border-top: 1px solid var(--border);
      padding-bottom: calc(6px + env(safe-area-inset-bottom));
    }
    .tools button { flex-direction: column; gap: 2px; height: 54px; padding: 0 8px; font-size: 12px; flex: 1; justify-content: center; }
    .tools button.narrow-only { display: inline-flex; }
    .middle { flex-direction: column; }
    .thumbs {
      position: fixed; inset: 0; z-index: 40; width: auto; border: 0;
      padding-top: env(safe-area-inset-top);
    }
    .thumbs :global(.thumbs) { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
    .thumbs-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 6px 16px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); }
    .props { order: 5; width: auto; padding: 6px 8px; border-left: 0; border-top: 1px solid var(--border); overflow-x: auto; overflow-y: hidden; }
    .props :global(.props) { flex-direction: row; flex-wrap: nowrap; align-items: center; width: max-content; }
    .props :global(.props select) { max-width: 140px; }
  }
</style>
