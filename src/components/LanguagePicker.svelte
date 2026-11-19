<script lang="ts">
  // Seletor de idioma. A escolha fica guardada neste aparelho; sem escolha, vale o idioma do navegador.
  import { LOCALES, i18n, t } from '../lib/i18n.svelte';
  import Languages from '@lucide/svelte/icons/languages';
</script>

<label class="lang" title={t('Idioma')}>
  <Languages size={18} aria-hidden="true" />
  <span class="visually-hidden">{t('Idioma')}</span>
  <select value={i18n.locale} onchange={(e) => i18n.set(e.currentTarget.value)}>
    {#each LOCALES as l (l.code)}
      <option value={l.code} lang={l.code}>{l.name}</option>
    {/each}
  </select>
</label>

<style>
  .lang {
    display: inline-flex; align-items: center; gap: 4px; min-height: var(--tap); padding: 0 4px 0 10px;
    border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); cursor: pointer;
  }
  .lang:focus-within { outline: 3px solid var(--accent); outline-offset: 2px; }
  select {
    border: 0; background: transparent; color: inherit; font: inherit; font-size: 14px; font-weight: 600;
    min-height: 40px; padding: 0 4px; cursor: pointer; max-width: 9.5em; outline: none;
  }
  /* Celular estreito: o nome do idioma encolhe para a marca do site caber numa linha */
  @media (max-width: 420px) {
    .lang { padding-left: 8px; gap: 2px; }
    select { max-width: 6.2em; font-size: 13px; text-overflow: ellipsis; }
  }
</style>
