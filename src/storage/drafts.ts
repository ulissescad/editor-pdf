// Rascunhos automáticos no IndexedDB do próprio navegador (nada sai do aparelho).
// Chave: SHA-256 do arquivo aberto. Guarda os bytes para poder continuar sem o arquivo original.
import type { ImageAsset, Obj } from '../editor/model';

export interface Draft {
  hash: string;
  name: string;
  bytes: Uint8Array;                 // PDF base (sem os objetos do editor gravados)
  objects: Obj[];
  formValues: Record<string, unknown>;
  images?: ImageAsset[];             // imagens e assinaturas usadas pelos objetos
  pages: number;
  updatedAt: number;
}
export type DraftSummary = Pick<Draft, 'hash' | 'name' | 'pages' | 'updatedAt'>;

const DB = 'editor-pdf';
const VERSION = 3;
const STORE = 'drafts';
export const SIGNATURES = 'signatures';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // rascunhos com mais de 30 dias são apagados

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains('handoff')) db.deleteObjectStore('handoff'); // loja do M0, não usada mais
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'hash' });
      if (!db.objectStoreNames.contains(SIGNATURES)) db.createObjectStore(SIGNATURES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void, store = STORE): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const saveDraft = (d: Draft) => run('readwrite', (s) => s.put(d)).then(() => undefined);
export const getDraft = (hash: string) => run<Draft>('readonly', (s) => s.get(hash));
export const deleteDraft = (hash: string) => run('readwrite', (s) => s.delete(hash)).then(() => undefined);

export async function listDrafts(): Promise<DraftSummary[]> {
  const all = (await run<Draft[]>('readonly', (s) => s.getAll())) ?? [];
  const now = Date.now();
  const expired = all.filter((d) => now - d.updatedAt > MAX_AGE);
  for (const d of expired) await deleteDraft(d.hash);
  return all
    .filter((d) => now - d.updatedAt <= MAX_AGE)
    .map(({ hash, name, pages, updatedAt }) => ({ hash, name, pages, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Identificador do arquivo para o rascunho. SHA-256 quando disponível; fora de HTTPS/localhost
 * (ex.: servidor de teste aberto no celular pela rede local) o navegador não oferece crypto.subtle,
 * então usamos um hash simples (FNV-1a, 2×32 bits) — suficiente para identificar rascunhos.
 */
export async function sha256(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 0x01000193) >>> 0;
  }
  return `fnv-${bytes.length.toString(16)}-${h1.toString(16)}${h2.toString(16)}`;
}
