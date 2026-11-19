// Digitalizar (PLANO.md, item 2.14): endireitar a foto de um documento a partir dos 4 cantos marcados à mão
// e limpar a imagem. Só matemática (homografia e filtros por regras), sem detecção por IA (R2).
// Funções puras sobre pixels RGBA, testadas em tests/unit; o canvas fica em scan.ts.

export type Pt = [number, number];
/** Cantos do documento na foto, nesta ordem: superior esquerdo, superior direito, inferior direito, inferior esquerdo. */
export type Quad = [Pt, Pt, Pt, Pt];
export interface Raster { data: Uint8ClampedArray; width: number; height: number }

export type ScanFilter = 'doc' | 'color' | 'gray' | 'bw';
export type PageFormat = 'auto' | 'a4' | 'letter';
export type Turn = 0 | 1 | 2 | 3;

const A4_PT: Pt = [595.28, 841.89];
const LETTER_PT: Pt = [612, 792];
const ratioOf = ([w, h]: Pt) => h / w;

export const makeRaster = (width: number, height: number): Raster =>
  ({ data: new Uint8ClampedArray(width * height * 4), width, height });

/** Quadro inicial: a foto inteira, com uma pequena folga nas bordas. */
export function defaultQuad(w: number, h: number, inset = 0.06): Quad {
  const dx = w * inset, dy = h * inset;
  return [[dx, dy], [w - dx, dy], [w - dx, h - dy], [dx, h - dy]];
}

const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** O quadro é um quadrilátero convexo, com área de verdade? (cantos cruzados não formam um documento) */
export function isValidQuad(q: Quad, minArea = 1): boolean {
  const turns = q.map((_, i) => cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]));
  const convex = turns.every((t) => t > 0) || turns.every((t) => t < 0);
  if (!convex) return false;
  let area = 0;
  q.forEach((p, i) => { const n = q[(i + 1) % 4]; area += p[0] * n[1] - n[0] * p[1]; });
  return Math.abs(area) / 2 >= minArea;
}

/** Resolve A·x = b (eliminação de Gauss com pivô parcial). Devolve null se o sistema for singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Homografia que leva os 4 pontos `from` aos 4 pontos `to` (9 coeficientes, o último = 1). */
export function homography(from: Quad, to: Quad): number[] | null {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function project(H: number[], [x, y]: Pt): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Largura ÷ altura pela média dos lados opostos (sem levar a perspectiva em conta). */
function edgeAspect(q: Quad): number {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return w / Math.max(h, 1e-6);
}

type V3 = [number, number, number];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Proporção real (largura ÷ altura) do retângulo fotografado, recuperada da perspectiva
 * (Zhang & He, “Whiteboard scanning”), supondo o centro da foto no eixo da câmera.
 * Se a conta não fizer sentido físico, fica com a média dos lados.
 */
export function estimateAspect(q: Quad, imgW: number, imgH: number): number {
  const fallback = edgeAspect(q);
  const m = q.map(([x, y]): V3 => [x - imgW / 2, y - imgH / 2, 1]);
  const [m1, m2, m4, m3] = m; // na notação do artigo: m1 m2 em cima, m3 m4 embaixo
  const k2 = dot3(cross3(m1, m4), m3) / dot3(cross3(m2, m4), m3);
  const k3 = dot3(cross3(m1, m4), m2) / dot3(cross3(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3)) return fallback;
  // Lados praticamente paralelos: a foto está de frente e não há perspectiva para medir
  if (Math.abs(k2 - 1) < 0.02 && Math.abs(k3 - 1) < 0.02) return fallback;
  const n2: V3 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1];
  const n3: V3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  // A distância focal só pode ser medida com inclinação nos dois eixos, e tem de ser a de uma câmera de
  // verdade (da ordem do lado maior da foto). Inclinando num eixo só (o caso comum), vale a de um celular.
  const side = Math.max(imgW, imgH);
  let f2 = (0.8 * side) ** 2;
  if (Math.abs(n2[2]) > 0.02 && Math.abs(n3[2]) > 0.02) {
    const measured = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (measured > (0.3 * side) ** 2 && measured < (5 * side) ** 2) f2 = measured;
  }
  const norm = (n: V3) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  const r = Math.sqrt(norm(n2) / norm(n3));
  // Cantos marcados com pouca precisão podem dar valores absurdos
  return Number.isFinite(r) && r > fallback * 0.65 && r < fallback / 0.65 ? r : fallback;
}

export interface ScanSize { width: number; height: number; page: Pt }

/**
 * Tamanho da imagem final (px) e da página (pt).
 * - a4/letter: a folha fotografada ocupa a página inteira, em pé ou deitada conforme a foto;
 * - auto: usa a proporção medida, e encaixa em A4 ou Carta quando é praticamente igual a uma delas.
 */
export function scanSize(q: Quad, imgW: number, imgH: number, format: PageFormat, maxSide = 2400): ScanSize {
  const aspect = estimateAspect(q, imgW, imgH);
  const landscape = aspect > 1;
  const long = landscape ? aspect : 1 / aspect; // lado maior ÷ lado menor
  let sheet: Pt | null = format === 'a4' ? A4_PT : format === 'letter' ? LETTER_PT : null;
  if (format === 'auto') {
    if (Math.abs(long / ratioOf(A4_PT) - 1) < 0.04) sheet = A4_PT;
    else if (Math.abs(long / ratioOf(LETTER_PT) - 1) < 0.04) sheet = LETTER_PT;
  }
  const ratio = sheet ? ratioOf(sheet) : long;
  // Sem folha conhecida, o lado maior fica com a altura de um A4
  const [shortPt, longPt]: Pt = sheet ?? [A4_PT[1] / ratio, A4_PT[1]];
  // Resolução: a mesma que o documento tem na foto (sem inventar pixels), dentro dos limites
  const edges = q.map((p, i) => dist(p, q[(i + 1) % 4]));
  const longPx = Math.round(Math.min(maxSide, Math.max(320, ...edges)));
  const shortPx = Math.max(1, Math.round(longPx / ratio));
  return landscape
    ? { width: longPx, height: shortPx, page: [longPt, shortPt] }
    : { width: shortPx, height: longPx, page: [shortPt, longPt] };
}

/** Endireita o quadro `q` de `src` numa imagem width × height (mapeamento inverso, interpolação bilinear). */
export function warpPerspective(src: Raster, q: Quad, width: number, height: number): Raster {
  const out = makeRaster(width, height);
  const H = homography([[0, 0], [width, 0], [width, height], [0, height]], q);
  if (!H) throw new Error('Cantos inválidos');
  const [a, b, c, d, e, f, g, h] = H;
  const { data: s, width: sw, height: sh } = src;
  const o = out.data;
  const maxX = sw - 1, maxY = sh - 1;
  let p = 0;
  for (let v = 0; v < height; v++) {
    const yy = v + 0.5;
    for (let u = 0; u < width; u++, p += 4) {
      const xx = u + 0.5;
      const w = g * xx + h * yy + 1;
      // −0,5: o centro do pixel i está em i + 0,5
      let x = (a * xx + b * yy + c) / w - 0.5;
      let y = (d * xx + e * yy + f) / w - 0.5;
      x = x < 0 ? 0 : x > maxX ? maxX : x;
      y = y < 0 ? 0 : y > maxY ? maxY : y;
      const x0 = x | 0, y0 = y | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = s[i00 + k] + (s[i10 + k] - s[i00 + k]) * fx;
        const bottom = s[i01 + k] + (s[i11 + k] - s[i01 + k]) * fx;
        o[p + k] = top + (bottom - top) * fy + 0.5;
      }
      o[p + 3] = 255;
    }
  }
  return out;
}

/** Gira a imagem em quartos de volta, no sentido horário. */
export function rotateRaster(src: Raster, turn: Turn): Raster {
  if (!turn) return src;
  const { width: w, height: h, data: s } = src;
  const out = turn === 2 ? makeRaster(w, h) : makeRaster(h, w);
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [nx, ny] = turn === 1 ? [h - 1 - y, x] : turn === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const from = (y * w + x) * 4, to = (ny * out.width + nx) * 4;
      o[to] = s[from]; o[to + 1] = s[from + 1]; o[to + 2] = s[from + 2]; o[to + 3] = s[from + 3];
    }
  }
  return out;
}

const luma = (d: Uint8ClampedArray, i: number) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

/**
 * Brilho do papel em cada região: o tom claro (percentil 90) de cada bloco, suavizado.
 * Assim a sombra da mão e a luz desigual somem sem depender do conteúdo escuro (texto).
 * Devolve uma função que dá o brilho do papel no pixel (x, y).
 */
function paperLight({ data, width, height }: Raster) {
  const cell = Math.max(8, Math.round(Math.min(width, height) / 24));
  const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
  let grid = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      const x1 = Math.min(width, (gx + 1) * cell), y1 = Math.min(height, (gy + 1) * cell);
      let n = 0;
      // Basta uma amostra dos pixels de cada bloco
      for (let y = gy * cell; y < y1; y += 2) {
        for (let x = gx * cell; x < x1; x += 2) { hist[luma(data, (y * width + x) * 4) | 0]++; n++; }
      }
      let need = n * 0.1, v = 255;
      while (v > 0 && need > 0) need -= hist[v--];
      grid[gy * gw + gx] = Math.max(v, 24);
    }
  }
  // Duas passadas de média 3×3 para não marcar a grade na imagem
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let sum = 0, n = 0;
        for (let j = Math.max(0, y - 1); j <= Math.min(gh - 1, y + 1); j++) {
          for (let i = Math.max(0, x - 1); i <= Math.min(gw - 1, x + 1); i++) { sum += grid[j * gw + i]; n++; }
        }
        next[y * gw + x] = sum / n;
      }
    }
    grid = next;
  }
  return (x: number, y: number) => {
    const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx;
    const bottom = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

/** Curva do filtro “documento”: papel vira branco, tinta escurece e os tons do meio ganham contraste. */
const levels = (v: number) => {
  const t = Math.max(0, Math.min(1, (v - 0.3) / 0.58));
  return t * t * (3 - 2 * t) * 255;
};

/** Aplica o filtro (altera os pixels de `img`). */
export function applyFilter(img: Raster, filter: ScanFilter): Raster {
  if (filter === 'color') return img;
  const { data: d, width: w, height: h } = img;
  if (filter === 'gray') {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d, i) + 0.5;
    return img;
  }
  const light = paperLight(img);
  if (filter === 'doc') {
    // Mantém as cores (carimbos, canetas), corrigindo só a iluminação
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        const k = 1 / light(x, y);
        d[i] = levels(d[i] * k); d[i + 1] = levels(d[i + 1] * k); d[i + 2] = levels(d[i + 2] * k);
      }
    }
    return img;
  }
  // Preto e branco: limiar sobre a imagem já sem sombras, com borda suave para o texto não serrilhar
  const norm = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0, i = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4, p++) {
      const n = Math.min(255, (luma(d, i) / light(x, y)) * 255) | 0;
      norm[p] = n;
      hist[n]++;
    }
  }
  // Numa página quase vazia o limiar automático cairia no ruído do papel: fica dentro de uma faixa segura
  const t = Math.max(140, Math.min(205, otsuLevel(hist, norm.length)));
  for (let p = 0, i = 0; p < norm.length; p++, i += 4) {
    d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(1, (norm[p] - t) / 24 + 0.5)) * 255;
  }
  return img;
}

/** Limiar de Otsu: separa o histograma em duas classes (tinta e papel). */
export function otsuLevel(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, level = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; level = t; }
  }
  return level;
}
