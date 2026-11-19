<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  // Comprimir (PLANO.md, item 2.6): leve (fotos menores, texto intacto) ou forte (páginas viram imagens).
  // Nunca entrega um arquivo maior que o original.
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import { baseName } from '../pdf/plan';
  import { formatSize } from './thumbs';
  import Minimize from '@lucide/svelte/icons/minimize-2';

  let level = $state<'light' | 'strong'>('light');

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    let bytes: Uint8Array;
    if (level === 'light') {
      const [{ loadPdf }, { compressDoc, LIGHT }, { canvasRecoder }] = await Promise.all([
        import('../pdf/pages'), import('../pdf/compress'), import('../pdf/raster'),
      ]);
      progress(t('Lendo o arquivo…'));
      const doc = await loadPdf(f.bytes);
      await compressDoc(doc, canvasRecoder, {
        ...LIGHT,
        onProgress: (done, total) => progress(total ? t('Reduzindo as imagens… {i} de {n}', { i: done, n: total }) : t('Comprimindo…')),
      });
      progress(t('Salvando…'));
      bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    } else {
      const { rasterizePdf } = await import('../pdf/raster');
      bytes = await rasterizePdf(f.bytes, {
        dpi: 110, quality: 0.6, onProgress: (done, total) => progress(t('Convertendo a página {i} de {n}…', { i: Math.min(done + 1, total), n: total })),
      });
    }
    const before = f.bytes.length;
    if (bytes.length >= before) {
      return {
        files: [{ name: f.name, bytes: f.bytes, mime: 'application/pdf' }],
        summary: t('Este PDF já está otimizado.'),
        note: level === 'light'
          ? t('Não deu para diminuir sem perder qualidade, então o arquivo original foi mantido. A compressão forte pode reduzir mais.')
          : t('Não deu para diminuir, então o arquivo original foi mantido.'),
      };
    }
    const pct = Math.round((1 - bytes.length / before) * 100);
    return {
      files: [{ name: `${baseName(f.name)}-${t('comprimido')}.pdf`, bytes, mime: 'application/pdf' }],
      summary: t('De {a} para {b} ({p}% menor).', { a: formatSize(before), b: formatSize(bytes.length), p: pct }),
    };
  }
</script>

<OneFileTool id="comprimir" action={t('Comprimir PDF')} icon={Minimize} {run}>
  {#snippet options()}
    <div class="row">
      <span class="label" id="lv-l">{t('Compressão')}</span>
      <fieldset class="seg" aria-labelledby="lv-l">
        <label><input type="radio" bind:group={level} value="light"> {t('Leve (recomendada)')}</label>
        <label><input type="radio" bind:group={level} value="strong"> {t('Forte')}</label>
      </fieldset>
      {#if level === 'light'}
        <p class="hint">{t('Reduz as fotos e imagens para 150 ppp e limpa o arquivo. Textos, campos e links continuam como estão.')}</p>
      {:else}
        <p class="notice warn">{t('Cada página vira uma imagem (110 ppp): o arquivo fica bem menor, mas o texto deixa de ser selecionável e pesquisável, e os campos de formulário viram parte da imagem.')}</p>
      {/if}
    </div>
  {/snippet}
</OneFileTool>
