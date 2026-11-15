// Capturas de tela para revisão visual (não fazem asserções). Rodar com:
//   SCREENS=1 npx playwright test screens
import { test } from '@playwright/test';
import { addText, openFromHome } from './helpers';

test.skip(!process.env.SCREENS, 'só quando SCREENS=1');

test('capturas do editor', async ({ page }, info) => {
  const shot = (name: string) => page.screenshot({ path: `test-results/screens/${info.project.name}-${name}.png` });
  await page.goto('./');
  await shot('1-inicio');
  await openFromHome(page, 'form.pdf');
  await page.waitForTimeout(500);
  await shot('2-editor');
  await page.locator('.annotationLayer input[type="text"]').first().fill('Maria da Silva');
  await addText(page, 'Observação importante sobre o estudante, com texto longo para quebrar linha.', 0.15, 0.45);
  await page.waitForTimeout(300);
  await shot('3-caixa-selecionada');
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  await page.waitForTimeout(200);
  await shot('4-modo-texto');
});
