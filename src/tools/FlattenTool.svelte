<script lang="ts">
  // Achatar (PLANO.md, item 2.12): campos preenchidos e anotações viram parte fixa da página.
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import { baseName } from '../pdf/plan';
  import Layers from '@lucide/svelte/icons/layers';

  let found = $state<{ fields: number; annots: number } | null>(null);

  /** Conta campos e anotações (pdf.js), para dizer o que vai acontecer. */
  async function pick(f: Picked) {
    const doc = f.doc!;
    const fields = await doc.getFieldObjects() as Map<string, unknown> | Record<string, unknown> | null;
    let annots = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const list = await (await doc.getPage(n)).getAnnotations();
      annots += list.filter((a) => !['Widget', 'Link', 'Popup'].includes(a.subtype)).length;
    }
    found = { fields: fields ? (fields instanceof Map ? fields.size : Object.keys(fields).length) : 0, annots };
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    progress('Achatando…');
    const [{ loadPdf }, { flattenDoc }] = await Promise.all([import('../pdf/pages'), import('../pdf/flatten')]);
    const doc = await loadPdf(f.bytes);
    const r = flattenDoc(doc);
    const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    return {
      files: [{ name: `${baseName(f.name)}-achatado.pdf`, bytes, mime: 'application/pdf' }],
      summary: `${plural(r.fields, 'campo', 'campos')} e ${plural(r.annotations, 'anotação', 'anotações')} viraram parte fixa da página.`,
    };
  }
</script>

<OneFileTool id="achatar" action="Achatar PDF" icon={Layers} {run} onpick={pick} onclear={() => (found = null)}
  canRun={!!found && found.fields + found.annots > 0}>
  {#snippet options()}
    {#if found && found.fields + found.annots === 0}
      <p class="notice ok">Este PDF não tem campos de formulário nem anotações: ele já está “achatado”.</p>
    {:else if found}
      <p>Encontrados: <strong>{plural(found.fields, 'campo de formulário', 'campos de formulário')}</strong> e
        <strong>{plural(found.annots, 'anotação', 'anotações')}</strong> (destaques, desenhos, notas…).</p>
      <p class="hint">Depois de achatar, ninguém consegue mais mudar os campos nem apagar as anotações: tudo fica como está agora, em qualquer leitor. Links continuam funcionando.</p>
    {/if}
  {/snippet}
</OneFileTool>
