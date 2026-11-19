<script lang="ts">
  // Destino do “Compartilhar” do celular: pega o arquivo guardado pelo service worker e abre no lugar certo.
  import { onMount } from 'svelte';
  import { deliver, takeShared } from '../lib/incoming';
  import Loader from '@lucide/svelte/icons/loader-circle';

  let failed = $state(false);

  onMount(async () => {
    try {
      failed = !deliver(await takeShared());
    } catch (err) {
      console.error(err);
      failed = true;
    }
  });
</script>

<section class="wrap box">
  {#if failed}
    <h1>Nenhum arquivo para abrir</h1>
    <p>Compartilhe um PDF ou uma imagem com o Editor de PDF, ou escolha o arquivo na página inicial.</p>
    <a class="button primary" href="#/">Ir para o início</a>
  {:else}
    <p class="notice info" role="status"><Loader size={18} class="spin" aria-hidden="true" /> Abrindo o arquivo recebido…</p>
  {/if}
</section>

<style>
  .box { padding-top: 32px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: var(--muted); }
  .notice { justify-content: center; color: var(--text); }
</style>
