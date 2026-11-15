// Passa um arquivo escolhido numa página (ex.: a inicial) para outra (o editor) sem enviá-lo a lugar nenhum:
// ele fica alguns instantes no IndexedDB do próprio navegador e é apagado assim que é lido.

const DB = 'editor-pdf';
const STORE = 'handoff';
const KEY = 'arquivo';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

export async function putHandoff(file: File): Promise<void> {
  const data = await file.arrayBuffer();
  await tx('readwrite', (s) => s.put({ name: file.name, data, at: Date.now() }, KEY));
}

/** Lê e apaga o arquivo deixado por outra página. Ignora entregas com mais de 10 minutos. */
export async function takeHandoff(): Promise<{ name: string; data: ArrayBuffer } | null> {
  try {
    const item = await tx<{ name: string; data: ArrayBuffer; at: number } | undefined>('readonly', (s) => s.get(KEY));
    if (!item) return null;
    await tx('readwrite', (s) => s.delete(KEY));
    return Date.now() - item.at < 10 * 60 * 1000 ? { name: item.name, data: item.data } : null;
  } catch {
    return null; // IndexedDB indisponível (ex.: navegação privada restrita)
  }
}

export const isPdfFile = (f: File) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
