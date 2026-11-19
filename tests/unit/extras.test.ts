// M6 · Opcionais: digitalizar (perspectiva e filtros), comparar (palavras e diff) e arquivos recebidos.
import { describe, expect, it } from 'vitest';
import {
  applyFilter, defaultQuad, estimateAspect, homography, isValidQuad, makeRaster, project, rotateRaster, scanSize,
  warpPerspective, type Pt, type Quad, type Raster,
} from '../../src/pdf/perspective.ts';
import { compareWords, diffKeys, joinWords, pageWords, wordKey, wordRects, type Hunk } from '../../src/pdf/textdiff.ts';
import type { TextRun } from '../../src/editor/textsel.ts';
import { planIncoming } from '../../src/lib/incoming.ts';
import { parseHash, hrefFor } from '../../src/lib/routes.ts';
import { imageLayout } from '../../src/pdf/pages.ts';

// ---------------------------------------------------------------- perspectiva

/** Foto simulada: retângulo w×h no espaço, girado, visto por uma câmera de distância focal f. */
function photographed(w: number, h: number, imgW: number, imgH: number, f: number, rx: number, ry: number, z: number): Quad {
  const [cx, sx, cy, sy] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry)];
  const corners: Pt[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return corners.map(([x, y]) => {
    const y1 = y * cx, z1 = y * sx;
    const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy + z;
    return [imgW / 2 + (f * x2) / z2, imgH / 2 + (f * y1) / z2];
  }) as Quad;
}

const pixel = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

function fill(r: Raster, color: (x: number, y: number) => [number, number, number]) {
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const [a, b, c] = color(x, y);
      r.data[i] = a; r.data[i + 1] = b; r.data[i + 2] = c; r.data[i + 3] = 255;
    }
  }
  return r;
}

describe('homografia', () => {
  const from: Quad = [[0, 0], [100, 0], [100, 140], [0, 140]];
  const to: Quad = [[12, 30], [210, 8], [240, 300], [4, 280]];

  it('leva cada canto ao seu destino e volta', () => {
    const H = homography(from, to)!, I = homography(to, from)!;
    from.forEach((p, i) => {
      const q = project(H, p);
      expect(q[0]).toBeCloseTo(to[i][0], 6);
      expect(q[1]).toBeCloseTo(to[i][1], 6);
    });
    const back = project(I, project(H, [37, 91]));
    expect(back[0]).toBeCloseTo(37, 6);
    expect(back[1]).toBeCloseTo(91, 6);
  });

  it('recusa pontos degenerados', () => {
    expect(homography(from, [[0, 0], [0, 0], [0, 0], [0, 0]])).toBeNull();
  });

  it('reconhece quadros válidos e cantos cruzados', () => {
    expect(isValidQuad(to)).toBe(true);
    expect(isValidQuad(defaultQuad(100, 100))).toBe(true);
    expect(isValidQuad([[0, 0], [100, 100], [100, 0], [0, 100]])).toBe(false);          // gravata-borboleta
    expect(isValidQuad([[0, 0], [100, 0], [20, 20], [0, 100]])).toBe(false);            // côncavo
    expect(isValidQuad([[0, 0], [1, 0], [1, 1], [0, 1]], 50)).toBe(false);              // pequeno demais
  });
});

describe('proporção do documento', () => {
  const [W, H, F] = [3000, 4000, 3300];

  it.each([[0.5, 0.15], [-0.45, 0.3], [0.3, -0.4]])('recupera A4 fotografado inclinado (%f, %f)', (rx, ry) => {
    const q = photographed(210, 297, W, H, F, rx, ry, 420);
    expect(estimateAspect(q, W, H)).toBeCloseTo(210 / 297, 2);
  });

  it('fica melhor que a média dos lados numa foto bem inclinada', () => {
    const q = photographed(100, 100, W, H, F, 0.7, 0, 200);
    const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const naive = (d(q[0], q[1]) + d(q[3], q[2])) / (d(q[0], q[3]) + d(q[1], q[2]));
    expect(Math.abs(estimateAspect(q, W, H) - 1)).toBeLessThan(Math.abs(naive - 1) / 3);
  });

  it('foto de frente usa a medida direta', () => {
    expect(estimateAspect([[100, 100], [500, 100], [500, 900], [100, 900]], 600, 1000)).toBeCloseTo(0.5, 6);
  });

  it('encaixa em A4 e Carta quando a proporção é quase igual', () => {
    const a4 = photographed(210, 297, W, H, F, 0.3, 0.1, 420);
    expect(scanSize(a4, W, H, 'auto').page[0]).toBeCloseTo(595.28, 1);
    const letter = photographed(216, 279, W, H, F, 0.3, 0.1, 420);
    expect(scanSize(letter, W, H, 'auto').page).toEqual([612, 792]);
  });

  it('mantém a proporção de documentos de outro formato (nota fiscal, cartão)', () => {
    const s = scanSize([[100, 100], [500, 100], [500, 1500], [100, 1500]], 600, 1600, 'auto');
    expect(s.page[1]).toBeCloseTo(841.89, 1);
    expect(s.page[0] / s.page[1]).toBeCloseTo(400 / 1400, 2);
    expect(s.width / s.height).toBeCloseTo(400 / 1400, 2);
  });

  it('documento deitado sai deitado, e o formato escolhido manda na página', () => {
    const wide = scanSize([[50, 100], [950, 100], [950, 700], [50, 700]], 1000, 800, 'a4');
    expect(wide.page[0]).toBeCloseTo(841.89, 1);
    expect(wide.width).toBeGreaterThan(wide.height);
    expect(wide.width / wide.height).toBeCloseTo(841.89 / 595.28, 2);
  });

  it('não passa do limite de pixels', () => {
    const s = scanSize([[0, 0], [5000, 0], [5000, 7000], [0, 7000]], 5000, 7000, 'a4', 2400);
    expect(Math.max(s.width, s.height)).toBe(2400);
  });
});

describe('endireitar a imagem', () => {
  it('recupera o conteúdo de um quadro inclinado', () => {
    const out = { w: 200, h: 280 };
    const q: Quad = [[60, 40], [340, 80], [370, 460], [30, 430]];
    // A “foto”: fundo preto; dentro do quadro, metade de cima vermelha e metade de baixo azul
    const toFlat = homography(q, [[0, 0], [out.w, 0], [out.w, out.h], [0, out.h]])!;
    const photo = fill(makeRaster(400, 500), (x, y) => {
      const [u, v] = project(toFlat, [x + 0.5, y + 0.5]);
      if (u < 0 || v < 0 || u > out.w || v > out.h) return [0, 0, 0];
      return v < out.h / 2 ? [220, 30, 30] : [30, 30, 220];
    });
    const flat = warpPerspective(photo, q, out.w, out.h);
    expect([flat.width, flat.height]).toEqual([out.w, out.h]);
    for (const [x, y] of [[8, 8], [190, 8], [100, 60], [10, 130]]) expect(pixel(flat, x, y)[0]).toBeGreaterThan(180);
    for (const [x, y] of [[8, 270], [190, 270], [100, 220], [190, 150]]) expect(pixel(flat, x, y)[2]).toBeGreaterThan(180);
    // Nenhum pixel do fundo preto entra no resultado
    let dark = 0;
    for (let i = 0; i < flat.data.length; i += 4) if (flat.data[i] + flat.data[i + 1] + flat.data[i + 2] < 120) dark++;
    expect(dark).toBe(0);
  });

  it('gira em quartos de volta', () => {
    const r = fill(makeRaster(3, 2), (x, y) => [x * 50, y * 50, 0]);
    const right = rotateRaster(r, 1);
    expect([right.width, right.height]).toEqual([2, 3]);
    expect(pixel(right, 1, 0)).toEqual(pixel(r, 0, 0));  // canto superior esquerdo → superior direito
    expect(pixel(rotateRaster(r, 2), 2, 1)).toEqual(pixel(r, 0, 0));
    expect(pixel(rotateRaster(r, 3), 0, 2)).toEqual(pixel(r, 0, 0));
    expect(rotateRaster(r, 0)).toBe(r);
  });
});

describe('filtros', () => {
  /** Página com sombra forte à direita e “texto” escuro em duas colunas (uma na luz, outra na sombra). */
  const shaded = () => fill(makeRaster(400, 300), (x, y) => {
    const light = 235 - (x / 400) * 130;
    const ink = y % 20 < 4 && (x % 200) > 40 && (x % 200) < 160;
    const v = ink ? light * 0.2 : light;
    return [v, v * 0.97, v * 0.92];
  });

  it('“Documento” deixa o papel branco mesmo na sombra e mantém o texto escuro', () => {
    const r = applyFilter(shaded(), 'doc');
    expect(pixel(r, 20, 10)[0]).toBeGreaterThan(240);   // papel na luz
    expect(pixel(r, 380, 10)[0]).toBeGreaterThan(240);  // papel na sombra
    expect(pixel(r, 100, 2)[0]).toBeLessThan(40);       // texto na luz
    expect(pixel(r, 300, 2)[0]).toBeLessThan(40);       // texto na sombra
  });

  it('“Documento” preserva as cores (carimbo azul continua azul)', () => {
    const r = applyFilter(fill(makeRaster(200, 200), (x, y) => (x > 80 && x < 110 && y > 80 && y < 110 ? [40, 60, 190] : [225, 225, 220])), 'doc');
    const [red, , blue] = pixel(r, 95, 95);
    expect(blue - red).toBeGreaterThan(100);
  });

  it('“Preto e branco” separa texto e papel nas duas regiões', () => {
    const r = applyFilter(shaded(), 'bw');
    expect(pixel(r, 20, 10)).toEqual([255, 255, 255]);
    expect(pixel(r, 380, 10)).toEqual([255, 255, 255]);
    expect(pixel(r, 100, 2)).toEqual([0, 0, 0]);
    expect(pixel(r, 300, 2)).toEqual([0, 0, 0]);
  });

  it('página em branco continua branca (sem ruído virando sujeira)', () => {
    const r = applyFilter(fill(makeRaster(120, 120), (x, y) => { const v = 214 + ((x * 7 + y * 13) % 5); return [v, v, v]; }), 'bw');
    let black = 0;
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i] < 128) black++;
    expect(black).toBe(0);
  });

  it('“Cinza” iguala os canais e “Original” não mexe', () => {
    const g = applyFilter(fill(makeRaster(4, 4), () => [200, 100, 50]), 'gray');
    const [r, gg, b] = pixel(g, 1, 1);
    expect(r).toBe(gg);
    expect(gg).toBe(b);
    const o = fill(makeRaster(4, 4), () => [200, 100, 50]);
    expect(pixel(applyFilter(o, 'color'), 1, 1)).toEqual([200, 100, 50]);
  });

  it('a página digitalizada ocupa a folha inteira, sem margem', () => {
    expect(imageLayout({ w: 100, h: 140, page: [595, 842] }, { size: 'image', orientation: 'auto', margin: 20 }))
      .toEqual({ page: [595, 842], x: 0, y: 0, w: 595, h: 842 });
  });
});

// ---------------------------------------------------------------- comparar

const run = (str: string, x: number, y: number): TextRun =>
  ({ str, o: [x, y], dir: [1, 0], w: str.length * 6, asc: 9, desc: 3, rot: 0, family: 'sans-serif' });

/** Aplica as diferenças em `a`, usando os itens de `b`: o resultado tem de ser exatamente `b`. */
function apply(a: string[], b: string[], hunks: Hunk[]) {
  const out: string[] = [];
  let i = 0;
  for (const h of hunks) {
    out.push(...a.slice(i, h.a0), ...b.slice(h.b0, h.b1));
    i = h.a1;
  }
  return [...out, ...a.slice(i)];
}

function rng(seed: number) {
  return (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
}

describe('palavras da página', () => {
  const texts = (runs: TextRun[]) => pageWords(runs, 0).map((w) => w.text);

  it('mantém números, datas e palavras compostas inteiros e separa a pontuação', () => {
    expect(texts([run('Total: R$ 1.000,00 em 10/05/2026 (e-mail d’água).', 0, 700)]))
      .toEqual(['Total', ':', 'R', '$', '1.000,00', 'em', '10/05/2026', '(', 'e-mail', 'd’água', ')', '.']);
  });

  it('junta palavra hifenizada no fim da linha', () => {
    expect(texts([run('a compa-', 0, 700), run('ração final', 0, 686)])).toEqual(['a', 'comparação', 'final']);
  });

  it('não junta hífen de verdade antes de maiúscula ou número', () => {
    expect(texts([run('Lei-', 0, 700), run('Maria', 0, 686)])).toEqual(['Lei', '-', 'Maria']);
  });

  it('palavra quebrada marca as duas linhas', () => {
    const runs = [run('compa-', 10, 700), run('ração', 10, 686)];
    const rects = wordRects(pageWords(runs, 0), runs);
    expect(rects).toHaveLength(2);
    expect(rects[0].y).toBeGreaterThan(rects[1].y);
  });

  it('palavras vizinhas na mesma linha viram um retângulo', () => {
    const runs = [run('um dois três', 10, 700)];
    const rects = wordRects(pageWords(runs, 0), runs);
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBeCloseTo(10);
    expect(rects[0].w).toBeCloseTo(12 * 6);
  });

  it('variações de aspas e traços não são diferença; maiúsculas e acentos só com a opção', () => {
    expect(wordKey('d’água')).toBe(wordKey("d'água"));
    expect(wordKey('ﬁm')).toBe('fim');
    expect(wordKey('Ação')).not.toBe(wordKey('acao'));
    expect(wordKey('Ação', { ignoreCase: true })).toBe(wordKey('acao', { ignoreCase: true }));
  });
});

describe('diferenças', () => {
  const w = (s: string) => s.split(' ').filter(Boolean);

  it('acha troca, inserção e remoção', () => {
    expect(diffKeys(w('a b c d'), w('a x c d'))).toEqual([{ a0: 1, a1: 2, b0: 1, b1: 2 }]);
    expect(diffKeys(w('a b'), w('a n b'))).toEqual([{ a0: 1, a1: 1, b0: 1, b1: 2 }]);
    expect(diffKeys(w('a n b'), w('a b'))).toEqual([{ a0: 1, a1: 2, b0: 1, b1: 1 }]);
    expect(diffKeys(w('a b'), w('a b'))).toEqual([]);
    expect(diffKeys([], w('a'))).toEqual([{ a0: 0, a1: 0, b0: 0, b1: 1 }]);
  });

  it('junta trechos separados só por pontuação', () => {
    expect(diffKeys(['a', 'b', ',', 'c', 'd'], ['a', 'x', ',', 'y', 'd'])).toEqual([{ a0: 1, a1: 4, b0: 1, b1: 4 }]);
  });

  it('frase acrescentada começa na palavra, não no ponto da frase anterior', () => {
    const a = ['Fim', '.'], b = ['Fim', '.', 'Nova', 'frase', '.'];
    expect(diffKeys(a, b)).toEqual([{ a0: 2, a1: 2, b0: 2, b1: 5 }]);
    expect(diffKeys(b, a)).toEqual([{ a0: 2, a1: 5, b0: 2, b1: 2 }]);
  });

  it('palavras repetidas não atrapalham (sem palavra única para ancorar)', () => {
    const a = w('o o o a o o'), b = w('o o a o o o');
    expect(apply(a, b, diffKeys(a, b))).toEqual(b);
    expect(diffKeys(a, b).reduce((n, h) => n + (h.a1 - h.a0) + (h.b1 - h.b0), 0)).toBe(2);
  });

  it('sempre reconstrói a nova versão (sequências aleatórias)', () => {
    const r = rng(7);
    for (let t = 0; t < 300; t++) {
      const vocab = 2 + r(30);
      const a = Array.from({ length: r(80) }, () => `p${r(vocab)}`);
      const b = [...a];
      for (let e = r(12); e > 0; e--) {
        const at = r(b.length + 1);
        if (r(2)) b.splice(at, 0, `p${r(vocab)}`); else b.splice(at, 1 + r(3));
      }
      const hunks = diffKeys(a, b);
      expect(apply(a, b, hunks)).toEqual(b);
      hunks.forEach((h, i) => { if (i) expect(h.a0).toBeGreaterThan(hunks[i - 1].a1 - 1); });
    }
  });

  it('documento grande com poucas mudanças é rápido e preciso', () => {
    const r = rng(3);
    const a = Array.from({ length: 200_000 }, (_, i) => (i % 7 ? `w${r(4000)}` : 'de'));
    const b = [...a];
    b[1000] = 'trocada'; b.splice(90_000, 3); b.splice(150_000, 0, 'nova', 'frase');
    const t0 = performance.now();
    const hunks = diffKeys(a, b);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(hunks).toHaveLength(3);
    expect(apply(a, b, hunks)).toEqual(b);
  });

  it('textos sem nada em comum viram uma troca só, sem estourar a memória', () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `a${i % 50}`);
    const b = Array.from({ length: 50_000 }, (_, i) => `b${i % 50}`);
    expect(diffKeys(a, b)).toEqual([{ a0: 0, a1: 50_000, b0: 0, b1: 50_000 }]);
  });

  it('descreve cada mudança com página, texto e contexto', () => {
    const page = (n: number, s: string) => pageWords([run(s, 0, 700)], n);
    const a = [...page(0, 'O valor total é 1.000,00 reais.'), ...page(1, 'Fim do contrato antigo.')];
    const b = [...page(0, 'O valor total é 2.500,00 reais.'), ...page(1, 'Fim do contrato.')];
    const [first, second] = compareWords(a, b);
    expect(first).toMatchObject({ pageA: 0, pageB: 0, removed: '1.000,00', added: '2.500,00', before: 'O valor total é', after: 'reais. Fim do contrato.' });
    expect(second).toMatchObject({ pageA: 1, pageB: 1, removed: 'antigo', added: '' });
  });

  it('monta o texto sem espaço antes da pontuação', () => {
    expect(joinWords(['Olá', ',', '(', 'mundo', ')', '!'].map((text) => ({ text })))).toBe('Olá, (mundo)!');
  });

  it('mantém os espaços do documento', () => {
    expect(joinWords(pageWords([run('Paga R$ 10 (5%) hoje.', 0, 700)], 0))).toBe('Paga R$ 10 (5%) hoje.');
  });
});

// ---------------------------------------------------------------- arquivos recebidos

describe('arquivos recebidos de outros apps', () => {
  const pdf = (name: string, type = 'application/pdf') => ({ name, type, bytes: new TextEncoder().encode('%PDF-1.7') });
  const img = (name: string) => ({ name, type: 'image/jpeg', bytes: new Uint8Array([255, 216]) });

  it('um PDF abre no editor, mesmo sem extensão nem tipo', () => {
    expect(planIncoming([pdf('a.pdf')])).toMatchObject({ to: 'editor', file: { name: 'a.pdf' } });
    expect(planIncoming([pdf('documento', '')])).toMatchObject({ to: 'editor', file: { name: 'documento.pdf' } });
  });

  it('vários PDFs vão para Juntar, ignorando o que não é PDF', () => {
    const plan = planIncoming([pdf('a.pdf'), img('x.jpg'), pdf('b.pdf')]);
    expect(plan).toMatchObject({ to: 'tool', tool: 'juntar' });
    expect(plan.to === 'tool' && plan.files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('só imagens vão para Imagens para PDF', () => {
    expect(planIncoming([img('x.jpg'), img('y.jpg')])).toMatchObject({ to: 'tool', tool: 'imagens-para-pdf' });
  });

  it('outros arquivos não abrem nada', () => {
    expect(planIncoming([{ name: 'a.txt', type: 'text/plain', bytes: new Uint8Array(3) }])).toEqual({ to: 'nothing' });
    expect(planIncoming([])).toEqual({ to: 'nothing' });
  });

  it('tem rota própria', () => {
    expect(parseHash('#/recebido')).toEqual({ name: 'received' });
    expect(hrefFor({ name: 'received' })).toBe('#/recebido');
  });
});

// ---------------------------------------------------------------- celular: teclado e arquivos grandes

import { scrollToFit } from '../../src/editor/keyboard.ts';
import { BIG_FILE, bigFileNote } from '../../src/editor/session.ts';

describe('teclado virtual', () => {
  it('rola só o necessário para a caixa ficar acima do teclado', () => {
    expect(scrollToFit(100, 140, 0, 400)).toBe(0);            // já visível
    expect(scrollToFit(500, 540, 0, 400)).toBe(540 - 388);    // atrás do teclado: sobe até a margem
    expect(scrollToFit(-30, 10, 0, 400)).toBe(-42);           // acima da área: desce
  });

  it('caixa maior que a área visível mostra o começo', () => {
    expect(scrollToFit(300, 900, 0, 400)).toBe(288);
  });
});

describe('aviso de arquivo grande', () => {
  it('só no celular e só acima de 50 MB', () => {
    expect(bigFileNote(BIG_FILE - 1, true)).toBeNull();
    expect(bigFileNote(BIG_FILE * 2, false)).toBeNull();
    expect(bigFileNote(BIG_FILE * 2, true)).toContain('100 MB');
  });
});
