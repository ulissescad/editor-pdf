<script lang="ts">
  import { fmtDate, t, tk } from '../lib/i18n.svelte';
  // Propriedades do documento (PLANO.md, item 2.13): título, autor, assunto, palavras-chave e aplicativos.
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import type { DocInfo } from '../pdf/meta';
  import Info from '@lucide/svelte/icons/info';

  type Editable = Pick<DocInfo, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>;
  const EMPTY: Editable = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '' };
  const FIELDS: Array<{ key: keyof Editable; label: string; hint?: string }> = [
    { key: 'title', label: tk('Título'), hint: tk('Aparece na aba do navegador e no topo dos leitores de PDF.') },
    { key: 'author', label: tk('Autor') },
    { key: 'subject', label: tk('Assunto') },
    { key: 'keywords', label: tk('Palavras-chave'), hint: tk('Separadas por vírgula.') },
    { key: 'creator', label: tk('Criado com (aplicativo)') },
    { key: 'producer', label: tk('Gerado por (aplicativo)') },
  ];

  const info = $state<Editable>({ ...EMPTY });
  let dates = $state<{ created?: Date; modified?: Date }>({});
  let original = $state('');
  let wipe = $state(false);

  const changed = $derived(wipe || JSON.stringify(info) !== original);
  const fmt = (d?: Date) => d ? fmtDate(d, { dateStyle: 'short', timeStyle: 'short' }) : '—';

  async function pick(f: Picked) {
    const [{ loadPdf }, { readInfo }] = await Promise.all([import('../pdf/pages'), import('../pdf/meta')]);
    const read = readInfo(await loadPdf(f.bytes));
    for (const k of Object.keys(EMPTY) as Array<keyof Editable>) info[k] = read[k];
    dates = { created: read.created, modified: read.modified };
    original = JSON.stringify(info);
    wipe = false;
  }

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    progress(t('Salvando…'));
    const [{ loadPdf }, { writeInfo, clearInfo }] = await Promise.all([import('../pdf/pages'), import('../pdf/meta')]);
    const doc = await loadPdf(f.bytes);
    if (wipe) clearInfo(doc); else writeInfo(doc, $state.snapshot(info));
    const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    return {
      files: [{ name: f.name, bytes, mime: 'application/pdf' }],
      summary: wipe ? t('Todas as propriedades foram removidas.') : t('Propriedades atualizadas.'),
    };
  }
</script>

<OneFileTool id="propriedades" action={wipe ? t('Remover propriedades') : t('Salvar propriedades')} icon={Info} {run} canRun={changed} onpick={pick}
  onclear={() => { Object.assign(info, EMPTY); original = ''; }}>
  {#snippet options()}
    {#each FIELDS as fd (fd.key)}
      <div class="row">
        <label class="label" for="p-{fd.key}">{t(fd.label)}</label>
        <input id="p-{fd.key}" type="text" bind:value={info[fd.key]} disabled={wipe} autocomplete="off">
        {#if fd.hint}<p class="hint">{t(fd.hint)}</p>{/if}
      </div>
    {/each}
    <dl class="dates">
      <div><dt>{t('Criado em')}</dt><dd>{fmt(dates.created)}</dd></div>
      <div><dt>{t('Modificado em')}</dt><dd>{fmt(dates.modified)}</dd></div>
    </dl>
    <label class="check"><input type="checkbox" bind:checked={wipe}> {t('Remover todas as propriedades (inclusive datas e aplicativos)')}</label>
  {/snippet}
</OneFileTool>

<style>
  .dates { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 0; font-size: 14px; }
  .dates div { display: flex; gap: 6px; }
  dt { color: var(--muted); }
  dd { margin: 0; font-weight: 600; }
  .check { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-weight: 600; font-size: 15px; cursor: pointer; }
  .check input { width: 20px; height: 20px; flex: none; }
</style>
