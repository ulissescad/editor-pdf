import { expect, test } from '@playwright/test';
import { openFromHome } from './helpers';

// Navegadores de celular (Samsung Internet, Chrome não atualizado) ficam atrás do Chrome de computador.
// A versão "moderna" do pdf.js 6 chama APIs recentíssimas sem alternativa e não abria nenhum PDF neles.
// Aqui essas APIs são removidas da página e do worker do pdf.js antes de abrir um arquivo.
const NEW_APIS = [
  'Map.prototype.getOrInsert', 'Map.prototype.getOrInsertComputed',
  'WeakMap.prototype.getOrInsert', 'WeakMap.prototype.getOrInsertComputed',
  'Math.sumPrecise', 'RegExp.escape', 'Promise.try',
  'Uint8Array.fromBase64', 'Uint8Array.prototype.toBase64', 'Uint8Array.prototype.toHex',
];
const STRIP = NEW_APIS.map((p) => { const i = p.lastIndexOf('.'); return `delete ${p.slice(0, i)}[${JSON.stringify(p.slice(i + 1))}];`; }).join('');

test('abre PDF num navegador sem as APIs mais recentes do JavaScript', async ({ page }) => {
  // Anota o estado logo após a remoção (depois, os polyfills do próprio pdf.js recolocam as funções)
  await page.addInitScript(STRIP + 'window.__semApi = typeof Map.prototype.getOrInsertComputed;');
  // O worker é outro contexto: o script dele é reescrito no caminho, com as mesmas remoções no começo
  await page.route(/pdf\.worker[^/]*\.mjs$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: STRIP + await res.text() });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openFromHome(page, 'form.pdf');

  // As APIs sumiram mesmo (senão o teste não provaria nada) e o documento abriu sem erro
  expect(await page.evaluate(() => (window as unknown as { __semApi: string }).__semApi)).toBe('undefined');
  await expect(page.locator('#status.err')).toHaveCount(0);
  await expect(page.locator('.pdfViewer .page')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});
