// Acrescentado ao service worker (workbox.importScripts em vite.config.ts).
// Com o site instalado, ele aparece em “Compartilhar” no Android (share_target do manifest): o sistema faz um
// POST para ./compartilhar, que nunca chega à internet. Os arquivos ficam num cache local só até a página pegá-los
// (src/lib/incoming.ts).
const SHARED_CACHE = 'editor-pdf-recebidos';

async function receiveShare(request) {
  const scope = self.registration.scope;
  try {
    const form = await request.formData();
    const files = form.getAll('file').filter((f) => f instanceof File && f.size > 0);
    await caches.delete(SHARED_CACHE); // nada de arquivos esquecidos de um compartilhamento anterior
    const cache = await caches.open(SHARED_CACHE);
    await Promise.all(files.map((f, i) => cache.put(
      new Request(`${scope}__recebido/${i}`),
      new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-nome': encodeURIComponent(f.name) } }),
    )));
  } catch (err) {
    console.error(err);
  }
  return Response.redirect(`${scope}#/recebido`, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST') return;
  if (new URL(request.url).pathname !== new URL('compartilhar', self.registration.scope).pathname) return;
  event.respondWith(receiveShare(request));
});
