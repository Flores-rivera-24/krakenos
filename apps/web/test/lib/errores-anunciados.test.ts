import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Un error en pantalla se **anuncia** (US-268).
 *
 * Los errores de formulario se pintaban a mano como `<p className="text-kr-sm
 * text-danger">` en 15 sitios. Se ven perfectamente y para un lector de pantalla
 * **no existen**: quien rellena el formulario sin ver la pantalla pulsa
 * «Guardar», no pasa nada aparente y no hay forma de enterarse de por qué.
 *
 * El gate mira los `<p>` **rojos**, no todo `text-danger`: el token también viste
 * badges de estado, asteriscos de campo obligatorio y acentos de una cifra que
 * sube, y ninguno de ésos es un suceso que anunciar. Un párrafo entero en rojo,
 * en cambio, es siempre un mensaje —de error o de acuse— y tiene que declarar su
 * rol: `alert` si interrumpe, `status` si es cortés.
 */

const SRC = join(process.cwd(), 'src');

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return entrada.endsWith('.tsx') ? [ruta] : [];
  });
}

/**
 * Etiquetas `<p …>` de apertura, incluidas las que ocupan varias líneas.
 *
 * Se quitan antes los comentarios: la propia primitiva **cita** el marcado malo
 * para explicar por qué existe, y un gate que no distingue el código de su
 * documentación acaba obligando a no documentar.
 */
function aperturasDeParrafo(fuente: string): string[] {
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return codigo.match(/<p\b[^>]*>/gs) ?? [];
}

const fuentes = ficheros(SRC).map((ruta) => ({
  nombre: ruta.slice(SRC.length + 1),
  texto: readFileSync(ruta, 'utf8'),
}));

describe('errores en pantalla anunciados (US-268)', () => {
  it('encuentra los componentes: si el recorrido se rompe, no pasa en vacío', () => {
    expect(fuentes.length).toBeGreaterThan(80);
  });

  it('todo párrafo en rojo declara su rol', () => {
    const mudos = fuentes.flatMap(({ nombre, texto }) =>
      aperturasDeParrafo(texto)
        .filter((tag) => tag.includes('text-danger') && !tag.includes('role='))
        .map(() => nombre),
    );
    expect([...new Set(mudos)]).toEqual([]);
  });

  it('la primitiva compartida existe y es la que se usa', () => {
    // Si alguien vuelve a escribir el `<p>` a mano en vez de usar `FormError`,
    // el test de arriba lo caza; esto ata que la primitiva siga siendo `alert`.
    const primitiva = fuentes.find((f) => f.nombre.endsWith(join('ui', 'form-error.tsx')));
    expect(primitiva).toBeDefined();
    expect(primitiva!.texto).toContain('role="alert"');
  });
});
