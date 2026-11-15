<script lang="ts">
  import { onMount } from 'svelte';
  import Clock from '@lucide/svelte/icons/clock';
  import Trash from '@lucide/svelte/icons/trash';
  import { deleteDraft, listDrafts, type DraftSummary } from '../storage/drafts';

  let { onopen }: { onopen: (hash: string) => void } = $props();
  let drafts = $state<DraftSummary[]>([]);

  const fmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  onMount(async () => {
    drafts = await listDrafts().catch(() => []);
  });

  async function remove(hash: string) {
    await deleteDraft(hash).catch(() => {});
    drafts = drafts.filter((d) => d.hash !== hash);
  }
</script>

{#if drafts.length}
  <section class="drafts" aria-labelledby="drafts-title">
    <h2 id="drafts-title"><Clock size={18} aria-hidden="true" /> Continuar de onde parou</h2>
    <ul>
      {#each drafts as d (d.hash)}
        <li>
          <button class="open" onclick={() => onopen(d.hash)}>
            <span class="name">{d.name}</span>
            <span class="meta">{d.pages} página{d.pages === 1 ? '' : 's'} · {fmt.format(d.updatedAt)}</span>
          </button>
          <button class="del" aria-label="Apagar rascunho de {d.name}" title="Apagar rascunho" onclick={() => remove(d.hash)}>
            <Trash size={18} />
          </button>
        </li>
      {/each}
    </ul>
    <p class="note">Os rascunhos ficam só neste navegador e são apagados depois de 30 dias.</p>
  </section>
{/if}

<style>
  .drafts { margin-top: 20px; }
  h2 { display: flex; align-items: center; gap: 8px; font-size: 18px; margin: 0 0 10px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li { display: flex; align-items: stretch; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius, 10px); overflow: hidden; }
  .open { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 14px; border: 0; background: none; color: var(--text); text-align: left; cursor: pointer; font: inherit; min-height: 44px; }
  .open:hover { background: var(--surface-2); }
  .name { font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--muted); font-size: 14px; }
  .del { width: 48px; border: 0; border-left: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
  .del:hover { color: var(--err-text); background: var(--err-bg); }
  .note { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
</style>
