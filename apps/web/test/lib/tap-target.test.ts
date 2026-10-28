import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, ficheros, nombreDe, sinComentariosConLineas } from './_fuentes';

/**
 * Gate de la utilidad `tap-target` (index.css).
 *
 * La utilidad dibuja un `::before` de al menos 44 px centrado en el control, pero NO fija
 * `position`: sin un ancestro posicionado propio, el `::before` se ancla a otro más arriba y
 * el área tocable cubre media pantalla, sin un solo error. Por eso todo `className` que la lleve
 * declara también `relative|absolute|fixed|sticky`.
 *
 * Y la lista `PRIMITIVAS` ata que los controles pequeños conocidos la sigan llevando: retirar la
 * clase de uno de ellos pone esto en rojo (el e2e `tactil.spec.ts` mide el efecto real).
 */

const TAP = /(?<![\w-])tap-target(?![\w-])/;
const POSICION = /(?<![\w:-])(?:relative|absolute|fixed|sticky)(?![\w-])/;

interface Valor {
  texto: string;
  linea: number;
}

/** Los valores de cada `className=…` (literal o expresión `{…}`, multilínea), con su línea. */
function valoresDeClassName(codigo: string): Valor[] {
  const salida: Valor[] = [];
  const re = /[cC]lassName\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) {
    const ini = m.index + m[0].length;
    const abre = codigo[ini];
    let fin = -1;
    if (abre === '"' || abre === "'") {
      fin = codigo.indexOf(abre, ini + 1);
    } else if (abre === '{') {
      let prof = 0;
      let comilla: string | null = null;
      for (let i = ini; i < codigo.length; i++) {
        const c = codigo[i]!;
        if (comilla) {
          if (c === '\\') i++;
          else if (c === comilla) comilla = null;
        } else if (c === '"' || c === "'" || c === '`') comilla = c;
        else if (c === '{') prof++;
        else if (c === '}' && --prof === 0) {
          fin = i;
          break;
        }
      }
    }
    if (fin < 0) continue;
    salida.push({
      texto: codigo.slice(ini, fin + 1),
      linea: codigo.slice(0, m.index).split('\n').length,
    });
  }
  return salida;
}

/** Líneas de los `className` con `tap-target` y sin posición propia. */
export function tapTargetSinPosicion(codigo: string): number[] {
  return valoresDeClassName(codigo)
    .filter((v) => TAP.test(v.texto) && !POSICION.test(v.texto))
    .map((v) => v.linea);
}

/** Controles pequeños que DEBEN llevar `tap-target`: fichero + fragmento de SU className. */
const PRIMITIVAS: { fichero: string; fragmento: string }[] = [
  { fichero: 'components/ui/switch.tsx', fragmento: 'inline-flex h-6 w-11' },
  { fichero: 'components/ui/favorite-button.tsx', fragmento: 'inline-flex h-8 w-8' },
  { fichero: 'components/ui/slideover.tsx', fragmento: 'flex h-8 w-8 shrink-0' },
  { fichero: 'components/ui/toast.tsx', fragmento: 'shrink-0 text-kr-muted' },
  {
    fichero: 'components/ui/help-hint.tsx',
    fragmento: 'inline-flex items-center gap-1 rounded-sm',
  },
  { fichero: 'components/ui/copy-button.tsx', fragmento: 'inline-flex shrink-0 items-center' },
  { fichero: 'components/layout/AppLayout.tsx', fragmento: '-m-2 p-2 text-kr-secondary' },
];

describe('tap-target', () => {
  it('control positivo: el detector cuenta la clase sin posición y deja pasar la que la tiene', () => {
    expect(tapTargetSinPosicion(`<b className="tap-target h-5" />`)).toHaveLength(1);
    expect(tapTargetSinPosicion(`<b className="relative tap-target" />`)).toHaveLength(0);
    expect(
      tapTargetSinPosicion(`<b className={cn('tap-target h-5', x && 'md:relative')} />`),
    ).toHaveLength(1);
    expect(
      tapTargetSinPosicion(`<b className={cn(\n  'inline-flex',\n  'tap-target absolute',\n)} />`),
    ).toHaveLength(0);
  });

  it('guard de recolección: el recorrido ve el árbol', () => {
    expect(ficheros().length).toBeGreaterThan(100);
  });

  it('todo className con tap-target declara su posición', () => {
    const fallos: string[] = [];
    for (const ruta of ficheros()) {
      const codigo = sinComentariosConLineas(readFileSync(ruta, 'utf8'));
      for (const linea of tapTargetSinPosicion(codigo)) fallos.push(`${nombreDe(ruta)}:${linea}`);
    }
    expect(fallos, 'tap-target sin relative|absolute|fixed|sticky en el mismo className').toEqual(
      [],
    );
  });

  it.each(PRIMITIVAS)(
    '$fichero lleva tap-target en el control «$fragmento»',
    ({ fichero, fragmento }) => {
      const codigo = sinComentariosConLineas(readFileSync(join(SRC, fichero), 'utf8'));
      const candidatos = valoresDeClassName(codigo).filter((v) => v.texto.includes(fragmento));
      expect(candidatos.length, `no hay className con «${fragmento}»`).toBeGreaterThan(0);
      for (const v of candidatos) expect(TAP.test(v.texto), `${fichero}:${v.linea}`).toBe(true);
    },
  );
});
