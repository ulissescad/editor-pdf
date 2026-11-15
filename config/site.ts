// Configurações do site usadas no build (vite.config.ts) e testadas em tests/unit.

/**
 * Caminho base para o GitHub Pages.
 * - Repositório "usuario.github.io"  → site na raiz: "/"
 * - Qualquer outro repositório "repo" → "https://usuario.github.io/repo/": "/repo/"
 * - Sem repositório (desenvolvimento local) → "/"
 * Um BASE_PATH explícito (ex.: domínio próprio) tem prioridade.
 */
export function resolveBase(env: Record<string, string | undefined>): string {
  if (env.BASE_PATH) return withSlashes(env.BASE_PATH);
  const repo = env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repo || /\.github\.io$/i.test(repo)) return '/';
  return withSlashes(repo);
}

function withSlashes(p: string): string {
  const trimmed = p.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

/**
 * Política de segurança: o site só carrega recursos de si mesmo (requisito R3 do PLANO.md).
 * - 'wasm-unsafe-eval': decodificadores de imagem do pdf.js (e qpdf no M5) são WebAssembly.
 * - blob: em worker/img: workers e imagens geradas localmente.
 * - style 'unsafe-inline': estilos dinâmicos do Svelte e das caixas de texto.
 * O GitHub Pages não permite cabeçalhos HTTP, por isso a política vai numa <meta>.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
