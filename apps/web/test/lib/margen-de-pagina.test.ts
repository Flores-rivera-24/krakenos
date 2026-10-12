import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, sinComentarios } from './_fuentes';

/**
 * Toda página dentro del shell (barra lateral + cabecera) lleva `p-6` en su
 * contenedor raíz. Sin él, el título se pega a la barra lateral y al borde
 * superior y, en móvil, el contenido llega a x=0: se ve «roto» pero nada falla,
 * así que sobrevivió a Personas y Conectar hasta una revisión en navegador.
 */

/** Pantallas a pantalla completa, fuera del shell: llevan su propio padding. */
const A_PANTALLA_COMPLETA: Record<string, string> = {
  'LoginPage.tsx': 'rejilla de dos columnas a pantalla completa, sin shell',
  'SetupPage.tsx': 'asistente centrado a pantalla completa (p-4), sin shell',
  'InvitePage.tsx': 'tarjeta centrada a pantalla completa (p-4), sin shell',
  'WelcomePage.tsx': 'portada a pantalla completa con su propio px/py',
};

const PAGES = join(SRC, 'pages');
const paginas = readdirSync(PAGES).filter((f) => /Page\.tsx$/.test(f));

/** Contenedores a 4 espacios: el elemento raíz del `return` de un componente. */
const RAIZ = /^ {4}<(?:div|section|main)\s+className="([^"]*)"/gm;

describe('margen de página', () => {
  it('recolecta las páginas (guard de tamaño)', () => {
    expect(paginas.length).toBeGreaterThan(15);
  });

  it('las excepciones existen de verdad', () => {
    for (const nombre of Object.keys(A_PANTALLA_COMPLETA)) {
      expect(paginas, nombre).toContain(nombre);
    }
  });

  for (const nombre of paginas.filter((p) => !(p in A_PANTALLA_COMPLETA))) {
    it(`${nombre}: el contenedor raíz lleva p-6`, () => {
      const codigo = sinComentarios(readFileSync(join(PAGES, nombre), 'utf8'));
      const clases = [...codigo.matchAll(RAIZ)].map((m) => m[1] ?? '');
      expect(clases.some((c) => /(^|\s)p-6(\s|$)/.test(c))).toBe(true);
    });
  }
});
