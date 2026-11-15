import { describe, expect, it } from 'vitest';
import { CSP, resolveBase } from '../../config/site.ts';
import { hrefFor, parseHash } from '../../src/lib/routes.ts';
import { TOOLS } from '../../src/lib/tools.ts';

describe('resolveBase (caminho do GitHub Pages)', () => {
  it('usa a raiz sem repositório (desenvolvimento local)', () => {
    expect(resolveBase({})).toBe('/');
  });
  it('usa /<repo>/ para repositórios de projeto', () => {
    expect(resolveBase({ GITHUB_REPOSITORY: 'fulano/editor-pdf' })).toBe('/editor-pdf/');
  });
  it('usa a raiz para o repositório <usuario>.github.io', () => {
    expect(resolveBase({ GITHUB_REPOSITORY: 'fulano/fulano.github.io' })).toBe('/');
  });
  it('respeita BASE_PATH explícito e normaliza as barras', () => {
    expect(resolveBase({ BASE_PATH: 'pdf', GITHUB_REPOSITORY: 'a/b' })).toBe('/pdf/');
    expect(resolveBase({ BASE_PATH: '/' })).toBe('/');
  });
});

describe('CSP', () => {
  it('só permite o próprio site como origem', () => {
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).not.toMatch(/https?:/);
    expect(CSP).not.toContain("'unsafe-eval'");
  });
});

describe('rotas por hash', () => {
  it('interpreta início e ferramentas', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/ferramenta/juntar')).toEqual({ name: 'tool', id: 'juntar' });
    expect(parseHash('#/ferramenta/juntar/')).toEqual({ name: 'tool', id: 'juntar' });
    expect(parseHash('#/qualquer-coisa')).toEqual({ name: 'home' });
    expect(parseHash('#/editor')).toEqual({ name: 'editor' });
    expect(hrefFor({ name: 'editor' })).toBe('#/editor');
  });
  it('gera e interpreta o mesmo endereço', () => {
    for (const t of TOOLS) {
      expect(parseHash(hrefFor({ name: 'tool', id: t.id }))).toEqual({ name: 'tool', id: t.id });
    }
  });
});

describe('catálogo de ferramentas', () => {
  it('tem ids únicos e válidos para URL', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});
