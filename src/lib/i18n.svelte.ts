// Idiomas do site (requisito R8). O texto em português é a própria chave: t('Escolher PDF').
// Cada idioma é um arquivo em src/i18n/<código>.ts, baixado só por quem usa aquele idioma.
// Sem serviço de tradução externo: tudo fica no próprio site (R3, R9).

export interface Locale { code: string; name: string }

/** Idiomas disponíveis, com o nome em cada idioma. O português é o padrão e não precisa de arquivo. */
export const LOCALES: Locale[] = [
  { code: 'pt-BR', name: 'Português' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'ru', name: 'Русский' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-CN', name: '简体中文' },
];

export const DEFAULT_LOCALE = 'pt-BR';
/** Idiomas cujas letras as fontes padrão do PDF não desenham (outros alfabetos, ou acentos fora do WinAnsi). */
const NON_LATIN = ['ru', 'hi', 'ja', 'ko', 'zh-CN', 'vi'];

/** Formas do plural (categorias do Intl.PluralRules). `other` é obrigatória. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Dict = Record<string, string | PluralForms>;

const loaders = import.meta.glob<{ default: Dict }>('../i18n/*.ts');
const STORAGE_KEY = 'editor-pdf:idioma';

/** O idioma da lista que melhor atende às preferências do navegador. */
export function matchLocale(wanted: readonly string[]): string {
  const codes = LOCALES.map((l) => l.code);
  for (const w of wanted) {
    const lower = w.toLowerCase();
    const exact = codes.find((c) => c.toLowerCase() === lower);
    if (exact) return exact;
    const base = lower.split('-')[0];
    const sameBase = codes.find((c) => c.toLowerCase().split('-')[0] === base);
    if (sameBase) return sameBase; // pt-PT → pt-BR, es-AR → es, zh-TW → zh-CN
  }
  return DEFAULT_LOCALE;
}

class I18n {
  locale = $state(DEFAULT_LOCALE);
  #dict = $state.raw<Dict>({});
  #latin: Dict = {};   // inglês, para textos do PDF em idiomas de outro alfabeto (tPdf)
  #plural = new Intl.PluralRules(DEFAULT_LOCALE);

  get dict() { return this.#dict; }
  get latin() { return this.#latin; }
  get plural() { return this.#plural; }

  /** Escolhe o idioma salvo ou o do navegador e carrega o arquivo dele (antes de mostrar o site). */
  async init() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* armazenamento bloqueado */ }
    const wanted = saved && LOCALES.some((l) => l.code === saved) ? [saved] : [...(navigator.languages ?? [navigator.language ?? DEFAULT_LOCALE])];
    await this.#apply(matchLocale(wanted));
  }

  /** Troca o idioma (escolha da pessoa, guardada neste aparelho). */
  async set(code: string) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* sem armazenamento: vale só nesta visita */ }
    await this.#apply(code);
  }

  async #apply(code: string) {
    let dict: Dict = {}, latin: Dict = {};
    const load = (c: string) => loaders[`../i18n/${c}.ts`]?.().then((m) => m.default) ?? Promise.resolve({});
    try {
      if (code !== DEFAULT_LOCALE) dict = await load(code);
      if (NON_LATIN.includes(code)) latin = await load('en');
    } catch (err) {
      console.error(err);
      code = DEFAULT_LOCALE;
      dict = {};
    }
    this.#latin = latin;
    this.#plural = new Intl.PluralRules(code);
    this.#dict = dict;
    this.locale = code;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = code;
      document.title = t('Editor de PDF');
    }
  }
}

export const i18n = new I18n();

function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    if (v === undefined) return m;
    return typeof v === 'number' ? fmtNumber(v) : v;
  });
}

/** Texto traduzido. `vars` preenche os {campos}; números saem no formato do idioma. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const v = i18n.dict[key];
  return fill(typeof v === 'string' ? v : typeof v === 'object' ? v.other : key, vars);
}

/**
 * Texto com plural: `tn(n, '{n} página', '{n} páginas')`. A chave é “singular|plural” em português;
 * cada idioma traz as formas que a língua dele usa (russo e polonês têm “few” e “many”, japonês só “other”).
 */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const all = { n, ...vars };
  const v = i18n.dict[`${one}|${other}`];
  if (v === undefined) return fill(n === 1 ? one : other, all);
  if (typeof v === 'string') return fill(v, all);
  const cat = i18n.plural.select(n);
  return fill(v[cat] ?? v.other, all);
}

/** Marca um texto para tradução sem traduzir agora (catálogos fixos; traduz com t() na hora de mostrar). */
export const tk = (key: string) => key;

// Caracteres que as fontes padrão do PDF (WinAnsi) desenham: Latin-1 e alguns sinais tipográficos.
const WIN_ANSI = /^[\x20-\x7e\xa0-\xff\n€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;

/**
 * Texto que vai dentro do PDF com as fontes padrão (números de página, marca d’água sugerida).
 * Se a tradução usar letras que essas fontes não têm (cirílico, japonês…), usa o inglês.
 */
export function tPdf(key: string, vars?: Record<string, string | number>): string {
  const local = t(key, vars);
  if (WIN_ANSI.test(local)) return local;
  const v = i18n.latin[key];
  const en = fill(typeof v === 'string' ? v : typeof v === 'object' ? v.other : key, vars);
  return WIN_ANSI.test(en) ? en : fill(key, vars);
}

/** Número no formato do idioma (1.234,5 · 1,234.5). */
export function fmtNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.locale, options).format(n);
}

/** Data e hora no formato do idioma. */
export function fmtDate(d: Date | number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(i18n.locale, options).format(d);
}
