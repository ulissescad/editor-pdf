import { describe, expect, it } from 'vitest';
import { detectFields, extractGeometry, findCells, mergeRuns, overlap, type Suggestion } from '../../src/editor/detect.ts';
import { PEI_FIELDS, makeFlatTable, makePeiLike } from '../fixtures/make-fixtures.mjs';

async function suggestions(bytes: Uint8Array, pageNumber: number): Promise<Suggestion[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await pdf.getPage(pageNumber);
  const g = await extractGeometry(page as never, pdfjs.OPS as unknown as Record<string, number>);
  return detectFields(g);
}

const box = (r: { x: number; y: number; w: number; h: number }) => ({ x0: r.x, x1: r.x + r.w, y0: r.y - r.h, y1: r.y });

/** Quantos campos esperados foram encontrados (sugestão cobrindo a área esperada, do tipo certo). */
function score(found: Suggestion[]) {
  const hits = PEI_FIELDS.filter((f) => found.some((s) =>
    overlap(box(s.rect), box(f)) > 0.6 && (s.type === 'check') === !!(f as { check?: boolean }).check));
  return { hits: hits.length, missing: PEI_FIELDS.filter((f) => !hits.includes(f)).map((f) => f.name) };
}

describe('detecção de campos (sem formulário)', () => {
  it('junta pedaços de texto da mesma linha', () => {
    const runs = mergeRuns([
      { str: 'Nome', x0: 10, x1: 35, y: 100, size: 10 },
      { str: 'do aluno:', x0: 38, x1: 80, y: 100.2, size: 10 },
      { str: 'Outra linha', x0: 10, x1: 60, y: 80, size: 10 },
    ]);
    expect(runs.map((r) => r.str)).toEqual(['Nome do aluno:', 'Outra linha']);
  });

  it('encontra células de uma grade', () => {
    const H = [{ y: 100, x0: 0, x1: 200 }, { y: 80, x0: 0, x1: 200 }, { y: 60, x0: 0, x1: 200 }];
    const V = [{ x: 0, y0: 60, y1: 100 }, { x: 100, y0: 60, y1: 100 }, { x: 200, y0: 60, y1: 100 }];
    expect(findCells(H, V)).toHaveLength(4);
  });

  for (const [pageNumber, desc] of [[1, 'bordas traçadas'], [2, 'bordas do Word (retângulos finos + escala)']] as const) {
    it(`PEI de teste, ${desc}: acha pelo menos 80% dos campos, sem excesso`, async () => {
      const found = await suggestions(await makePeiLike(), pageNumber);
      const { hits, missing } = score(found);
      expect(missing, `faltaram: ${missing.join(', ')}`).toEqual([]);
      expect(hits / PEI_FIELDS.length).toBeGreaterThanOrEqual(0.8);
      expect(found.length).toBeLessThanOrEqual(PEI_FIELDS.length + 2); // poucos falsos positivos
      // Nenhuma sugestão cobre texto impresso (cabeçalhos, rótulos)
      expect(found.filter((s) => s.rect.y > 760)).toEqual([]);
    });
  }

  it('dá nomes a partir dos rótulos', async () => {
    const found = await suggestions(await makePeiLike(), 1);
    const names = found.map((s) => s.name);
    expect(names).toContain('nome_completo_da_instituicao');
    expect(names).toContain('observacoes');
    expect(names).toContain('sim');
    expect(names).toContain('responsavel');
  });

  it('PDF parecido com o PEI do M1: rótulos com espaço e caixa grande', async () => {
    const found = await suggestions(await makeFlatTable(), 1);
    expect(found.filter((s) => s.rule === 'A')).toHaveLength(4);
    expect(found.some((s) => s.rect.h > 100)).toBe(true); // a caixa grande vazia
  });
});
