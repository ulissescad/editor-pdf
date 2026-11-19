<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  // Proteger com senha (PLANO.md, item 2.7): AES-256 pelo qpdf (WebAssembly), com restrições opcionais.
  import OneFileTool, { type Picked, type Progress, type RunResult } from './OneFileTool.svelte';
  import { ToolError } from './handoff';
  import { baseName } from '../pdf/plan';
  import Lock from '@lucide/svelte/icons/lock';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';

  let password = $state('');
  let confirm = $state('');
  let show = $state(false);
  let print = $state(true);
  let copy = $state(true);
  let modify = $state(true);

  const mismatch = $derived(!!confirm && confirm !== password);
  const ready = $derived(password.length > 0 && confirm === password);

  async function run(f: Picked, progress: Progress): Promise<RunResult> {
    progress(t('Carregando a criptografia…'));
    const { protect, loadQpdf } = await import('../pdf/qpdf');
    await loadQpdf();
    progress(t('Protegendo…'));
    let bytes: Uint8Array;
    try {
      bytes = await protect(f.bytes, password, { print, copy, modify });
    } catch (err) {
      if ((err as Error).name === 'WrongPasswordError') throw new ToolError(t('Este PDF já tem senha. Desbloqueie o arquivo antes de pôr uma senha nova.'));
      throw err;
    }
    const limits = [!print && t('imprimir'), !copy && t('copiar'), !modify && t('alterar')].filter(Boolean);
    return {
      files: [{ name: `${baseName(f.name)}-${t('protegido')}.pdf`, bytes, mime: 'application/pdf' }],
      summary: limits.length
        ? t('Protegido com senha (AES-256), sem permissão para {list}.', { list: limits.join(', ') })
        : t('Protegido com senha (AES-256).'),
      note: t('Guarde a senha: sem ela não há como abrir o arquivo, nem por este site.'),
      editable: false,
    };
  }

  function clear() { password = ''; confirm = ''; }
</script>

<OneFileTool id="proteger" action={t('Proteger PDF')} icon={Lock} {run} canRun={ready} onclear={clear}>
  {#snippet options()}
    <div class="row">
      <label class="label" for="pw">{t('Senha para abrir')}</label>
      <div class="pw">
        <input id="pw" type={show ? 'text' : 'password'} autocomplete="new-password" bind:value={password}>
        <button type="button" class="eye" aria-label={show ? t('Esconder a senha') : t('Mostrar a senha')} aria-pressed={show} onclick={() => (show = !show)}>
          {#if show}<EyeOff size={20} aria-hidden="true" />{:else}<Eye size={20} aria-hidden="true" />{/if}
        </button>
      </div>
    </div>
    <div class="row">
      <label class="label" for="pw2">{t('Repita a senha')}</label>
      <input id="pw2" type={show ? 'text' : 'password'} autocomplete="new-password" bind:value={confirm}>
      {#if mismatch}<p class="notice warn">{t('As senhas não são iguais.')}</p>{/if}
    </div>
    <fieldset class="row perms">
      <legend class="label">{t('Quem abrir com a senha pode')}</legend>
      <label class="check"><input type="checkbox" bind:checked={print}> {t('Imprimir')}</label>
      <label class="check"><input type="checkbox" bind:checked={copy}> {t('Copiar texto e imagens')}</label>
      <label class="check"><input type="checkbox" bind:checked={modify}> {t('Alterar, comentar e preencher')}</label>
      <p class="hint">{t('As restrições são respeitadas pelos leitores de PDF comuns (Acrobat, navegadores), mas não são uma proteção forte. A senha de abrir é.')}</p>
    </fieldset>
  {/snippet}
</OneFileTool>

<style>
  .pw { display: flex; gap: 6px; max-width: 420px; }
  .pw input { flex: 1; }
  input[type="password"], input[type="text"] {
    min-height: var(--tap); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px;
    background: var(--surface); color: var(--text); font: inherit; width: 100%; max-width: 420px;
  }
  .eye { flex: none; width: var(--tap); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .perms { border: 0; padding: 0; margin: 0; }
  .check { display: flex; align-items: center; gap: 10px; min-height: 40px; cursor: pointer; }
  .check input { width: 20px; height: 20px; }
</style>
