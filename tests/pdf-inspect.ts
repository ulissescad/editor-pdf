// Inspeção de PDFs gerados, usada pelos testes unitários e de ponta a ponta.
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';

/** Nomes das fontes (BaseFont) usadas numa página, lidos da estrutura do PDF. */
export async function baseFonts(bytes: Uint8Array, pageIndex = 0): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const resources = doc.getPage(pageIndex).node.Resources();
  const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) return [];
  return fonts.keys().map((k) => {
    const f = fonts.lookup(k, PDFDict);
    return f.get(PDFName.of('BaseFont'))?.toString().replace(/^\//, '') ?? '';
  });
}
