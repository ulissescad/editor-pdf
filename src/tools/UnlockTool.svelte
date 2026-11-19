<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  // Desbloquear (PLANO.md, item 2.7): tira a senha com a senha correta. PDFs que abrem sem senha mas têm
  // restrições (impressão, cópia) são liberados direto.
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import { ToolError } from './handoff';
  import { baseName } from '../pdf/plan';
  import type { Encryption } from '../pdf/qpdf';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';

  let kind = $state<Encryption | null>(null);
  let password = $state('');
  let show = $state(false);

  async function pick(f: Picked) {
    const { encryptionOf } = await import('../pdf/qpdf');
    kind = await encryptionOf(f.bytes);
  }

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    progress(t('Desbloqueando…'));
    const { unlock } = await import('../pdf/qpdf');
    let bytes: Uint8Array;
    try {
      bytes = await unlock(f.bytes, kind === 'password' ? password : '');
    } catch (err) {
      if ((err as Error).name === 'WrongPasswordError') throw new ToolError(t('Senha incorreta. Confira letras maiúsculas e minúsculas.'));
      throw err;
    }
    return {
      files: [{ name: `${baseName(f.name)}-${t('desbloqueado')}.pdf`, bytes, mime: 'application/pdf' }],
      summary: kind === 'password' ? t('A senha foi removida.') : t('As restrições foram removidas.'),
    };
  }
</script>

<OneFileTool id="desbloquear" action={kind === 'restrictions' ? t('Remover restrições') : t('Desbloquear PDF')} icon={LockOpen}
  {run} open={false} onpick={pick} onclear={() => { kind = null; password = ''; }}
  canRun={kind === 'restrictions' || (kind === 'password' && password.length > 0)}>
  {#snippet options()}
    {#if kind === 'none'}
      <p class="notice ok">{t('Este PDF não tem senha nem restrições. Ele já pode ser usado em qualquer ferramenta.')}</p>
    {:else if kind === 'restrictions'}
      <p class="notice info">{t('Este PDF abre sem senha, mas tem restrições (como bloquear impressão ou cópia). Elas podem ser removidas.')}</p>
    {:else if kind === 'password'}
      <div class="row">
        <label class="label" for="pw">{t('Senha do PDF')}</label>
        <div class="pw">
          <!-- svelte-ignore a11y_autofocus -->
          <input id="pw" type={show ? 'text' : 'password'} autocomplete="current-password" bind:value={password} autofocus>
          <button type="button" class="eye" aria-label={show ? t('Esconder a senha') : t('Mostrar a senha')} aria-pressed={show} onclick={() => (show = !show)}>
            {#if show}<EyeOff size={20} aria-hidden="true" />{:else}<Eye size={20} aria-hidden="true" />{/if}
          </button>
        </div>
        <p class="hint">{t('A senha é verificada só neste aparelho.')}</p>
      </div>
    {/if}
  {/snippet}
</OneFileTool>

<style>
  .pw { display: flex; gap: 6px; max-width: 420px; }
  .pw input {
    flex: 1; min-height: var(--tap); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px;
    background: var(--surface); color: var(--text); font: inherit;
  }
  .eye { flex: none; width: var(--tap); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); cursor: pointer; display: flex; align-items: center; justify-content: center; }
</style>
