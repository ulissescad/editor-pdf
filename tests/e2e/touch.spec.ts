// Detalhes de toque do PLANO.md (seção 4): menu do objeto (toque longo, clique direito, tecla de menu)
// e caixa em edição acima do teclado virtual.
import { expect, test, type Page } from '@playwright/test';
import { addText, openFromHome, tapAt } from './helpers';

const boxes = (page: Page) => page.locator('.object-layer .tbox');
const menu = (page: Page) => page.getByRole('menu', { name: 'Ações do objeto' });

test('menu pelo clique direito: trazer para a frente, duplicar e excluir', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Clique direito é do computador; no celular vale o toque longo');
  await openFromHome(page, 'text.pdf');
  await addText(page, 'Primeiro', 0.2, 0.3);
  await addText(page, 'Segundo', 0.2, 0.5);
  await expect(boxes(page)).toHaveCount(2);

  await boxes(page).first().click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();
  await menu(page).getByRole('menuitem', { name: 'Trazer para a frente' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(boxes(page).last()).toContainText('Primeiro');

  await boxes(page).last().click({ button: 'right' });
  await menu(page).getByRole('menuitem', { name: 'Enviar para trás' }).click();
  await expect(boxes(page).first()).toContainText('Primeiro');

  await boxes(page).first().click({ button: 'right' });
  await menu(page).getByRole('menuitem', { name: 'Duplicar' }).click();
  await expect(boxes(page)).toHaveCount(3);
  await boxes(page).last().click({ button: 'right' });
  await menu(page).getByRole('menuitem', { name: 'Excluir' }).click();
  await expect(boxes(page)).toHaveCount(2);

  // Desfazer volta a exclusão
  await page.keyboard.press('Control+z');
  await expect(boxes(page)).toHaveCount(3);
});

test('menu pelo teclado (Shift+F10), navegação por setas e Escape', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Teclado físico');
  await openFromHome(page, 'text.pdf');
  await addText(page, 'Teclado');
  await boxes(page).first().click();
  await page.keyboard.press('Escape'); // sai da edição; a caixa continua selecionada
  await boxes(page).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tbox.selected')).toHaveCount(1);
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem', { name: 'Duplicar' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(menu(page).getByRole('menuitem', { name: 'Excluir' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(boxes(page)).toHaveCount(1); // Escape no menu não apagou nada
});

test('toque longo abre o menu sem entrar na edição nem mover a caixa', async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'Toque real via CDP só no Chromium emulando celular');
  await openFromHome(page, 'text.pdf');
  await addText(page, 'Segurar');
  const box = boxes(page).first();
  const before = (await box.boundingBox())!;
  const x = before.x + before.width / 2, y = before.y + before.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 2, y: y + 1 }] }); // dedo nunca fica 100% parado
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('.tbox.editing')).toHaveCount(0);
  const after = (await box.boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(1);

  // Tocar fora fecha o menu
  await tapAt(page, 20, 140);
  await expect(menu(page)).toHaveCount(0);

  // Toque curto continua entrando na edição
  await page.touchscreen.tap(x, y);
  await expect(page.locator('.tbox.editing')).toHaveCount(1);
});

test('caixa em edição sobe para ficar acima do teclado virtual', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Teclado virtual só no celular');
  // Simula o teclado: a área visível (visualViewport) encolhe, a página não
  await page.addInitScript(() => {
    const fake = new EventTarget();
    const w = window as unknown as { __kb?: number };
    Object.defineProperties(fake, {
      offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 },
      width: { get: () => innerWidth }, height: { get: () => w.__kb ?? innerHeight },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
  });
  await openFromHome(page, 'flat-table.pdf');
  await addText(page, 'Embaixo', 0.3, 0.6);
  const box = boxes(page).first();
  const r = (await box.boundingBox())!;
  const keyboardTop = Math.round(r.y - 40); // o teclado cobre a caixa
  await tapAt(page, r.x + r.width / 2, r.y + r.height / 2);
  await expect(page.locator('.tbox.editing')).toHaveCount(1);
  await page.evaluate((h) => {
    (window as unknown as { __kb: number }).__kb = h;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  }, keyboardTop);
  await expect.poll(async () => { const b = (await box.boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(keyboardTop);
  await expect(page.locator('.tbox.editing')).toHaveCount(1); // continua digitando
});
