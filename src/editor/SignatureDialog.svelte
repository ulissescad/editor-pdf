<script lang="ts">
  import { i18n, t, tk } from '../lib/i18n.svelte';
  // Assinatura (PLANO.md, item 1.7): desenhar com o dedo, digitar com fonte cursiva ou usar a foto
  // de uma assinatura no papel (o fundo é removido por limiar de cor). Tudo vira PNG transparente.
  import { onMount, tick } from 'svelte';
  import '@fontsource/great-vibes/latin-400.css'; // Dancing Script e Caveat vêm de styles/fonts.css
  import { newId, type ImageAsset } from './model';
  import { assetFromCanvas, decodeImage, drawScaled, removeBackground, trimTransparent, type InkColor } from './images';
  import { deleteSignature, listSignatures, saveSignature, type SavedSignature } from '../storage/signatures';
  import X from '@lucide/svelte/icons/x';
  import Trash from '@lucide/svelte/icons/trash';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import Camera from '@lucide/svelte/icons/camera';
  import Eraser from '@lucide/svelte/icons/eraser';

  let { onuse, onclose }: { onuse: (asset: ImageAsset) => void; onclose: () => void } = $props();

  type Tab = 'draw' | 'type' | 'photo';
  const TABS: { id: Tab; label: string; icon: typeof PenLine }[] = [
    { id: 'draw', label: tk('Desenhar'), icon: PenLine },
    { id: 'type', label: tk('Digitar'), icon: Keyboard },
    { id: 'photo', label: tk('Foto'), icon: Camera },
  ];
  const INKS: { color: string; label: string }[] = [{ color: '#000000', label: tk('Preta') }, { color: '#1a3cc8', label: tk('Azul') }];
  const CURSIVE = ['Dancing Script', 'Great Vibes', 'Caveat'];
  const OUT = 3; // assinaturas são geradas em 3× o tamanho da tela (nítidas no PDF)

  let tab = $state<Tab>('draw');
  let ink = $state('#000000');
  let remember = $state(true);
  let saved = $state<(SavedSignature & { url: string })[]>([]);
  let error = $state('');
  let dialog: HTMLDivElement;

  onMount(() => {
    listSignatures().then((list) => {
      saved = list.map((s) => ({ ...s, url: URL.createObjectURL(new Blob([s.png as BlobPart], { type: 'image/png' })) }));
    }).catch(() => {});
    dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => saved.forEach((s) => URL.revokeObjectURL(s.url));
  });

  async function finish(canvas: HTMLCanvasElement | null) {
    error = '';
    const trimmed = canvas && trimTransparent(canvas, 6);
    if (!trimmed) { error = t('A assinatura está vazia.'); return; }
    const asset = await assetFromCanvas(trimmed, 'image/png');
    if (remember) await saveSignature({ id: newId(), png: asset.bytes, w: asset.w, h: asset.h, createdAt: Date.now() }).catch(() => {});
    onuse(asset);
  }

  function useSaved(s: SavedSignature) {
    onuse({ id: newId(), mime: 'image/png', bytes: s.png, w: s.w, h: s.h });
  }

  async function removeSaved(id: string) {
    await deleteSignature(id).catch(() => {});
    const s = saved.find((x) => x.id === id);
    if (s) URL.revokeObjectURL(s.url);
    saved = saved.filter((x) => x.id !== id);
  }

  // ================= desenhar =================
  interface Pt { x: number; y: number; w: number; t: number }
  let pad = $state<HTMLCanvasElement>();
  let strokes: Pt[][] = [];
  let hasInk = $state(false);
  const BASE = 2.4; // espessura média, em px da tela

  function sizePad() {
    if (!pad) return;
    const r = pad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    pad.width = Math.round(r.width * dpr);
    pad.height = Math.round(r.height * dpr);
    redraw();
  }

  $effect(() => {
    if (!pad) return;
    const ro = new ResizeObserver(() => sizePad());
    ro.observe(pad);
    return () => ro.disconnect();
  });

  function segment(ctx: CanvasRenderingContext2D, pts: Pt[], i: number, k: number, color: string) {
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineCap = ctx.lineJoin = 'round';
    if (i === 0) {
      ctx.beginPath();
      ctx.arc(pts[0].x * k, pts[0].y * k, (pts[0].w * k) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const a = i > 1 ? mid(pts[i - 2], pts[i - 1]) : pts[0];
    const b = mid(pts[i - 1], pts[i]);
    ctx.beginPath();
    ctx.moveTo(a.x * k, a.y * k);
    ctx.quadraticCurveTo(pts[i - 1].x * k, pts[i - 1].y * k, b.x * k, b.y * k);
    ctx.lineWidth = ((pts[i - 1].w + pts[i].w) / 2) * k;
    ctx.stroke();
  }
  const mid = (p: Pt, q: Pt) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

  /** A suavização termina no meio do último trecho: completa até o ponto final. */
  function tail(ctx: CanvasRenderingContext2D, pts: Pt[], k: number, color: string) {
    const n = pts.length;
    if (n < 2) return;
    const a = mid(pts[n - 2], pts[n - 1]);
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = pts[n - 1].w * k;
    ctx.beginPath();
    ctx.moveTo(a.x * k, a.y * k);
    ctx.lineTo(pts[n - 1].x * k, pts[n - 1].y * k);
    ctx.stroke();
  }

  function drawStroke(ctx: CanvasRenderingContext2D, pts: Pt[], k: number, color: string) {
    for (let i = 0; i < pts.length; i++) segment(ctx, pts, i, k, color);
    tail(ctx, pts, k, color);
  }

  function redraw() {
    if (!pad) return;
    const ctx = pad.getContext('2d')!;
    ctx.clearRect(0, 0, pad.width, pad.height);
    const k = window.devicePixelRatio || 1;
    for (const s of strokes) drawStroke(ctx, s, k, ink);
  }

  function point(e: PointerEvent, prev?: Pt): Pt {
    const r = pad!.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, w: BASE };
    if (e.pointerType === 'pen' && e.pressure > 0) p.w = BASE * (0.45 + e.pressure * 1.1);
    else if (prev) {
      // Traço mais fino quando rápido, mais grosso quando lento (parece caneta)
      const v = Math.hypot(p.x - prev.x, p.y - prev.y) / Math.max(1, p.t - prev.t);
      const target = Math.min(BASE * 1.5, Math.max(BASE * 0.6, BASE * 1.5 - v * 0.9));
      p.w = prev.w * 0.7 + target * 0.3;
    }
    return p;
  }

  function onPadDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    pad!.setPointerCapture(e.pointerId);
    const s = [point(e)];
    strokes.push(s);
    hasInk = true;
    segment(pad!.getContext('2d')!, s, 0, window.devicePixelRatio || 1, ink);
  }
  function onPadMove(e: PointerEvent) {
    if (!pad?.hasPointerCapture(e.pointerId)) return;
    const s = strokes[strokes.length - 1];
    const ctx = pad.getContext('2d')!;
    const k = window.devicePixelRatio || 1;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = point(ev, s[s.length - 1]);
      if (Math.hypot(p.x - s[s.length - 1].x, p.y - s[s.length - 1].y) < 0.8) continue;
      s.push(p);
      segment(ctx, s, s.length - 1, k, ink);
    }
  }
  function onPadUp(e: PointerEvent) {
    if (!pad?.hasPointerCapture(e.pointerId)) return;
    pad.releasePointerCapture(e.pointerId);
    const s = strokes[strokes.length - 1];
    const ctx = pad.getContext('2d')!;
    const k = window.devicePixelRatio || 1;
    const p = point(e, s[s.length - 1]);
    if (e.type === 'pointerup' && Math.hypot(p.x - s[s.length - 1].x, p.y - s[s.length - 1].y) >= 0.8) {
      s.push(p);
      segment(ctx, s, s.length - 1, k, ink);
    }
    tail(ctx, s, k, ink);
  }
  function clearPad() { strokes = []; hasInk = false; redraw(); }

  function drawnCanvas(): HTMLCanvasElement | null {
    const pts = strokes.flat();
    if (!pts.length) return null;
    const m = 8; // margem em px, cobre a espessura do traço
    const x0 = Math.min(...pts.map((p) => p.x)) - m, y0 = Math.min(...pts.map((p) => p.y)) - m;
    const x1 = Math.max(...pts.map((p) => p.x)) + m, y1 = Math.max(...pts.map((p) => p.y)) + m;
    const c = document.createElement('canvas');
    c.width = Math.ceil((x1 - x0) * OUT);
    c.height = Math.ceil((y1 - y0) * OUT);
    const ctx = c.getContext('2d')!;
    for (const s of strokes) {
      drawStroke(ctx, s.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 })), OUT, ink);
    }
    return c;
  }

  // ================= digitar =================
  let typed = $state('');
  let cursive = $state(CURSIVE[0]);

  async function typedCanvas(): Promise<HTMLCanvasElement | null> {
    const text = typed.trim();
    if (!text) return null;
    const px = 32 * OUT;
    const font = `${px}px "${cursive}"`;
    await document.fonts.load(font, text);
    const m = document.createElement('canvas').getContext('2d')!;
    m.font = font;
    const w = Math.ceil(m.measureText(text).width + px);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.ceil(px * 1.8);
    const ctx = c.getContext('2d')!;
    ctx.font = font;
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px / 2, c.height / 2);
    return c;
  }

  // ================= foto =================
  let photoInput = $state<HTMLInputElement>();
  let source: HTMLCanvasElement | null = null;
  let preview = $state<HTMLCanvasElement>();
  let hasPhoto = $state(false);
  let sensitivity = $state(0);
  let photoInk = $state<InkColor>('#000000');
  let processed: HTMLCanvasElement | null = null;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    error = '';
    try {
      const bmp = await decodeImage(file);
      source = drawScaled(bmp, 1600);
      bmp.close();
      hasPhoto = true;
      await tick();
      process();
    } catch {
      error = t('Não foi possível ler esta imagem.');
    }
  }

  function process() {
    if (!source || !preview) return;
    processed = trimTransparent(removeBackground(source, sensitivity, photoInk), 6, 2);
    const c = processed ?? source;
    preview.width = c.width;
    preview.height = c.height;
    const ctx = preview.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (processed) ctx.drawImage(processed, 0, 0);
  }

  async function use() {
    if (tab === 'draw') await finish(drawnCanvas());
    else if (tab === 'type') await finish(await typedCanvas());
    else await finish(processed);
  }

  const canUse = $derived(tab === 'draw' ? hasInk : tab === 'type' ? !!typed.trim() : hasPhoto);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onclose(); }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="backdrop" role="presentation" onkeydown={onKeydown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="sig-title" bind:this={dialog}>
    <header>
      <h2 id="sig-title">{t('Assinatura')}</h2>
      <button class="icon" aria-label={t('Fechar')} onclick={onclose}><X size={22} /></button>
    </header>

    {#if saved.length}
      <section class="saved" aria-label={t('Assinaturas guardadas')}>
        <h3>{t('Guardadas neste aparelho')}</h3>
        <ul>
          {#each saved as s (s.id)}
            <li>
              <button class="use-saved" onclick={() => useSaved(s)} aria-label={t('Usar assinatura guardada')}><img src={s.url} alt=""></button>
              <button class="icon small" aria-label={t('Apagar assinatura guardada')} onclick={() => removeSaved(s.id)}><Trash size={16} /></button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="tabs" role="tablist" aria-label={t('Como criar a assinatura')}>
      {#each TABS as tb (tb.id)}
        {@const Icon = tb.icon}
        <button role="tab" aria-selected={tab === tb.id} aria-controls="sig-panel" onclick={() => { tab = tb.id; error = ''; }}>
          <Icon size={18} /> {t(tb.label)}
        </button>
      {/each}
    </div>

    <div class="panel" id="sig-panel" role="tabpanel">
      {#if tab === 'draw'}
        <div class="pad-wrap">
          <canvas bind:this={pad} class="pad" aria-label={t('Área para desenhar a assinatura')}
            onpointerdown={onPadDown} onpointermove={onPadMove} onpointerup={onPadUp} onpointercancel={onPadUp}></canvas>
          <span class="baseline" aria-hidden="true"></span>
          {#if !hasInk}<span class="placeholder" aria-hidden="true">{t('Assine aqui com o dedo, a caneta ou o mouse')}</span>{/if}
        </div>
        <p class="tip portrait-only">{t('Dica: gire o celular para ter mais espaço.')}</p>
      {:else if tab === 'type'}
        <label class="field">{t('Seu nome')}
          <input type="text" bind:value={typed} autocomplete="name" placeholder={t('Digite seu nome')} maxlength="60">
        </label>
        <div class="fonts" role="radiogroup" aria-label={t('Estilo da letra')}>
          {#each CURSIVE as f (f)}
            <button role="radio" aria-checked={cursive === f} onclick={() => (cursive = f)}
              style:font-family="'{f}', cursive" style:color={ink}>{typed.trim() || t('Sua assinatura')}</button>
          {/each}
        </div>
      {:else}
        <p class="help">{t('Assine num papel branco, fotografe de perto e com boa luz.')}</p>
        <button class="secondary" onclick={() => photoInput?.click()}><Camera size={18} /> {hasPhoto ? t('Escolher outra foto') : t('Tirar foto ou escolher imagem')}</button>
        <input bind:this={photoInput} type="file" accept="image/*" hidden
          onchange={(e) => { onPhoto(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}>
        {#if hasPhoto}
          <div class="preview"><canvas bind:this={preview} aria-label={t('Assinatura sem o fundo')}></canvas></div>
          <label class="field">{t('Sensibilidade')}
            <input type="range" min="-60" max="60" step="2" bind:value={sensitivity} oninput={process} aria-label={t('Sensibilidade (pega traços mais claros)')}>
          </label>
          <div class="inks" role="radiogroup" aria-label={t('Cor do traço da foto')}>
            {#each [{ c: '#000000', l: tk('Preta') }, { c: '#1a3cc8', l: tk('Azul') }, { c: 'original', l: tk('Original') }] as o (o.c)}
              <button role="radio" aria-checked={photoInk === o.c} onclick={() => { photoInk = o.c as InkColor; process(); }}>{t(o.l)}</button>
            {/each}
          </div>
        {/if}
      {/if}

      {#if tab !== 'photo'}
        <div class="inks" role="radiogroup" aria-label={t('Cor da tinta')}>
          {#each INKS as i (i.color)}
            <button role="radio" aria-checked={ink === i.color} onclick={() => { ink = i.color; redraw(); }}>
              <span class="dot" style:background={i.color}></span>{t(i.label)}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <footer>
      <label class="remember"><input type="checkbox" bind:checked={remember}> {t('Guardar neste aparelho')}</label>
      <div class="buttons">
        {#if tab === 'draw'}<button class="secondary" onclick={clearPad} disabled={!hasInk}><Eraser size={18} /> {t('Limpar')}</button>{/if}
        <button class="primary" onclick={use} disabled={!canUse}>{t('Usar')}</button>
      </div>
    </footer>
    <p class="legal">
      <!-- O assinador do gov.br só vale no Brasil: nos outros idiomas, a orientação é genérica -->
      {#if i18n.locale === 'pt-BR'}
        Assinatura eletrônica simples. Para validade jurídica plena, use o
        <a href="https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica" target="_blank" rel="noopener noreferrer">assinador do gov.br</a>.
      {:else}
        {t('Assinatura eletrônica simples. Para validade jurídica plena, use uma assinatura digital qualificada do seu país.')}
      {/if}
    </p>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(10, 14, 22, .45); display: flex; align-items: center; justify-content: center; }
  .dialog {
    width: min(640px, 100%); max-height: 100dvh; overflow: auto; background: var(--surface); color: var(--text);
    border-radius: 16px; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.3);
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { font-size: 19px; margin: 0; }
  h3 { font-size: 13px; margin: 0 0 6px; color: var(--muted); font-weight: 600; }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 10px; background: none; color: var(--text); cursor: pointer; }
  .icon.small { width: 36px; height: 36px; }
  .icon:hover { background: var(--surface-2); }
  .saved ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; overflow-x: auto; }
  .saved li { display: flex; align-items: center; gap: 2px; flex: none; }
  .use-saved { height: 56px; min-width: 100px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 10px; background: #fff; cursor: pointer; }
  .use-saved img { height: 100%; max-width: 160px; object-fit: contain; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
  .tabs button {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 44px; border: 0; border-bottom: 3px solid transparent;
    background: none; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer;
  }
  .tabs button[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
  .panel { display: flex; flex-direction: column; gap: 10px; }
  .pad-wrap { position: relative; }
  .pad { display: block; width: 100%; height: clamp(160px, 38dvh, 280px); background: #fff; border: 1px solid var(--border); border-radius: 12px; touch-action: none; cursor: crosshair; }
  .baseline { position: absolute; left: 24px; right: 24px; bottom: 30%; border-bottom: 1.5px dashed #b9c0cc; pointer-events: none; }
  .placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #8a93a3; pointer-events: none; text-align: center; padding: 0 16px; }
  .tip { margin: 0; color: var(--muted); font-size: 13px; }
  .portrait-only { display: none; }
  @media (orientation: portrait) and (max-width: 600px) { .portrait-only { display: block; } }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--muted); }
  .field input[type="text"] { height: 44px; border: 1px solid var(--border); border-radius: 10px; padding: 0 12px; font: inherit; font-size: 16px; color: var(--text); background: var(--surface); }
  .fonts { display: flex; flex-direction: column; gap: 6px; }
  .fonts button { height: 64px; border: 1px solid var(--border); border-radius: 10px; background: #fff; font-size: 34px; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 12px; }
  .fonts button[aria-checked="true"] { border: 2px solid var(--accent); }
  .inks { display: flex; gap: 6px; flex-wrap: wrap; }
  .inks button { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; cursor: pointer; }
  .inks button[aria-checked="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .dot { width: 14px; height: 14px; border-radius: 50%; }
  .help { margin: 0; color: var(--muted); font-size: 14px; }
  .preview {
    display: flex; align-items: center; justify-content: center; min-height: 120px; max-height: 240px; padding: 8px; border-radius: 12px; border: 1px solid var(--border);
    background: repeating-conic-gradient(#e9ecf1 0 25%, #fff 0 50%) 0 0 / 16px 16px;
  }
  .preview canvas { max-width: 100%; max-height: 220px; }
  input[type="range"] { width: 100%; height: 32px; }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .remember { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; }
  .remember input { width: 20px; height: 20px; }
  .buttons { display: flex; gap: 8px; margin-left: auto; }
  .primary, .secondary {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 44px; padding: 0 18px; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer;
  }
  .primary { border: 0; background: var(--accent); color: var(--accent-text); min-width: 96px; }
  .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
  .primary:disabled, .secondary:disabled { opacity: .5; cursor: default; }
  .error { margin: 0; color: var(--err-text); background: var(--err-bg); padding: 8px 12px; border-radius: 8px; font-size: 14px; }
  .legal { margin: 0; font-size: 12px; color: var(--muted); }
  @media (max-width: 640px) {
    .backdrop { align-items: stretch; }
    .dialog { border-radius: 0; padding-top: calc(8px + env(safe-area-inset-top)); padding-bottom: calc(12px + env(safe-area-inset-bottom)); min-height: 100dvh; }
  }
  /* Celular deitado: a área de desenho ocupa a maior parte da tela */
  @media (orientation: landscape) and (max-height: 500px) {
    .pad { height: 52dvh; }
    .saved, .legal { display: none; }
  }
</style>
