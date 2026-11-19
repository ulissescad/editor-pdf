// Idiomas: cada arquivo de tradução tem todas as chaves usadas no código, com os mesmos {campos}
// e as formas de plural que a língua usa; e as funções t(), tn() e tPdf() se comportam como esperado.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, i18n, matchLocale, t, tn, tPdf, type Dict, type PluralForms } from '../../src/lib/i18n.svelte.ts';
import { collectKeys, placeholders } from '../i18n-keys.ts';

const files = import.meta.glob<{ default: Dict }>('../../src/i18n/*.ts', { eager: true });
const dictOf = (code: string) => files[`../../src/i18n/${code}.ts`]?.default;
const { simple, plural } = collectKeys();
const others = LOCALES.filter((l) => l.code !== DEFAULT_LOCALE);

describe('arquivos de tradução', () => {
  it('existe um arquivo para cada idioma da lista (e nenhum a mais)', () => {
    const codes = Object.keys(files).map((p) => p.match(/([\w-]+)\.ts$/)![1]).sort();
    expect(codes).toEqual(others.map((l) => l.code).sort());
  });

  it('o código usa chaves de tradução', () => {
    expect(simple.size).toBeGreaterThan(500);
    expect(plural.size).toBeGreaterThan(20);
  });

  describe.each(others)('$name ($code)', ({ code }) => {
    const dict = dictOf(code)!;
    const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;

    it('tem todas as chaves e nenhuma sobrando', () => {
      const missing = [...simple, ...plural].filter((k) => !(k in dict));
      const extra = Object.keys(dict).filter((k) => !simple.has(k) && !plural.has(k));
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    });

    it('mantém os {campos} de cada texto', () => {
      const wrong: string[] = [];
      for (const key of simple) {
        const v = dict[key];
        if (typeof v !== 'string') { wrong.push(`${key} (não é texto)`); continue; }
        if (placeholders(v).join() !== placeholders(key).join()) wrong.push(`${key} → ${v}`);
        if (!v.trim()) wrong.push(`${key} (vazio)`);
      }
      expect(wrong).toEqual([]);
    });

    it('traz as formas de plural da língua, com os mesmos {campos}', () => {
      const wrong: string[] = [];
      for (const key of plural) {
        const v = dict[key];
        const want = placeholders(key.split('|')[1]).join();
        if (typeof v === 'string') {
          if (placeholders(v).join() !== want) wrong.push(`${key} → ${v}`);
          continue;
        }
        const forms = v as PluralForms;
        for (const c of categories) {
          // “many” do espanhol, francês e italiano é só para milhões: pode ficar com “other”
          if (!(c in forms) && !(c === 'many' && ['es', 'fr', 'it'].includes(code))) wrong.push(`${key} (falta “${c}”)`);
        }
        for (const [c, text] of Object.entries(forms)) {
          if (placeholders(text!).filter((p) => p !== 'n').join() !== placeholders(key.split('|')[1]).filter((p) => p !== 'n').join()) wrong.push(`${key} [${c}] → ${text}`);
        }
      }
      expect(wrong).toEqual([]);
    });

    it('nomes de arquivo sugeridos não têm espaços nem barras', () => {
      for (const k of ['achatado', 'antiga-marcada', 'comprimido', 'desbloqueado', 'digitalizado', 'dividido', 'documento', 'editado',
        'extraidas', 'imagens', 'junto', 'marca-dagua', 'nova-marcada', 'numerado', 'organizado', 'pagina', 'paginas', 'protegido', 'recortado', 'tarjado']) {
        expect(dict[k], `${code}: ${k}`).toMatch(/^[^\s/\\:*?"<>|]+$/);
      }
    });
  });
});

describe('escolha do idioma', () => {
  it('usa o idioma do navegador, a variante mais próxima ou o português', () => {
    expect(matchLocale(['en-US'])).toBe('en');
    expect(matchLocale(['es-AR', 'en'])).toBe('es');
    expect(matchLocale(['pt-PT'])).toBe('pt-BR');
    expect(matchLocale(['zh-TW'])).toBe('zh-CN');
    expect(matchLocale(['ja'])).toBe('ja');
    expect(matchLocale(['sw', 'nl'])).toBe('pt-BR');
    expect(matchLocale([])).toBe('pt-BR');
  });
});

describe('t, tn e tPdf', () => {
  it('em português a chave é o próprio texto', async () => {
    await i18n.set('pt-BR');
    expect(t('Baixar')).toBe('Baixar');
    expect(t('Página {n}', { n: 3 })).toBe('Página 3');
    expect(tn(1, '{n} página', '{n} páginas')).toBe('1 página');
    expect(tn(2, '{n} página', '{n} páginas')).toBe('2 páginas');
    expect(t('{n} arquivos · {size} no total', { n: 1200, size: '3 MB' })).toBe('1.200 arquivos · 3 MB no total');
  });

  it('em inglês, traduz, escolhe o plural e formata os números', async () => {
    await i18n.set('en');
    expect(t('Baixar')).toBe('Download');
    expect(tn(1, '{n} página', '{n} páginas')).toBe('1 page');
    expect(tn(1200, '{n} página', '{n} páginas')).toBe('1,200 pages');
    expect(tPdf('Página {n} de {total}', { n: '2', total: '9' })).toBe('Page 2 of 9');
  });

  it('em russo, usa as três formas do plural', async () => {
    await i18n.set('ru');
    const forms = [1, 3, 5, 21].map((n) => tn(n, '{n} página', '{n} páginas'));
    expect(new Set(forms.map((f) => f.split(' ')[1])).size).toBe(3);
  });

  it('no PDF, idiomas de outro alfabeto usam o inglês (as fontes padrão do PDF não têm essas letras)', async () => {
    for (const code of ['ru', 'ja', 'zh-CN', 'ko', 'hi']) {
      await i18n.set(code);
      expect(tPdf('Página {n} de {total}', { n: '2', total: '9' })).toBe('Page 2 of 9');
      expect(tPdf('CONFIDENCIAL')).toBe('CONFIDENTIAL');
    }
    await i18n.set('fr');
    expect(tPdf('CONFIDENCIAL')).toMatch(/^[\x20-\xff]+$/);
    await i18n.set('pt-BR');
  });
});
