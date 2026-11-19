<script lang="ts">
  import { t, tn } from '../lib/i18n.svelte';
  // Dividir / extrair páginas (PLANO.md, item 2.2): por intervalos, uma página por arquivo
  // ou escolhendo as páginas que vão para um arquivo novo.
  import { onDestroy } from 'svelte';
  import ToolPage from './ToolPage.svelte';
  import FileDrop from './FileDrop.svelte';
  import Result from './Result.svelte';
  import { Thumbs, formatSize, thumb } from './thumbs';
  import { openError, readPdfFiles, type OutFile, type ToolFile } from './handoff';
  import { requestOpen } from '../editor/session';
  import { baseName, groupLabel, parseRanges } from '../pdf/plan';
  import Split from '@lucide/svelte/icons/split';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import CheckSquare from '@lucide/svelte/icons/square-check-big';

  type Mode = 'ranges' | 'each' | 'pick';

  const thumbs = new Thumbs();
  let file = $state<ToolFile | null>(null);
  let pages = $state(0);
  let mode = $state<Mode>('ranges');
  let ranges = $state('');
  let picked = $state<number[]>([]);
  let busy = $state('');
  let error = $state('');
  let result = $state<OutFile[] | null>(null);

  onDestroy(() => { thumbs.destroy(); });

  const parsed = $derived(mode === 'ranges' && ranges.trim() ? parseRanges(ranges, pages) : null);
  const groups = $derived.by((): number[][] => {
    if (mode === 'each') return Array.from({ length: pages }, (_, i) => [i]);
    if (mode === 'pick') return picked.length ? [[...picked].sort((a, b) => a - b)] : [];
    return parsed && 'groups' in parsed ? parsed.groups : [];
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
      ranges = pages > 1 ? `1-${Math.ceil(pages / 2)}, ${Math.ceil(pages / 2) + 1}-${pages}`.replace(/\b(\d+)-\1\b/g, '$1') : '1';
      picked = [];
    } catch (err) {
      console.error(err);
      error = openError(err, ok[0].name);
    } finally {
      busy = '';
    }
  }

  function toggle(i: number) { picked = picked.includes(i) ? picked.filter((p) => p !== i) : [...picked, i]; }

  async function split() {
    if (!file || !groups.length) return;
    error = '';
    busy = t('Separando…');
    try {
      const { Assembler } = await import('../pdf/pages');
      const asm = await Assembler.load([file.bytes]);
      const base = baseName(file.name);
      const out: OutFile[] = [];
      for (const [n, g] of groups.entries()) {
        busy = t('Separando… {i} de {n}', { i: n + 1, n: groups.length });
        const bytes = await asm.build(g.map((index) => ({ src: 0, index })));
        const label = mode === 'pick' ? t('extraidas') : `p${groupLabel(g)}`;
        out.push({ name: `${base}-${label}.pdf`, bytes, mime: 'application/pdf' });
      }
      result = out;
    } catch (err) {
      console.error(err);
      error = (err as Error).name === 'EncryptedError' ? openError(err) : t('Não foi possível dividir o PDF. Tente novamente.');
    } finally {
      busy = '';
    }
  }

  async function reset() {
    result = null;
    file = null;
    pages = 0;
    await thumbs.destroy();
  }
</script>

<ToolPage id="dividir" wide={mode === 'pick'}>
  {#if result}
    <Result files={result} zipName="{baseName(file?.name ?? t('documento'))}-{t('dividido')}.zip"
      summary={tn(result.length, '{n} arquivo criado.', '{n} arquivos criados.')}
      onedit={(f) => requestOpen({ kind: 'file', bytes: f.bytes, name: f.name })} onreset={reset} />
  {:else if !file}
    <FileDrop label={t('Escolher PDF')} onfiles={choose} />
  {:else}
    <div class="panel">
      <p class="file"><strong>{file.name}</strong> · {tn(pages, '{n} página', '{n} páginas')} · {formatSize(file.bytes.length)}
        <button class="link" onclick={reset}>{t('Trocar arquivo')}</button></p>
      <div class="options">
        <fieldset class="seg" aria-label={t('Como dividir')}>
          <label><input type="radio" bind:group={mode} value="ranges"> {t('Por intervalos')}</label>
          <label><input type="radio" bind:group={mode} value="each"> {t('Uma página por arquivo')}</label>
          <label><input type="radio" bind:group={mode} value="pick"> {t('Escolher páginas')}</label>
        </fieldset>
        {#if mode === 'ranges'}
          <div class="row">
            <label class="label" for="ranges">{t('Intervalos')}</label>
            <input id="ranges" type="text" inputmode="numeric" autocomplete="off" bind:value={ranges} placeholder="1-3, 5, 8-">
            <p class="hint">{t('Cada intervalo vira um arquivo. Ex.: “1-3, 5, 8-” gera 3 arquivos (8- vai até o fim).')}</p>
            {#if parsed && 'error' in parsed}<p class="notice warn">{parsed.error}</p>{/if}
          </div>
        {:else if mode === 'each'}
          <p class="hint">{t('Cada uma das {n} páginas vira um arquivo (baixados juntos num ZIP).', { n: pages })}</p>
        {:else}
          <p class="hint">{tn(picked.length, 'Toque nas páginas que vão para o novo PDF ({n} escolhida).', 'Toque nas páginas que vão para o novo PDF ({n} escolhidas).')}</p>
        {/if}
      </div>
    </div>

    {#if mode === 'pick'}
      <ol class="grid" aria-label={t('Páginas')}>
        {#each { length: pages } as _, i (i)}
          {@const sel = picked.includes(i)}
          <li>
            <button class="pick" class:sel aria-pressed={sel} aria-label={t('Página {n}', { n: i + 1 })} onclick={() => toggle(i)}>
              <span class="sheet"><canvas use:thumb={{ thumbs, src: 0, index: i }} width="140" height="198"></canvas></span>
              {#if sel}<span class="check" aria-hidden="true"><CheckSquare size={20} /></span>{/if}
            </button>
            <span class="num">{i + 1}</span>
          </li>
        {/each}
      </ol>
    {/if}

    <div class="go">
      <button class="button primary" onclick={split} disabled={!!busy || !groups.length}>
        <Split size={20} aria-hidden="true" />
        {mode === 'pick' ? t('Extrair páginas') : tn(groups.length, 'Dividir em {n} arquivo', 'Dividir em {n} arquivos')}
      </button>
    </div>
  {/if}
  {#if busy}<p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> {busy}</p>{/if}
  {#if error}<p class="notice err" role="alert">{error}</p>{/if}
</ToolPage>

<style>
  .file { margin: 0 0 14px; overflow-wrap: anywhere; }
  .link { border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; cursor: pointer; padding: 8px; }
  .grid {
    list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }
  @media (max-width: 420px) { .grid { grid-template-columns: repeat(3, 1fr); gap: 8px; } }
  li { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .pick {
    position: relative; width: 100%; aspect-ratio: 1 / 1.25; display: flex; align-items: center; justify-content: center;
    border: 2px solid transparent; border-radius: 10px; background: var(--surface-2); padding: 6px; cursor: pointer;
  }
  .pick.sel { border-color: var(--accent); background: var(--accent-soft); }
  .sheet { position: absolute; inset: 6px; display: flex; align-items: center; justify-content: center; }
  canvas { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .25); }
  .check { position: absolute; top: 4px; right: 4px; color: var(--accent); background: var(--surface); border-radius: 6px; display: flex; }
  .num { font-weight: 700; font-size: 14px; }
</style>
