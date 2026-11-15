// Arquivos das fontes extras para embutir no PDF, servidos pelo próprio site (funcionam offline).
// O PDF usa o WOFF (o fontkit não recorta WOFF2); a tela usa o WOFF2 da mesma fonte, com as mesmas medidas.
import openSans400 from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url';
import openSans700 from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url';
import openSans400i from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff?url';
import openSans700i from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff?url';
import caveat400 from '@fontsource/caveat/files/caveat-latin-400-normal.woff?url';
import caveat700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff?url';
import dancing400 from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?url';
import dancing700 from '@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff?url';

const URLS: Record<string, string> = {
  'open-sans/files/open-sans-latin-400-normal.woff': openSans400,
  'open-sans/files/open-sans-latin-700-normal.woff': openSans700,
  'open-sans/files/open-sans-latin-400-italic.woff': openSans400i,
  'open-sans/files/open-sans-latin-700-italic.woff': openSans700i,
  'caveat/files/caveat-latin-400-normal.woff': caveat400,
  'caveat/files/caveat-latin-700-normal.woff': caveat700,
  'dancing-script/files/dancing-script-latin-400-normal.woff': dancing400,
  'dancing-script/files/dancing-script-latin-700-normal.woff': dancing700,
};

const cache = new Map<string, Promise<Uint8Array>>();

/** Bytes de um arquivo de fonte listado em FONTS (model.ts). */
export function loadFontFile(path: string): Promise<Uint8Array> {
  let p = cache.get(path);
  if (!p) {
    const url = URLS[path];
    if (!url) return Promise.reject(new Error(`Fonte desconhecida: ${path}`));
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Fonte não carregou: ${path}`);
      return r.arrayBuffer();
    }).then((b) => new Uint8Array(b));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}
