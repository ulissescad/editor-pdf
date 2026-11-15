// O que a página inicial pede para o editor abrir (mesma aplicação, sem sair do navegador).
export type PendingOpen =
  | { kind: 'file'; bytes: Uint8Array; name: string }
  | { kind: 'draft'; hash: string };

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

export const isPdfFile = (f: File) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);

/** Reconhece um PDF pelo conteúdo (“%PDF-” no início), para arquivos sem extensão ou sem tipo. */
export const looksLikePdf = (bytes: Uint8Array) =>
  new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-');

/** Lê o arquivo se for PDF (pelo nome, tipo ou conteúdo); senão devolve null. */
export async function readPdf(f: File): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  return isPdfFile(f) || looksLikePdf(bytes) ? bytes : null;
}
