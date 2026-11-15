// Assinaturas guardadas neste aparelho (IndexedDB), para reutilizar em outros documentos.
import { SIGNATURES, run } from './drafts';

export interface SavedSignature {
  id: string;
  png: Uint8Array;   // PNG com fundo transparente, já recortado
  w: number;
  h: number;
  createdAt: number;
}

const MAX = 8;

export async function listSignatures(): Promise<SavedSignature[]> {
  const all = (await run<SavedSignature[]>('readonly', (s) => s.getAll(), SIGNATURES)) ?? [];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveSignature(sig: SavedSignature) {
  const all = await listSignatures();
  if (all.some((s) => sameBytes(s.png, sig.png))) return; // já guardada
  await run('readwrite', (s) => s.put(sig), SIGNATURES);
  for (const old of all.slice(MAX - 1)) await deleteSignature(old.id);
}

export const deleteSignature = (id: string) => run('readwrite', (s) => s.delete(id), SIGNATURES).then(() => undefined);

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
