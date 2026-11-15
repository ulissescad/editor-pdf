// Gera os PDFs sintéticos antes dos testes.
import { writeAll } from '../fixtures/make-fixtures.mjs';

export default async function globalSetup() {
  await writeAll();
}
