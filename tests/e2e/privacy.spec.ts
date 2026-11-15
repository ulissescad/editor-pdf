import { expect, test } from '@playwright/test';
import { openFromHome, watchNetwork } from './helpers';

// Requisito R3 do PLANO.md: o site resolve tudo internamente.
// Qualquer requisição para fora do próprio site (CDN, fontes, analytics…) reprova o build.
test('nenhuma requisição externa e nenhuma violação de CSP no fluxo completo', async ({ page }) => {
  const net = watchNetwork(page);

  await page.goto('./');
  await page.goto('./#/ferramenta/assinar');
  await openFromHome(page, 'form.pdf');
  await page.locator('#textMode').click();
  const box = (await page.locator('.pdfViewer .page').first().boundingBox())!;
  await page.mouse.click(box.x + 80, Math.min(box.y + box.height / 2, page.viewportSize()!.height - 120));
  await page.keyboard.type('teste');
  const download = page.waitForEvent('download');
  await page.locator('#download').click(); // carrega o pdf-lib sob demanda
  await download;

  expect(net.requests.length).toBeGreaterThan(5);
  expect(net.external()).toEqual([]);
  expect(net.cspErrors).toEqual([]);
});

test('CSP está presente nas páginas publicadas', async ({ page }) => {
  for (const path of ['./', './editor.html']) {
    await page.goto(path);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("default-src 'self'");
  }
});
