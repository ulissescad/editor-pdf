// Gera os PDFs de teste em tests/fixtures/generated/ (ignorados pelo git).
// Nenhum documento real é usado: tudo é sintético.
import { PDFDocument, StandardFonts, concatTransformationMatrix, degrees, popGraphicsState, pushGraphicsState, rgb } from '@cantoo/pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
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

/**
 * PDF parecido com um PEI exportado do Word, sem campos. A página 1 desenha as bordas como traços
 * (stroke); a página 2 repete o conteúdo com bordas em retângulos finos preenchidos e uma escala
 * (cm), como o Word faz. PEI_FIELDS lista os campos que a detecção deve encontrar em cada página.
 */
export const PEI_FIELDS = [
  { name: 'instituicao', x: 210, y: 740, w: 330, h: 22 },
  { name: 'estudante', x: 210, y: 718, w: 330, h: 22 },
  { name: 'data_elaboracao', x: 210, y: 696, w: 330, h: 22 },
  { name: 'professor', x: 210, y: 674, w: 330, h: 22 },
  { name: 'port_hab', x: 200, y: 590, w: 200, h: 24 },
  { name: 'port_aval', x: 400, y: 590, w: 145, h: 24 },
  { name: 'mat_hab', x: 200, y: 566, w: 200, h: 24 },
  { name: 'mat_aval', x: 400, y: 566, w: 145, h: 24 },
  { name: 'laudo_sim', x: 150, y: 520, w: 10, h: 10, check: true },
  { name: 'laudo_nao', x: 200, y: 520, w: 10, h: 10, check: true },
  { name: 'observacoes', x: 50, y: 470, w: 495, h: 90 },
  { name: 'cidade', x: 100, y: 345, w: 200, h: 16 },
  { name: 'responsavel', x: 130, y: 315, w: 140, h: 16 },
  { name: 'assinatura', x: 300, y: 245, w: 200, h: 16 },
];

export async function makePeiLike() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  for (const style of ['stroke', 'word']) {
    const page = doc.addPage([595, 842]);
    const k = style === 'word' ? 0.75 : 1; // página 2: desenha em “pixels” e escala com cm
    if (k !== 1) page.pushOperators(pushGraphicsState(), concatTransformationMatrix(k, 0, 0, k, 0, 0));
    const S = (v) => v / k;
    const box = (x, y, w, h) => {
      if (style === 'stroke') {
        page.drawRectangle({ x: S(x), y: S(y), width: S(w), height: S(h), borderColor: black, borderWidth: 0.8 / k });
      } else {
        const t = 0.5;
        for (const [rx, ry, rw, rh] of [[x, y, w, t], [x, y + h - t, w, t], [x, y, t, h], [x + w - t, y, t, h]]) {
          page.drawRectangle({ x: S(rx), y: S(ry), width: S(rw), height: S(rh), color: black });
        }
      }
    };
    const text = (s, x, y, size = 10, f = font, color = black) => page.drawText(s, { x: S(x), y: S(y), size: size / k, font: f, color });

    text('PLANO EDUCACIONAL INDIVIDUALIZADO', 160, 790, 14, bold);
    page.drawRectangle({ x: S(50), y: S(740), width: S(495), height: S(22), color: rgb(0.14, 0.34, 0.84) });
    text('01. DADOS DO ESTUDANTE', 56, 747, 11, bold, rgb(1, 1, 1));
    const labels = [['Nome Completo da Instituicao:', 740], ['Nome do Estudante:', 718], ['Data de Elaboracao:', 696], ['Professor(a) Regente:', 674]];
    for (const [label, top] of labels) { box(50, top - 22, 495, 22); text(label, 54, top - 15, 10); }
    // Tabela: cabeçalho + 2 linhas, primeira coluna preenchida
    const cols = [50, 200, 400, 545];
    const rows = [614, 590, 566, 542];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(cols[c], rows[r + 1], cols[c + 1] - cols[c], rows[r] - rows[r + 1]);
    text('Componente', 56, 598, 10, bold); text('Habilidade', 206, 598, 10, bold); text('Avaliacao', 406, 598, 10, bold);
    text('Portugues', 56, 574); text('Matematica', 56, 550);
    // Caixas de seleção
    text('Possui laudo?', 54, 512);
    box(150, 510, 10, 10); text('Sim', 164, 512);
    box(200, 510, 10, 10); text('Nao', 214, 512);
    // Caixa alta de observações com o rótulo no topo
    box(50, 380, 495, 110); text('Observacoes:', 54, 476, 10, bold);
    // Rótulos soltos
    text('Cidade:', 54, 333);
    text('Responsavel: ____________________________', 54, 303);
    // Linha de assinatura com o rótulo embaixo
    page.drawLine({ start: { x: S(300), y: S(228) }, end: { x: S(500), y: S(228) }, thickness: 0.8 / k, color: black });
    text('Assinatura do professor', 345, 216, 9);
    if (k !== 1) page.pushOperators(popGraphicsState());
  }
  return doc.save();
}

/** PNG simples (retângulo vermelho com borda transparente), gerado sem bibliotecas. */
export function makePng(w = 120, h = 60) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      const inside = x >= 10 && x < w - 10 && y >= 10 && y < h - 10;
      raw[i] = 200; raw[i + 1] = 30; raw[i + 2] = 30; raw[i + 3] = inside ? 255 : 0;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** PDF com páginas numeradas (“Pagina 1”…), para conferir ordem, giro e exclusão. A página 3 é paisagem. */
export async function makeNumbered(n = 5, label = 'Pagina') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage(i === 3 ? [842, 595] : [595, 842]);
    page.drawText(`${label} ${i}`, { x: 60, y: page.getHeight() - 100, size: 36, font });
  }
  return doc.save();
}

/** PDF com a página 1 girada 90° (/Rotate), como muitos PDFs “paisagem” e digitalizações. */
export async function makeRotated() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('Pagina girada', { x: 60, y: 760, size: 24, font });
  page.setRotation(degrees(90));
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Pagina normal', { x: 60, y: 760, size: 24, font });
  return doc.save();
}

/** PNG “paisagem” maior (para imagens → PDF). */
export const makeWidePng = () => makePng(300, 120);

export async function writeAll() {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(`${FIXTURES_DIR}form.pdf`, await makeForm());
  writeFileSync(`${FIXTURES_DIR}flat-table.pdf`, await makeFlatTable());
  writeFileSync(`${FIXTURES_DIR}pei-like.pdf`, await makePeiLike());
  writeFileSync(`${FIXTURES_DIR}image.png`, makePng());
  writeFileSync(`${FIXTURES_DIR}numbered.pdf`, await makeNumbered());
  writeFileSync(`${FIXTURES_DIR}letters.pdf`, await makeNumbered(2, 'Letra'));
  writeFileSync(`${FIXTURES_DIR}rotated.pdf`, await makeRotated());
  writeFileSync(`${FIXTURES_DIR}wide.png`, makeWidePng());
  return FIXTURES_DIR;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Fixtures geradas em', await writeAll());
}
