// O que a página inicial pede para o editor abrir (mesma aplicação, sem sair do navegador).
import { t } from '../lib/i18n.svelte';

export type PendingOpen =
  | { kind: 'file'; bytes: Uint8Array; name: string; then?: 'sign' }
  | { kind: 'draft'; hash: string; then?: 'sign' };

let pending: PendingOpen | null = null;

export function requestOpen(p: PendingOpen) {
  pending = p;
  location.hash = '#/editor';
}

export function takePending(): PendingOpen | null {
  const p = pending;
  pending = null;
  return p;
}

/** Acima disso, no celular, a aba pode ficar lenta ou ser recarregada pelo sistema (PLANO.md, seção 4). */
export const BIG_FILE = 50 * 1024 * 1024;

const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Aviso para arquivos grandes no celular (no computador não há aviso). */
export function bigFileNote(size: number, touch = isTouch()): string | null {
  if (size < BIG_FILE || !touch) return null;
  const mb = Math.round(size / (1024 * 1024));
  return t('Arquivo grande ({mb} MB): neste aparelho ele pode ficar lento ou fazer a página recarregar. Se acontecer, use um computador.', { mb });
}

export const isPdfFile = (f: File) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);

/** Reconhece um PDF pelo conteúdo (“%PDF-” no início), para arquivos sem extensão ou sem tipo. */
export const looksLikePdf = (bytes: Uint8Array) =>
  new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-');

/** Lê o arquivo se for PDF (pelo nome, tipo ou conteúdo); senão devolve null. */
export async function readPdf(f: File): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  return isPdfFile(f) || looksLikePdf(bytes) ? bytes : null;
}
