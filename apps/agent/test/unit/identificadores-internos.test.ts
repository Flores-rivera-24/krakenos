import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDriver } from '../../src/drivers/index.js';

/**
 * Los identificadores de historia (`US-XXX`) son **internos**: no hay tracker
 * público que los resuelva, así que fuera del equipo son punteros colgantes.
 *
 * Este gate no los persigue por todas partes —en comentarios de código y nombres
 * de test son el rastro de ingeniería y ahí se quedan—, sino en las **dos
 * superficies donde hacen daño**:
 *
 * 1. **Texto que ve el usuario.** «El driver se retiró en US-238» le da un código
 *    con el que no puede hacer nada.
 * 2. **Docs publicados que apuntan a docs internos.** `CLAUDE.md`, `BACKLOG.md`,
 *    `SPECS.md` y `docs/history.md` están gitignored: una guía publicada que
 *    remite a ellos es un enlace roto para cualquiera que clone el repo.
 * 3. **La prosa de los docs publicados.** «✅ Mitigado (US-74): el helper acota…»
 *    obliga a quien lee desde fuera a resolver un código que no puede resolver.
 *    Lo que la frase quiere decir cabe sin el id, y si no cabe es que el id
 *    estaba haciendo de explicación.
 */

const RAIZ = resolve(__dirname, '../../../..');
const ID_DE_HISTORIA = /\bUS-\d{2,3}\b/;

/** Ficheros que el repo NO publica (gitignored a propósito). */
const DOCS_INTERNOS = /\b(CLAUDE\.md|BACKLOG\.md|SPECS\.md|docs\/history\.md)\b/;

/** Ficheros versionados bajo una ruta (los que un tercero llega a ver). */
function ficherosPublicados(patron: string): string[] {
  const salida = execFileSync('git', ['ls-files', patron], { cwd: RAIZ, encoding: 'utf8' });
  return salida.split('\n').filter(Boolean);
}

describe('identificadores internos fuera de las superficies públicas', () => {
  it('ningún texto visible de la app nombra una historia', () => {
    const catalogos = ['es.ts', 'en.ts'].map((f) =>
      join(RAIZ, 'apps/web/src/lib/i18n/catalog', f),
    );
    const guias = readdirSync(join(RAIZ, 'apps/web/src/lib/guides/integrations'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(RAIZ, 'apps/web/src/lib/guides/integrations', f));

    const ofensas: string[] = [];
    for (const ruta of [...catalogos, ...guias]) {
      readFileSync(ruta, 'utf8')
        .split('\n')
        .forEach((linea, i) => {
          // Los comentarios sí pueden citar la historia: su lector es quien
          // trabaja en el código, no quien usa la app.
          const codigo = linea.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (ID_DE_HISTORIA.test(codigo)) ofensas.push(`${ruta}:${i + 1} → ${linea.trim()}`);
        });
    }
    expect(ofensas, ofensas.join('\n')).toEqual([]);
  });

  it('guard de tamaño: el gate está mirando ficheros de verdad', () => {
    // Sin esto, un `readdir` que falle dejaría el test en verde sin comprobar nada.
    expect(ficherosPublicados('docs/*.md').length).toBeGreaterThan(20);
  });

  it('el mensaje de un driver retirado explica el porqué sin dar un código interno', () => {
    // Es el caso concreto que lo destapó: quien tiene `DRIVER_KIND=cisco-ios` en su
    // `.env` se encuentra este error al actualizar.
    expect(() => createDriver({ kind: 'cisco-ios' as 'mock' })).toThrow(/se retiró/i);
    expect(() => createDriver({ kind: 'cisco-ios' as 'mock' })).toThrow(/DRIVER_KIND/);
    try {
      createDriver({ kind: 'cisco-ios' as 'mock' });
    } catch (err) {
      expect((err as Error).message).not.toMatch(ID_DE_HISTORIA);
    }
  });

  it('ningún doc publicado remite a un doc interno gitignored', () => {
    const ofensas: string[] = [];
    for (const relativo of [...ficherosPublicados('docs/*.md'), 'README.md']) {
      readFileSync(join(RAIZ, relativo), 'utf8')
        .split('\n')
        .forEach((linea, i) => {
          if (DOCS_INTERNOS.test(linea)) ofensas.push(`${relativo}:${i + 1} → ${linea.trim()}`);
        });
    }
    expect(ofensas, `Enlaces rotos para quien clona:\n${ofensas.join('\n')}`).toEqual([]);
  });

  it('ningún doc publicado nombra una historia en su prosa', () => {
    // A diferencia del código, estos ficheros los lee alguien de fuera, que no
    // tiene tracker donde resolver el id. La regla se sostiene con este test y
    // no con acordarse: la limpieza de 2026-08-06 quitó ~300 de una sentada.
    const ofensas: string[] = [];
    for (const relativo of [...ficherosPublicados('docs/*.md'), 'README.md']) {
      readFileSync(join(RAIZ, relativo), 'utf8')
        .split('\n')
        .forEach((linea, i) => {
          if (ID_DE_HISTORIA.test(linea)) ofensas.push(`${relativo}:${i + 1} → ${linea.trim()}`);
        });
    }
    expect(
      ofensas,
      `Un id interno no significa nada fuera del equipo. Reescribe la frase sin él ` +
        `(la trazabilidad vive en los docs internos):\n${ofensas.join('\n')}`,
    ).toEqual([]);
  });
});
