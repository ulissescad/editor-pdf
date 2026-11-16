<script lang="ts">
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
      progress('Lendo o arquivo…');
      const doc = await loadPdf(f.bytes);
      await compressDoc(doc, canvasRecoder, {
        ...LIGHT,
        onProgress: (done, total) => progress(total ? `Reduzindo as imagens… ${done} de ${total}` : 'Comprimindo…'),
      });
      progress('Salvando…');
      bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    } else {
      const { rasterizePdf } = await import('../pdf/raster');
      bytes = await rasterizePdf(f.bytes, {
        dpi: 110, quality: 0.6, onProgress: (done, total) => progress(`Convertendo a página ${Math.min(done + 1, total)} de ${total}…`),
      });
    }
    const before = f.bytes.length;
    if (bytes.length >= before) {
      return {
        files: [{ name: f.name, bytes: f.bytes, mime: 'application/pdf' }],
        summary: 'Este PDF já está otimizado.',
        note: level === 'light'
          ? 'Não deu para diminuir sem perder qualidade, então o arquivo original foi mantido. A compressão forte pode reduzir mais.'
          : 'Não deu para diminuir, então o arquivo original foi mantido.',
      };
    }
    const pct = Math.round((1 - bytes.length / before) * 100);
    return {
      files: [{ name: `${baseName(f.name)}-comprimido.pdf`, bytes, mime: 'application/pdf' }],
      summary: `De ${formatSize(before)} para ${formatSize(bytes.length)} (${pct}% menor).`,
    };
  }
</script>

<OneFileTool id="comprimir" action="Comprimir PDF" icon={Minimize} {run}>
  {#snippet options()}
    <div class="row">
      <span class="label" id="lv-l">Compressão</span>
      <fieldset class="seg" aria-labelledby="lv-l">
        <label><input type="radio" bind:group={level} value="light"> Leve (recomendada)</label>
        <label><input type="radio" bind:group={level} value="strong"> Forte</label>
      </fieldset>
      {#if level === 'light'}
        <p class="hint">Reduz as fotos e imagens para 150 ppp e limpa o arquivo. Textos, campos e links continuam como estão.</p>
      {:else}
        <p class="notice warn">Cada página vira uma imagem (110 ppp): o arquivo fica bem menor, mas o texto deixa de ser selecionável e pesquisável, e os campos de formulário viram parte da imagem.</p>
      {/if}
    </div>
  {/snippet}
</OneFileTool>
