import { expect, type Locator, type Page } from '@playwright/test';

/** Celular de referencia (390 px de ancho): lo que mide la tanda táctil. */
export const MOVIL = { width: 390, height: 844 };
/** El celular más estrecho que se soporta (320 px). */
export const MOVIL_ESTRECHO = { width: 320, height: 640 };

/** Mitad del área mínima de toque (44 px). */
const MEDIO = 21;

interface Punto {
  etiqueta: string;
  x: number;
  y: number;
}

/**
 * Comprueba que `target` se puede tocar con el pulgar: los cuatro puntos a ±21 px de su centro
 * (horizontal y vertical, es decir, dentro de un cuadrado de 44 px) caen en el propio elemento o
 * en un descendiente. Con `vecinos`, además, ninguno de esos puntos puede caer en uno de ellos:
 * dos áreas ampliadas que se pisan hacen que el toque llegue al control equivocado.
 *
 * Mide con `document.elementFromPoint`, no con `boundingBox`: el área ampliada es un `::before`
 * y no cuenta en la caja. Falla diciendo qué punto y qué elemento encontró.
 */
export async function expectTapTarget(
  page: Page,
  target: Locator,
  opts: { vecinos?: Locator[] } = {},
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const caja = await target.boundingBox();
  expect(caja, 'el control no tiene caja: no está en pantalla').not.toBeNull();
  const cx = caja!.x + caja!.width / 2;
  const cy = caja!.y + caja!.height / 2;
  const puntos: Punto[] = [
    { etiqueta: 'izquierda', x: cx - MEDIO, y: cy },
    { etiqueta: 'derecha', x: cx + MEDIO, y: cy },
    { etiqueta: 'arriba', x: cx, y: cy - MEDIO },
    { etiqueta: 'abajo', x: cx, y: cy + MEDIO },
  ];

  const vecinos = opts.vecinos ?? [];
  const manejas = await Promise.all([target, ...vecinos].map((l) => l.elementHandle()));
  const [handleTarget, ...handlesVecinos] = manejas;
  expect(handleTarget, 'el control no existe').not.toBeNull();

  const fallos: string[] = [];
  for (const p of puntos) {
    const res = await page.evaluate(
      ({ x, y, objetivo, otros }) => {
        const hallado = document.elementFromPoint(x, y);
        const describe = (el: Element | null) =>
          el
            ? `<${el.tagName.toLowerCase()}${el.className ? ` class="${String(el.className).slice(0, 60)}"` : ''}> «${(el.textContent ?? '').trim().slice(0, 24)}»`
            : 'nada (fuera de la ventana)';
        const enObjetivo = !!hallado && objetivo.contains(hallado);
        const enVecino = otros.findIndex((o) => !!hallado && o.contains(hallado));
        return { enObjetivo, enVecino, texto: describe(hallado) };
      },
      {
        x: p.x,
        y: p.y,
        objetivo: handleTarget!,
        otros: handlesVecinos.filter((h) => h !== null),
      },
    );
    if (res.enVecino >= 0)
      fallos.push(
        `${p.etiqueta} (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) cae en el vecino ${res.enVecino}: ${res.texto}`,
      );
    else if (!res.enObjetivo)
      fallos.push(`${p.etiqueta} (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) encontró ${res.texto}`);
  }
  expect(fallos, `área de toque de 44 px: ${fallos.join(' | ')}`).toEqual([]);
}
