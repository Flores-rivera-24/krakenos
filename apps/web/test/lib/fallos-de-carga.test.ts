import { describe, expect, it } from 'vitest';
import { fuentes, sinComentarios } from './_fuentes';

/**
 * Gate: un fallo de carga no se traga ni se pinta como vacío.
 *
 * Un `.catch(() => setX([]))` convierte «no pude leerlo» en «no hay nada»: la
 * pantalla dice que el hogar no tiene reglas, aparatos o eventos cuando lo único
 * que pasó es que la petición falló. Es la mentira más barata de escribir y la
 * más difícil de ver, porque nada revienta.
 *
 * Detecta `.catch(` con una flecha que **no usa el error** y cuyo cuerpo es `{}`,
 * `undefined`, `null`, `[]` (con `as …` opcional) o una sola llamada
 * `setX(<[] | null | undefined | {} | false>)`. Tolera el formateador (la forma
 * puede ocupar varias líneas). Acepta una guarda delante de la llamada
 * (`active && setX([])`, `!cancelled && …`) y el cuerpo en bloque
 * (`{ setX([]); }`). Alcance: `components/` y `pages/`; en `lib/` y
 * `store/` son parseos de cuerpo y el logout, legítimos.
 *
 * Límites conocidos, que NO detecta: `.then(ok, () => setX([]))` y el
 * `try/catch`. Un fallo tragado por esas vías pasa este gate.
 *
 * Es un trinquete: lo que hoy incumple está en PENDIENTES con su cuenta, y cada
 * arreglo solo QUITA su fichero de ahí. Cuando PENDIENTES quede vacía, se borra.
 */

const FLECHA_SIN_ERROR = String.raw`\(\s*(?:_\w*)?\s*\)\s*=>\s*`;
const VACIO = String.raw`(?:\[\]|null|undefined|\{\s*\}|false)`;
const GUARDA = String.raw`(?:!?\w+\s*&&\s*)?`;
const LLAMADA = String.raw`${GUARDA}set\w+\(\s*${VACIO}\s*,?\s*\)`;
const CUERPO = String.raw`(?:\{\s*(?:${LLAMADA}\s*;?\s*)?\}|undefined|null|\[\]|${LLAMADA})`;
const COMO = String.raw`(?:\s+as\s+[\w<>\[\]. |]+?)?`;
const DETECTOR = new RegExp(
  String.raw`\.catch\(\s*${FLECHA_SIN_ERROR}${CUERPO}${COMO}\s*,?\s*\)`,
  'g',
);

/** Cuántas veces un fuente (ya sin comentarios) traga o degrada un fallo. */
export function tragaODegrada(codigo: string): number {
  return (codigo.match(DETECTOR) ?? []).length;
}

/** Fichero → porqué es legítimo. Sin motivo escrito no entra. */
const EXCEPCIONES: Record<string, { cuantas: number; porque: string }> = {
  'pages/LoginPage.tsx': {
    cuantas: 1,
    porque: 'si `/setup/status` falla, quedarse en el login es lo correcto; no hay nada que pintar',
  },
  'components/cameras/CameraLivePlayer.tsx': {
    cuantas: 3,
    porque:
      '`video.play()` rechazado por la política de autoplay y `stopStream` de cortesía al desmontar; ninguno es una lectura',
  },
  'components/dashboard/GettingStarted.tsx': {
    cuantas: 1,
    porque: 'si falla, los pasos salen sin marcar y se siguen ofreciendo; no oculta nada',
  },
};

/**
 * Fichero → coincidencias que quedan por arreglar. Cada arreglo QUITA su
 * fichero de aquí (nunca lo sube); al quedar vacía, se borra el trinquete.
 */
const PENDIENTES: Record<string, number> = {
  'components/inventory/DeviceDetailSlideover.tsx': 4,
  'components/wifi/NetworksCard.tsx': 1,
  'pages/AutomationsPage.tsx': 7,
  'pages/CamerasPage.tsx': 1,
  'pages/EnergyPage.tsx': 1,
  'pages/IotPage.tsx': 1,
};

describe('fallos de carga que se tragan', () => {
  it('detecta las formas que el formateador produce', () => {
    for (const forma of [
      '.catch(() => undefined)',
      '.catch(() => {})',
      '.catch(() => setRules([]))',
      '.catch(() => [] as PresenceEvent[])',
      '.catch(\n  () =>\n    setX(null),\n)',
      '.catch(() => active && setPeople([]))',
      '.catch(() => ok && setX(null))',
      '.catch(() => !cancelled && setX([]))',
      '.catch(() => { setX([]); })',
      '.catch(() => {\n  setX([])\n})',
    ]) {
      expect(tragaODegrada(forma), forma).toBe(1);
    }
    for (const forma of [
      '.catch((err) => setError(describeError(err)))',
      '.catch(() => setFailed(true))',
      '// .catch(() => setX([]))',
    ]) {
      expect(tragaODegrada(sinComentarios(forma)), forma).toBe(0);
    }
  });

  const alcance = fuentes().filter(
    (f) => f.nombre.startsWith('components/') || f.nombre.startsWith('pages/'),
  );

  // Medidas 141 fuentes: el margen detecta una recolección rota sin fallar por poco.
  it('encuentra el árbol', () => {
    expect(alcance.length).toBeGreaterThan(100);
  });

  it('los únicos que tragan un fallo son las excepciones y los pendientes', () => {
    const medido: Record<string, number> = {};
    for (const f of alcance) {
      const n = tragaODegrada(f.codigo);
      const tolera = EXCEPCIONES[f.nombre]?.cuantas ?? 0;
      if (n !== tolera) medido[f.nombre] = n - tolera;
    }
    expect(
      medido,
      'Un fallo de carga no se traga ni se pinta como vacío: guarda `failed` y pinta `WidgetError` (o usa `useLectura`). ' +
        'Si de verdad es legítimo, va en EXCEPCIONES con su porqué.',
    ).toEqual(PENDIENTES);
  });

  it('las excepciones siguen existiendo', () => {
    const nombres = new Set(alcance.map((f) => f.nombre));
    const obsoletas = Object.keys(EXCEPCIONES).filter((n) => !nombres.has(n));
    expect(obsoletas, 'Excepción que ya no existe: bórrala de EXCEPCIONES.').toEqual([]);
  });
});
