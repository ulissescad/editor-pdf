<script lang="ts">
  // Ferramenta “Assinar PDF”: escolher o arquivo e cair no editor com a assinatura já aberta.
  import { requestOpen, readPdf } from '../editor/session';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Signature from '@lucide/svelte/icons/signature';
  import FileUp from '@lucide/svelte/icons/file-up';

  let input: HTMLInputElement;
  let error = $state('');
  let dragging = $state(false);

  async function open(file: File | undefined) {
    error = '';
    if (!file) return;
    const bytes = await readPdf(file);
    if (!bytes) { error = 'Escolha um arquivo .pdf.'; return; }
    requestOpen({ kind: 'file', bytes, name: /\.pdf$/i.test(file.name) ? file.name : `${file.name}.pdf`, then: 'sign' });
  }
</script>

<section class="wrap page">
  <a class="back" href="#/"><ArrowLeft size={18} aria-hidden="true" /> Todas as ferramentas</a>
  <div class="box" class:dragging role="region" aria-label="Escolher PDF para assinar"
    ondragover={(e) => { e.preventDefault(); dragging = true; }}
    ondragleave={() => (dragging = false)}
    ondrop={(e) => { e.preventDefault(); dragging = false; open(e.dataTransfer?.files[0]); }}>
    <span class="icon"><Signature size={32} aria-hidden="true" /></span>
    <h1>Assinar PDF</h1>
    <p>Desenhe com o dedo, digite seu nome ou use a foto da sua assinatura. Depois, arraste até o lugar certo e baixe o PDF assinado.</p>
    <button class="button primary big" onclick={() => input.click()}><FileUp size={20} aria-hidden="true" /> Escolher PDF para assinar</button>
    <input bind:this={input} type="file" accept="application/pdf,.pdf" hidden onchange={(e) => open(e.currentTarget.files?.[0])}>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="note">Assinatura eletrônica simples, feita no seu aparelho. O arquivo não é enviado para lugar nenhum.</p>
  </div>
</section>

<style>
  .page { padding-top: 16px; }
  .back { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); text-decoration: none; font-weight: 600; }
  .box { background: var(--surface); border: 2px dashed var(--border); border-radius: 16px; padding: 24px 20px; text-align: center; }
  .box.dragging { border-color: var(--accent); }
  .icon { display: inline-flex; width: 64px; height: 64px; align-items: center; justify-content: center; border-radius: 16px; background: var(--accent-soft); color: var(--accent); }
  h1 { font-size: 24px; margin: 12px 0 4px; }
  p { color: var(--muted); margin: 0 auto 16px; max-width: 52ch; }
  .note { font-size: 13px; margin: 16px auto 0; }
  .error { color: var(--err-text); }
</style>
