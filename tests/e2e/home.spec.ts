import { expect, test } from '@playwright/test';

test('página inicial mostra a abertura de PDF e as ferramentas', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Editor de PDF');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('sem enviar nada');
  await expect(page.getByRole('button', { name: 'Abrir PDF para editar' })).toBeVisible();
  await expect(page.locator('.grid .card')).toHaveCount(15);
});

test('layout não tem rolagem horizontal', async ({ page }) => {
  await page.goto('./');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('alvos de toque dos botões principais têm pelo menos 44 px', async ({ page }) => {
  await page.goto('./');
  const box = await page.getByRole('button', { name: 'Abrir PDF para editar' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test('ferramenta ainda não pronta abre a página “em breve” e volta ao início', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: /Juntar PDF/ }).click();
  await expect(page).toHaveURL(/#\/ferramenta\/juntar$/);
  await expect(page.getByRole('heading', { name: 'Juntar PDF' })).toBeVisible();
  await expect(page.getByText('em desenvolvimento')).toBeVisible();
  await page.getByRole('link', { name: 'Todas as ferramentas' }).click();
  await expect(page.locator('.grid .card')).toHaveCount(15);
});

test('rota de ferramenta funciona ao recarregar (GitHub Pages)', async ({ page }) => {
  await page.goto('./#/ferramenta/comprimir');
  await expect(page.getByRole('heading', { name: 'Comprimir PDF' })).toBeVisible();
});
