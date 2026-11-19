// Idiomas: o site segue o idioma do navegador, deixa trocar pelo seletor e guarda a escolha.
// Também confere que nenhuma tela ficou com texto em português quando o idioma é outro.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers';

// O catálogo importa ícones Svelte, que o Playwright não carrega: os ids e nomes vêm do texto do arquivo
const TOOLS = [...readFileSync(new URL('../../src/lib/tools.ts', import.meta.url), 'utf8')
  .matchAll(/id: '([^']+)', name: tk\('([^']+)'\)/g)].map((m) => ({ id: m[1], name: m[2] }));

/** Texto visível da página, sem o seletor de idioma (que lista “Português”) e sem nomes de arquivo. */
const visibleText = (page: Page) => page.evaluate(() => {
  const parts = [...document.querySelectorAll('main, header, footer, .editor')].map((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('select, .lang, .file strong, .name').forEach((n) => n.remove());
    return clone.innerText;
  });
  return parts.join('\n');
});

// Letras e palavras que só aparecem em português
const PORTUGUESE = /[ãõçÃÕÇ]|\b(não|página|páginas|arquivo|Escolher|Baixar|Abrir|Juntar|Dividir|Comprimir|aparelho|ferramentas)\b/;

test.describe('em inglês (navegador en-US)', () => {
  test.use({ locale: 'en-US' });

  test('início, todas as ferramentas e o editor sem texto em português', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit your PDFs without sending anything to the internet');
    await expect(page).toHaveTitle('PDF Editor');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    expect(await visibleText(page)).not.toMatch(PORTUGUESE);

    expect(TOOLS.length).toBe(17);
    for (const tool of TOOLS) {
      await page.goto(`./#/ferramenta/${tool.id}`);
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(tool.name);
      await expect(page.getByRole('link', { name: 'All tools' }).first()).toBeVisible();
      const text = await visibleText(page);
      expect(text, `#/ferramenta/${tool.id}`).not.toMatch(PORTUGUESE);
    }

    await page.goto('./#/editor');
    await expect(page.getByRole('heading', { name: 'Open a PDF to edit' })).toBeVisible();
    expect(await visibleText(page)).not.toMatch(PORTUGUESE);
  });

  test('editor com um PDF aberto e ferramenta em uso, em inglês', async ({ page }) => {
    await page.goto('./');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open PDF to edit' }).click();
    await (await chooser).setFiles(fixture('flat-table.pdf'));
    await page.locator('html[data-editor-ready="true"]').waitFor();
    await page.locator('.pdfViewer .page canvas').first().waitFor();
    await expect(page.locator('#status')).toContainText('This PDF has no form fields');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Shape', exact: true })).toBeVisible();
    expect(await visibleText(page)).not.toMatch(PORTUGUESE);
  });

  test('dividir: botões, resumo e nome do arquivo em inglês', async ({ page }) => {
    await page.goto('./#/ferramenta/dividir');
    await page.locator('main input[type="file"]').first().setInputFiles(fixture('numbered.pdf'));
    await page.getByRole('button', { name: /Split into 2 files/ }).click();
    await expect(page.getByText('2 files created.')).toBeVisible();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download all (ZIP)' }).click();
    expect((await dl).suggestedFilename()).toBe('numbered-split.zip');
  });
});

test.describe('troca pelo seletor', () => {
  test.use({ locale: 'pt-BR' });

  test('troca para espanhol, guarda a escolha e volta para português', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Abrir PDF para editar' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Idioma' }).selectOption('es');
    await expect(page.getByRole('button', { name: 'Abrir PDF para editar' })).toHaveCount(1); // mesmo texto em espanhol
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edita tus PDF sin enviar nada a internet');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('es');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edita tus PDF sin enviar nada a internet');
    await expect(page.getByRole('combobox', { name: 'Idioma' })).toHaveValue('es');

    await page.getByRole('combobox', { name: 'Idioma' }).selectOption('pt-BR');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edite seus PDFs sem enviar nada para a internet');
  });
});

test.describe('idiomas de outro alfabeto', () => {
  test.use({ locale: 'ja-JP' });

  test('japonês: telas traduzidas e números de página do PDF em inglês (a fonte do PDF não tem kanji)', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('インターネットに何も送らずに PDF を編集');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ja');

    await page.goto('./#/ferramenta/numerar');
    await page.locator('main input[type="file"]').first().setInputFiles(fixture('numbered.pdf'));
    await page.getByLabel('形式').selectOption('pag-de');
    await page.getByRole('button', { name: 'ページ番号を付ける' }).click();
    await expect(page.getByText('完了！')).toBeVisible({ timeout: 30_000 });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ダウンロード' }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toBe('numbered-番号付き.pdf');
    const chunks: Buffer[] = [];
    for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(chunks)), verbosity: 0 }).promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text).toContain('Page 1 of');
  });
});
