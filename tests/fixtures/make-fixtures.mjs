// Gera os PDFs de teste em tests/fixtures/generated/ (ignorados pelo git).
// Nenhum documento real é usado: tudo é sintético.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = fileURLToPath(new URL('./generated/', import.meta.url));

/** Formulário AcroForm: texto, caixa de seleção, lista e um campo somente leitura. */
export async function makeForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Formulario de teste', { x: 50, y: 790, size: 18, font });
  const form = doc.getForm();
  page.drawText('Nome:', { x: 50, y: 735, size: 12, font });
  form.createTextField('nome').addToPage(page, { x: 120, y: 725, width: 300, height: 24 });
  page.drawText('Aceito:', { x: 50, y: 690, size: 12, font });
  form.createCheckBox('aceito').addToPage(page, { x: 120, y: 685, width: 18, height: 18 });
  page.drawText('Turno:', { x: 50, y: 650, size: 12, font });
  const turno = form.createDropdown('turno');
  turno.addOptions(['Manha', 'Tarde', 'Noite']);
  turno.addToPage(page, { x: 120, y: 640, width: 150, height: 24 });
  const codigo = form.createTextField('codigo');
  codigo.setText('ABC-123');
  codigo.addToPage(page, { x: 120, y: 600, width: 150, height: 24 });
  codigo.enableReadOnly();
  return doc.save();
}

/** PDF "achatado" parecido com o PEI: tabela desenhada com rótulos, sem nenhum campo de formulário. */
export async function makeFlatTable() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText('PLANO DE TESTE - PAGINA ' + (p + 1), { x: 170, y: 790, size: 14, font: bold, color: rgb(0.14, 0.34, 0.84) });
    page.drawRectangle({ x: 50, y: 740, width: 495, height: 22, color: rgb(0.14, 0.34, 0.84) });
    page.drawText('01. DADOS DO ESTUDANTE', { x: 56, y: 747, size: 12, font: bold, color: rgb(1, 1, 1) });
    const labels = ['Nome Completo da Instituicao:', 'Nome/Nome Social:', 'Data de Elaboracao:', 'Professor(a) Regente:'];
    labels.forEach((label, i) => {
      const y = 718 - i * 22;
      page.drawRectangle({ x: 50, y, width: 495, height: 22, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      page.drawText(label, { x: 54, y: y + 6, size: 11, font });
    });
    page.drawRectangle({ x: 50, y: 520, width: 495, height: 110, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  }
  return doc.save();
}

export async function writeAll() {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(`${FIXTURES_DIR}form.pdf`, await makeForm());
  writeFileSync(`${FIXTURES_DIR}flat-table.pdf`, await makeFlatTable());
  return FIXTURES_DIR;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Fixtures geradas em', await writeAll());
}
