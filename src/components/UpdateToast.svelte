<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { pwa } from '../lib/pwa.svelte';
</script>

{#if pwa.needRefresh}
  <div class="toast" role="status">
    <span>{t('Nova versão disponível.')}</span>
    <button class="button primary" onclick={() => pwa.update()}>{t('Atualizar')}</button>
    <button class="button" onclick={() => pwa.dismiss()}>{t('Agora não')}</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed; left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 20;
    margin: 0 auto; max-width: 520px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, .18);
  }
  span { flex: 1 1 160px; font-weight: 600; }
</style>
