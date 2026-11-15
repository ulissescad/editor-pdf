import { expect, test } from '@playwright/test';
import { addText, downloadPdf, openFromHome, watchNetwork } from './helpers';

// Requisito R3 do PLANO.md: o site resolve tudo internamente.
// Qualquer requisição para fora do próprio site (CDN, fontes, analytics…) reprova o build.
test('nenhuma requisição externa e nenhuma violação de CSP no fluxo completo', async ({ page }) => {
  const net = watchNetwork(page);

  await page.goto('./');
  await page.goto('./#/ferramenta/assinar');
  await openFromHome(page, 'form.pdf');
  await addText(page, 'teste');
  // Assinatura digitada: as fontes cursivas também vêm do próprio site
  await page.locator('nav.tools').getByRole('button', { name: 'Assinar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assinatura' });
  await dialog.getByRole('tab', { name: 'Digitar' }).click();
  await dialog.getByPlaceholder('Digite seu nome').fill('Teste');
  await page.evaluate(() => document.fonts.ready);
  await dialog.getByRole('button', { name: 'Usar' }).click();
  await downloadPdf(page); // carrega o pdf-lib sob demanda

  expect(net.requests.length).toBeGreaterThan(5);
  expect(net.external()).toEqual([]);
  expect(net.cspErrors).toEqual([]);
});

test('CSP está presente na página publicada', async ({ page }) => {
  await page.goto('./');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
});
