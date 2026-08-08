import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cada página tiene **un título de primer nivel** (US-266).
 *
 * De las 21 páginas, 18 titulaban con un `<h2>` colgando de nada y `/inventory`
 * no tenía **ningún** encabezado. Para quien navega con lector de pantalla eso
 * no es un detalle de marcado: el atajo «ir al encabezado principal» no lleva a
 * ninguna parte y no hay forma de saber en qué sección se está sin releer el
 * menú entero. Y no lo cazaba nadie, porque un `<h2>` con la clase del tamaño
 * correcto se **ve** exactamente igual que un `<h1>`.
 *
 * Este gate es **estático** a propósito: mira el fuente, así que cubre las 21
 * páginas y caza la siguiente que se añada, sin montar cada una con sus datos.
 *
 * ⚠️ Y por eso **no** comprueba el ORDEN de los encabezados: en el fuente, un
 * subcomponente declarado antes del componente de página pone su `<h3>` primero
 * sin que en pantalla salga antes de nada (pasa en `PeoplePage`). El orden y el
 * «exactamente uno» son propiedades del documento renderizado, y las asevera la
 * suite de navegador: `e2e/stacks` cuenta los `<h1>` de las 19 páginas del admin
 * y axe aplica `heading-order` en `e2e/tests/a11y.spec.ts`. Los dos juntos,
 * ninguno solo.
 */

// Igual que `tailwind-palette.test.ts`: vitest corre con el cwd del paquete.
const DIR_PAGINAS = join(process.cwd(), 'src', 'pages');

const paginas = readdirSync(DIR_PAGINAS)
  .filter((f) => f.endsWith('Page.tsx'))
  .map((f) => ({ nombre: f, fuente: readFileSync(join(DIR_PAGINAS, f), 'utf8') }));

describe('jerarquía de encabezados de las páginas (US-266)', () => {
  it('encuentra las páginas: si el glob se rompe, este gate no pasa en vacío', () => {
    // Sin este guard, un cambio de ruta dejaría la lista a cero y las
    // aserciones de abajo pasarían sin haber mirado un solo fichero.
    expect(paginas.length).toBeGreaterThan(15);
  });

  it.each(paginas.map((p) => p.nombre))('«%s» declara un <h1>', (nombre) => {
    const pagina = paginas.find((p) => p.nombre === nombre)!;
    expect(pagina.fuente).toMatch(/<h1[\s>]/);
  });

  it('ninguna página vuelve a titularse con el <h2> del tamaño de un título', () => {
    // La forma exacta que tenían las 18: se ve igual que un `<h1>` y por eso
    // sobrevivió a todas las revisiones visuales.
    const reincidentes = paginas
      .filter((p) => /<h2\s+className="(?:text-xl font-semibold|text-kr-xl font-semibold)/.test(p.fuente))
      .map((p) => p.nombre);
    expect(reincidentes).toEqual([]);
  });
});
