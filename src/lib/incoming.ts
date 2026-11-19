// Arquivos que chegam de fora do site: “Compartilhar” do Android (share_target, ver public/share-target.js)
// e “Abrir com” do computador (file_handlers + launchQueue). Sem suporte no navegador, nada disso aparece.
import { isPdfFile, looksLikePdf, requestOpen } from '../editor/session';
import { sendToTool, type ToolFile } from '../tools/handoff';
import { hrefFor } from './routes';

const SHARED_CACHE = 'editor-pdf-recebidos'; // o mesmo de public/share-target.js

export interface Incoming extends ToolFile { type: string }

export type IncomingPlan =
  | { to: 'editor'; file: ToolFile }
  | { to: 'tool'; tool: 'juntar' | 'imagens-para-pdf'; files: ToolFile[] }
  | { to: 'nothing' };

const isImage = (f: Incoming) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(f.name);

/** Um PDF abre no editor; vários vão para “Juntar”; só imagens vão para “Imagens para PDF”. */
export function planIncoming(files: Incoming[]): IncomingPlan {
  const pdfs = files
    .filter((f) => isPdfFile(f as unknown as File) || looksLikePdf(f.bytes))
    .map(({ name, bytes }) => ({ name: /\.pdf$/i.test(name) ? name : `${name}.pdf`, bytes }));
  if (pdfs.length === 1) return { to: 'editor', file: pdfs[0] };
  if (pdfs.length) return { to: 'tool', tool: 'juntar', files: pdfs };
  const images = files.filter(isImage).map(({ name, bytes }) => ({ name, bytes }));
  return images.length ? { to: 'tool', tool: 'imagens-para-pdf', files: images } : { to: 'nothing' };
}

/** Leva os arquivos para o lugar certo. Devolve false se nenhum deles puder ser usado. */
export function deliver(files: Incoming[]): boolean {
  const plan = planIncoming(files);
  if (plan.to === 'nothing') return false;
  // “Voltar” leva ao início, e não de novo à tela de recebimento
  history.replaceState(null, '', hrefFor({ name: 'home' }));
  if (plan.to === 'editor') requestOpen({ kind: 'file', bytes: plan.file.bytes, name: plan.file.name });
  else sendToTool(plan.tool, plan.files);
  return true;
}

/** Pega os arquivos deixados pelo service worker e apaga a cópia guardada. */
export async function takeShared(): Promise<Incoming[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open(SHARED_CACHE);
  const index = (r: Request) => Number(r.url.split('/').pop());
  const keys = [...await cache.keys()].sort((x, y) => index(x) - index(y));
  const files: Incoming[] = [];
  for (const key of keys) {
    const res = await cache.match(key);
    if (!res) continue;
    files.push({
      name: decodeURIComponent(res.headers.get('x-nome') ?? 'arquivo'),
      type: res.headers.get('content-type') ?? '',
      bytes: new Uint8Array(await res.arrayBuffer()),
    });
  }
  await caches.delete(SHARED_CACHE);
  return files;
}

interface LaunchParams { files?: Array<{ getFile(): Promise<File> }> }
interface LaunchQueue { setConsumer(fn: (p: LaunchParams) => void): void }

/** “Abrir com o Editor de PDF” (site instalado no computador, Chrome e Edge). */
export function listenForLaunch() {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    try {
      const list = await Promise.all(files.map((h) => h.getFile()));
      deliver(await Promise.all(list.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    } catch (err) {
      console.error(err);
    }
  });
}
