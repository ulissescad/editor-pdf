// Propriedades do documento (PLANO.md, item 2.13): título, autor, assunto, palavras-chave, aplicativo.
// Os leitores dão preferência aos metadados XMP quando existem; para que os valores novos valham em todo
// leitor, o XMP antigo (que repetiria os valores velhos) sai quando as propriedades são alteradas.
import { PDFDict, PDFHexString, PDFName, PDFString, type PDFDocument } from '@cantoo/pdf-lib';

export interface DocInfo {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;   // aplicativo que criou o documento original
  producer: string;  // aplicativo que gerou o PDF
  created?: Date;
  modified?: Date;
}

export const INFO_FIELDS = ['title', 'author', 'subject', 'keywords', 'creator', 'producer'] as const;
type Field = typeof INFO_FIELDS[number];

const KEYS: Record<Field, string> = {
  title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords', creator: 'Creator', producer: 'Producer',
};

function infoDict(doc: PDFDocument): PDFDict {
  return (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict();
}

function text(dict: PDFDict, key: string): string {
  const v = dict.lookup(PDFName.of(key));
  if (v instanceof PDFString || v instanceof PDFHexString) {
    try { return v.decodeText().replace(/\u0000/g, '').trim(); } catch { return ''; }
  }
  return '';
}

function date(get: () => Date | undefined): Date | undefined {
  try {
    const d = get();
    return d && !Number.isNaN(d.getTime()) ? d : undefined;
  } catch { return undefined; }
}

export function readInfo(doc: PDFDocument): DocInfo {
  const dict = infoDict(doc);
  const out = Object.fromEntries(INFO_FIELDS.map((f) => [f, text(dict, KEYS[f])])) as Record<Field, string>;
  return { ...out, created: date(() => doc.getCreationDate()), modified: date(() => doc.getModificationDate()) };
}

export const hasXmp = (doc: PDFDocument) => !!doc.catalog.get(PDFName.of('Metadata'));

/** Grava as propriedades (campos vazios são removidos) e marca a data de modificação. */
export function writeInfo(doc: PDFDocument, info: Pick<DocInfo, Field>) {
  const dict = infoDict(doc);
  for (const f of INFO_FIELDS) {
    const value = info[f].trim();
    if (value) dict.set(PDFName.of(KEYS[f]), PDFHexString.fromText(value));
    else dict.delete(PDFName.of(KEYS[f]));
  }
  doc.setModificationDate(new Date());
  doc.catalog.delete(PDFName.of('Metadata'));
}

/** Remove todas as propriedades e os metadados XMP. */
export function clearInfo(doc: PDFDocument) {
  const dict = infoDict(doc);
  for (const key of dict.keys()) dict.delete(key);
  doc.catalog.delete(PDFName.of('Metadata'));
}
