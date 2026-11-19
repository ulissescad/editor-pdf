<script lang="ts">
  import { t, tn } from '../lib/i18n.svelte';
  // PDF para imagens (PLANO.md, item 2.5): cada página vira um JPG ou PNG, na resolução escolhida.
  import { onDestroy } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import Result from './Result.svelte';
  import { Thumbs, formatSize } from './thumbs';
  import { openError, readPdfFiles, type OutFile, type ToolFile } from './handoff';
  import { baseName, parseRanges } from '../pdf/plan';
  import { closePdf, openPdf } from '../pdf/pdfjs';
  import FileImage from '@lucide/svelte/icons/file-image';
  import Loader from '@lucide/svelte/icons/loader-circle';

  type Format = 'jpeg' | 'png';
  const MAX_PIXELS = 16_000_000; // limite de canvas do Safari (iPhone)

  const thumbs = new Thumbs();
  let file = $state<ToolFile | null>(null);
  let pages = $state(0);
  let format = $state<Format>('jpeg');
  let dpi = $state(150);
  let which = $state<'all' | 'some'>('all');
  let ranges = $state('');
  let busy = $state('');
  let error = $state('');
  let result = $state<OutFile[] | null>(null);
  let cancel = false;

  onDestroy(() => { cancel = true; thumbs.destroy(); });

  const parsed = $derived(which === 'some' && ranges.trim() ? parseRanges(ranges, pages) : null);
  const selection = $derived.by((): number[] => {
    if (which === 'all') return Array.from({ length: pages }, (_, i) => i);
    return parsed && 'groups' in parsed ? [...new Set(parsed.groups.flat())] : [];
  });

  async function choose(list: File[]) {
    error = '';
    const { ok } = await readPdfFiles(list);
    if (!ok.length) { error = t('Escolha um arquivo .pdf.'); return; }
    busy = t('Abrindo…');
    try {
      await thumbs.destroy();
      const src = await thumbs.add(ok[0].bytes);
      file = ok[0];
      pages = thumbs.pages(src);
      which = 'all'; // as páginas escolhidas eram do arquivo anterior
      ranges = '';
    } catch (err) {
      console.error(err);
      error = openError(err, ok[0].name);
    } finally {
      busy = '';
    }
  }

  async function convert() {
    if (!file || !selection.length) return;
    error = '';
    cancel = false;
    const doc = await openPdf(file.bytes);
    const out: OutFile[] = [];
    const base = baseName(file.name);
    const digits = String(pages).length;
    try {
      for (const [n, i] of selection.entries()) {
        if (cancel) return;
        busy = t('Convertendo a página {i} de {n}…', { i: n + 1, n: selection.length });
        const page = await doc.getPage(i + 1);
        let scale = dpi / 72;
        const vp1 = page.getViewport({ scale: 1 });
        if (vp1.width * vp1.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (vp1.width * vp1.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d')!;
        // JPG não tem transparência: fundo branco, como o papel
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport, intent: 'print' }).promise;
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), mime, 0.9));
        canvas.width = canvas.height = 0; // libera a memória (importante no iPhone)
        page.cleanup();
        const ext = format === 'png' ? 'png' : 'jpg';
        out.push({ name: `${base}-${t('pagina')}-${String(i + 1).padStart(digits, '0')}.${ext}`, bytes: new Uint8Array(await blob.arrayBuffer()), mime });
      }
      result = out;
    } catch (err) {
      console.error(err);
      error = t('Não foi possível converter as páginas. Tente uma resolução menor.');
    } finally {
      busy = '';
      await closePdf(doc);
    }
  }

  async function reset() {
    result = null;
    file = null;
    pages = 0;
    await thumbs.destroy();
  }
</script>

<ToolPage id="pdf-para-imagens">
  {#if result}
    <Result files={result} zipName="{baseName(file?.name ?? t('documento'))}-{t('imagens')}.zip"
      summary={tn(result.length, '{n} imagem.', '{n} imagens.')} onreset={reset} />
  {:else if !file}
    <FileDrop label={t('Escolher PDF')} onfiles={choose} />
  {:else}
    <div class="panel">
      <p class="file"><strong>{file.name}</strong> · {tn(pages, '{n} página', '{n} páginas')} · {formatSize(file.bytes.length)}
        <button class="link" onclick={reset}>{t('Trocar arquivo')}</button></p>
      <div class="options">
        <div class="row">
          <span class="label" id="fmt-l">{t('Formato')}</span>
          <fieldset class="seg" aria-labelledby="fmt-l">
            <label><input type="radio" bind:group={format} value="jpeg"> {t('JPG (menor)')}</label>
            <label><input type="radio" bind:group={format} value="png"> {t('PNG (sem perdas)')}</label>
          </fieldset>
        </div>
        <div class="row">
          <span class="label" id="dpi-l">{t('Qualidade')}</span>
          <fieldset class="seg" aria-labelledby="dpi-l">
            <label><input type="radio" bind:group={dpi} value={96}> {t('Leve ({d} ppp)', { d: 96 })}</label>
            <label><input type="radio" bind:group={dpi} value={150}> {t('Normal ({d} ppp)', { d: 150 })}</label>
            <label><input type="radio" bind:group={dpi} value={300}> {t('Alta ({d} ppp)', { d: 300 })}</label>
          </fieldset>
        </div>
        <div class="row">
          <span class="label" id="pg-l">{t('Páginas')}</span>
          <fieldset class="seg" aria-labelledby="pg-l">
            <label><input type="radio" bind:group={which} value="all"> {t('Todas')}</label>
            <label><input type="radio" bind:group={which} value="some"> {t('Escolher')}</label>
          </fieldset>
          {#if which === 'some'}
            <input type="text" inputmode="numeric" autocomplete="off" aria-label={t('Páginas a converter')} bind:value={ranges} placeholder="1-3, 5">
            {#if parsed && 'error' in parsed}<p class="notice warn">{parsed.error}</p>{/if}
          {/if}
        </div>
      </div>
      <div class="go">
        <button class="button primary" onclick={convert} disabled={!!busy || !selection.length}>
          <FileImage size={20} aria-hidden="true" /> {tn(selection.length, 'Converter {n} página', 'Converter {n} páginas')}
        </button>
      </div>
    </div>
  {/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</ToolPage>

<style>
  .file { margin: 0 0 14px; overflow-wrap: anywhere; }
  .link { border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; cursor: pointer; padding: 8px; }
</style>
