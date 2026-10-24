import { describe, expect, it } from 'vitest';
import { fuentes } from './_fuentes';

/**
 * **`text-primary` y `text-destructive` no se usan como TEXTO.**
 *
 * Los alias de shadcn apuntan a `--kr-accent` (`#2563eb`) y `--kr-danger-solid` (`#dc2626`): son
 * colores de FONDO de botón. Como texto sobre superficies oscuras dan 3,35:1 y 3,58:1, por debajo
 * del 4,5:1 de AA. El texto usa `text-kr-link` y `text-danger`. Solo valen como acento de un
 * icono, que pide 3:1 (prop `accent` de las tarjetas de cifras). Se deriva del código: recorre
 * todo `src/`, sin lista de ficheros.
 */

const TEXTO_ALIAS = /(?<![\w-])text-(?:primary|destructive)(?![\w-])/;

/** `fichero` → fragmentos de línea permitidos, cada uno con su motivo. Falla si alguno queda obsoleto. */
const PERMITIDOS: Record<string, Array<{ fragmento: string; motivo: string }>> = {
  'components/dashboard/StatCard.tsx': [
    { fragmento: "accent = 'text-primary'", motivo: 'valor por defecto de `accent`: tiñe el icono' },
  ],
  'components/ui/loading-stat-card.tsx': [
    { fragmento: "accent = 'text-primary'", motivo: 'valor por defecto de `accent`: tiñe el icono' },
  ],
  'pages/TrafficPage.tsx': [
    { fragmento: 'accent="text-primary"', motivo: 'acento del icono de una tarjeta de cifras' },
  ],
  'pages/EnergyPage.tsx': [
    { fragmento: 'accent="text-primary"', motivo: 'acento del icono de una tarjeta de cifras' },
  ],
  'pages/DnsPage.tsx': [
    { fragmento: 'accent="text-destructive"', motivo: 'acento del icono de una tarjeta de cifras' },
  ],
};

export function hallazgos(nombre: string, codigo: string): { vistos: number; malos: string[]; usados: Set<string> } {
  const malos: string[] = [];
  const usados = new Set<string>();
  let vistos = 0;
  codigo.split('\n').forEach((linea, i) => {
    if (!TEXTO_ALIAS.test(linea)) return;
    vistos++;
    const ok = (PERMITIDOS[nombre] ?? []).find((p) => linea.includes(p.fragmento));
    if (ok) usados.add(`${nombre}::${ok.fragmento}`);
    else malos.push(`${nombre}:${i + 1}: ${linea.trim().slice(0, 80)}`);
  });
  return { vistos, malos, usados };
}

describe('texto con alias de acento', () => {
  const todas = fuentes();

  it('el recolector mira de verdad (guard de tamaño)', () => {
    expect(todas.length).toBeGreaterThan(200);
  });

  it('control positivo: caza text-primary y text-destructive como texto, y respeta las variantes', () => {
    expect(hallazgos('x.tsx', '<td className="py-2 text-primary">').malos).toHaveLength(1);
    expect(hallazgos('x.tsx', "cond ? 'text-destructive' : 'text-success'").malos).toHaveLength(1);
    expect(hallazgos('x.tsx', 'bg-primary text-primary-foreground').malos).toHaveLength(0);
    expect(hallazgos('x.tsx', 'text-kr-link text-danger').malos).toHaveLength(0);
  });

  it('ningún fichero usa el alias como texto fuera de la allowlist', () => {
    const malos = todas.flatMap((f) => hallazgos(f.nombre, f.codigo).malos);
    expect(malos).toEqual([]);
  });

  it('la allowlist no queda obsoleta', () => {
    const usados = new Set<string>();
    for (const f of todas) hallazgos(f.nombre, f.codigo).usados.forEach((u) => usados.add(u));
    const esperados = Object.entries(PERMITIDOS).flatMap(([n, ps]) => ps.map((p) => `${n}::${p.fragmento}`));
    expect(esperados.filter((e) => !usados.has(e))).toEqual([]);
  });
});
