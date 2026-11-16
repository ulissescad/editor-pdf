<script lang="ts">
  // Escolher arquivos: botão grande, arrastar e soltar e, para imagens, a câmera do celular.
  import FileUp from '@lucide/svelte/icons/file-up';
  import Camera from '@lucide/svelte/icons/camera';
  import Plus from '@lucide/svelte/icons/plus';

  let {
    label, accept = 'application/pdf,.pdf', multiple = false, camera = false, compact = false, hint = 'ou arraste para esta área',
    onfiles,
  }: {
    label: string; accept?: string; multiple?: boolean; camera?: boolean; compact?: boolean; hint?: string;
    onfiles: (files: File[]) => void;
  } = $props();

  let input: HTMLInputElement;
  let cameraInput = $state<HTMLInputElement>();
  let dragging = $state(false);
  // A câmera só faz sentido em aparelhos de toque (no computador o “capture” abre o seletor comum)
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  function pick(list: FileList | null | undefined) {
    const files = [...(list ?? [])];
    if (files.length) onfiles(multiple ? files : files.slice(0, 1));
  }
</script>

<div class="drop" class:compact class:dragging role="region" aria-label={label}
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => { e.preventDefault(); dragging = false; pick(e.dataTransfer?.files); }}>
  <div class="buttons">
    <button type="button" class="button" class:primary={!compact} onclick={() => input.click()}>
      {#if compact}<Plus size={18} aria-hidden="true" />{:else}<FileUp size={20} aria-hidden="true" />{/if}
      {label}
    </button>
    {#if camera && touch}
      <button type="button" class="button" onclick={() => cameraInput?.click()}><Camera size={20} aria-hidden="true" /> Tirar foto</button>
    {/if}
  </div>
  {#if !compact && hint}<p class="hint">{hint}</p>{/if}
  <input bind:this={input} type="file" {accept} {multiple} hidden aria-label={label}
    onchange={(e) => { pick(e.currentTarget.files); e.currentTarget.value = ''; }}>
  {#if camera}
    <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" hidden aria-label="Tirar foto"
      onchange={(e) => { pick(e.currentTarget.files); e.currentTarget.value = ''; }}>
  {/if}
</div>

<style>
  .drop {
    background: var(--surface); border: 2px dashed var(--border); border-radius: 16px; padding: 24px 16px; text-align: center;
  }
  .drop.compact { padding: 10px; border-width: 1.5px; }
  .drop.dragging { border-color: var(--accent); background: var(--accent-soft); }
  .buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
  .drop:not(.compact) .button { min-height: 52px; font-size: 17px; padding: 0 22px; }
  .hint { color: var(--muted); margin: 10px 0 0; font-size: 14px; }
</style>
