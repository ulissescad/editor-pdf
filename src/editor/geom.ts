// Geometria das páginas giradas (/Rotate) e dos objetos girados junto com elas.
//
// Os objetos guardam o retângulo no espaço do PDF (pt, origem no canto inferior esquerdo, y para cima):
// é o que o PDF entende e não muda quando a página é girada. Para mostrar e arrastar na tela usamos a
// “página como se vê” (vista): pt, origem no canto superior esquerdo, y para baixo, já com o giro aplicado.
//
// `rot` é a orientação do conteúdo do objeto: ele aparece em pé quando a página está girada `rot` graus.
// Objetos criados no editor recebem o giro da página; se a página for girada depois, o objeto gira junto.
import type { Rect } from './model';

export type Rotation = 0 | 90 | 180 | 270;

/** Normaliza qualquer ângulo múltiplo de 90 para 0, 90, 180 ou 270. */
export const normRot = (r: number): Rotation => ((((Math.round(r / 90) * 90) % 360) + 360) % 360) as Rotation;

/** Página: caixa visível no espaço do PDF [x0, y0, x1, y1] e giro (/Rotate, no sentido horário). */
export interface PageGeo { view: number[]; rotate: number }

/** Retângulo na página vista: pt, origem no canto superior esquerdo, y para baixo. */
export interface VRect { x: number; y: number; w: number; h: number }

export const A4: PageGeo = { view: [0, 0, 595, 842], rotate: 0 };

/** Largura e altura da página como se vê. */
export function viewSize({ view, rotate }: PageGeo): [number, number] {
  const w = view[2] - view[0], h = view[3] - view[1];
  return normRot(rotate) % 180 ? [h, w] : [w, h];
}

/** Ponto do PDF → ponto da página vista. */
export function userToView(px: number, py: number, { view, rotate }: PageGeo): [number, number] {
  const [x0, y0, x1, y1] = view;
  switch (normRot(rotate)) {
    case 90: return [py - y0, px - x0];
    case 180: return [x1 - px, py - y0];
    case 270: return [y1 - py, x1 - px];
    default: return [px - x0, y1 - py];
  }
}

/** Ponto da página vista → ponto do PDF. */
export function viewToUser(vx: number, vy: number, { view, rotate }: PageGeo): [number, number] {
  const [x0, y0, x1, y1] = view;
  switch (normRot(rotate)) {
    case 90: return [vy + x0, vx + y0];
    case 180: return [x1 - vx, vy + y0];
    case 270: return [x1 - vy, y1 - vx];
    default: return [vx + x0, y1 - vy];
  }
}

/** Retângulo do PDF (x, y = canto superior esquerdo) → retângulo na página vista. */
export function toView(r: Rect, g: PageGeo): VRect {
  const [ax, ay] = userToView(r.x, r.y - r.h, g);
  const [bx, by] = userToView(r.x + r.w, r.y, g);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Retângulo na página vista → retângulo do PDF. */
export function fromView(v: VRect, g: PageGeo): Rect {
  const [ax, ay] = viewToUser(v.x, v.y, g);
  const [bx, by] = viewToUser(v.x + v.w, v.y + v.h, g);
  return { x: Math.min(ax, bx), y: Math.max(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Quanto o conteúdo do objeto aparece girado na tela (horário): giro da página − orientação do objeto. */
export const turnOf = (rot: number | undefined, pageRotate: number): Rotation => normRot(pageRotate - (rot ?? 0));

/** Largura e altura do próprio conteúdo (sem giro), a partir do retângulo no PDF. */
export function localSize(rect: Rect, rot: number | undefined): { w: number; h: number } {
  return normRot(rot ?? 0) % 180 ? { w: rect.h, h: rect.w } : { w: rect.w, h: rect.h };
}

/**
 * Matriz [a b c d e f] do PDF que leva o quadro do conteúdo (origem no canto inferior esquerdo,
 * largura × altura locais) para o retângulo do objeto, girando `rot` graus no sentido anti-horário.
 * (e, f) é onde fica a origem do conteúdo: o mesmo ponto que o pdf-lib usa nos campos girados.
 */
export function contentMatrix(rect: Rect, rot: number | undefined): [number, number, number, number, number, number] {
  const { w, h } = localSize(rect, rot);
  const x0 = rect.x, y0 = rect.y - rect.h;
  switch (normRot(rot ?? 0)) {
    case 90: return [0, 1, -1, 0, x0 + h, y0];
    case 180: return [-1, 0, 0, -1, x0 + w, y0 + h];
    case 270: return [0, -1, 1, 0, x0, y0 + w];
    default: return [1, 0, 0, 1, x0, y0];
  }
}

/** Mantém o retângulo dentro da página vista de tamanho [w, h]. */
export function clampView(r: VRect, [pw, ph]: [number, number]): VRect {
  const w = Math.min(r.w, pw), h = Math.min(r.h, ph);
  return { w, h, x: Math.min(Math.max(r.x, 0), pw - w), y: Math.min(Math.max(r.y, 0), ph - h) };
}
