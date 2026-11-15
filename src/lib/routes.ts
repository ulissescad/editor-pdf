// Rotas por hash (#/ferramenta/juntar): funcionam no GitHub Pages sem regras de servidor
// e sobrevivem a recarregar a página. Funções puras, testadas em tests/unit.

export type Route =
  | { name: 'home' }
  | { name: 'tool'; id: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  const [first, second] = path.split('/');
  if (first === 'ferramenta' && second) return { name: 'tool', id: decodeURIComponent(second) };
  return { name: 'home' };
}

export function hrefFor(route: Route): string {
  return route.name === 'tool' ? `#/ferramenta/${encodeURIComponent(route.id)}` : '#/';
}
