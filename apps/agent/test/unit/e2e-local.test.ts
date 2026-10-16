import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { decidirLibs, ldLibraryPathCon, libsPresentes, mensajePuertoOcupado, necesitaChromium, parseArgs, proyectosPedidos, resumenFinal } from '../../../../scripts/e2e-local.mjs';

/**
 * `pnpm test:e2e:local`: la lógica de decisión del script (qué decir ante un puerto
 * ocupado, qué hacer según falten las librerías de Chromium) es pura y se prueba aquí;
 * el efecto (lanzar Playwright) se verificó ejecutándolo.
 */
describe('e2e-local: argumentos', () => {
  it('--no-build es nuestro; el resto pasa tal cual a Playwright', () => {
    expect(parseArgs(['--no-build', 'e2e/tests/a.spec.ts', '-g', 'x', '--headed'])).toEqual({
      build: false,
      resto: ['e2e/tests/a.spec.ts', '-g', 'x', '--headed'],
    });
    expect(parseArgs(['--ui'])).toEqual({ build: true, resto: ['--ui'] });
  });

  it('Chromium hace falta salvo que se pidan solo proyectos de Firefox', () => {
    expect(proyectosPedidos(['--project=chromium', '--project', 'firefox'])).toEqual([
      'chromium',
      'firefox',
    ]);
    expect(necesitaChromium([])).toBe(true);
    expect(necesitaChromium(['--project=chromium-en'])).toBe(true);
    expect(necesitaChromium(['--project=firefox'])).toBe(false);
    expect(necesitaChromium(['--project=firefox', '--project=chromium'])).toBe(true);
  });
});

describe('e2e-local: puerto ocupado', () => {
  it('nombra PID y comando y da el kill -TERM, nunca -9', () => {
    const m = mensajePuertoOcupado(3999, [{ pid: '4242', comando: 'node dist/index.js' }]);
    expect(m).toContain('3999');
    expect(m).toContain('PID 4242: node dist/index.js');
    expect(m).toContain('kill -TERM 4242');
    expect(m).not.toMatch(/kill -9/);
  });

  it('avisa si el PID es el de una ejecución anterior de este checkout', () => {
    const m = mensajePuertoOcupado(3999, [{ pid: '4242', comando: 'node' }], '4242');
    expect(m).toContain('ejecución e2e anterior');
    expect(mensajePuertoOcupado(3999, [{ pid: '4242', comando: 'node' }], '1')).not.toContain(
      'ejecución e2e anterior',
    );
  });

  it('sin lsof (no sabe quién) lo dice y da una vía para averiguarlo', () => {
    const m = mensajePuertoOcupado(3999, []);
    expect(m).toContain('ss -ltnp');
    expect(m).toContain('kill -TERM <pid>');
  });
});

describe('e2e-local: librerías de Chromium', () => {
  const base = { apanoDir: '/apano', playwrightBin: '/repo/node_modules/.bin/playwright' };

  it('detecta libnspr4 y libnss3 en la salida de ldconfig (y exige las dos)', () => {
    const ok =
      '\tlibnspr4.so (libc6,x86-64) => /lib/libnspr4.so\n\tlibnss3.so (libc6,x86-64) => /lib/libnss3.so';
    expect(libsPresentes(ok)).toBe(true);
    expect(libsPresentes('\tlibnspr4.so (libc6,x86-64) => /lib/libnspr4.so')).toBe(false);
    expect(libsPresentes('')).toBe(false);
  });

  it('presentes en el sistema: no hace nada', () => {
    expect(
      decidirLibs({ ...base, plataforma: 'linux', libsDelSistema: true, apanoExiste: false }),
    ).toEqual({ accion: 'nada' });
  });

  it('fuera de Linux: no hace nada aunque no haya libs ni apaño', () => {
    expect(
      decidirLibs({ ...base, plataforma: 'win32', libsDelSistema: false, apanoExiste: false }),
    ).toEqual({ accion: 'nada' });
  });

  it('faltan y existe el apaño: lo usa y lo dice', () => {
    const d = decidirLibs({
      ...base,
      plataforma: 'linux',
      libsDelSistema: false,
      apanoExiste: true,
    });
    expect(d.accion).toBe('apano');
    expect(d.ldLibraryPath).toBe('/apano');
    expect(d.mensaje).toContain('LD_LIBRARY_PATH=/apano');
  });

  it('faltan y no hay apaño: aborta con las dos salidas', () => {
    const d = decidirLibs({
      ...base,
      plataforma: 'linux',
      libsDelSistema: false,
      apanoExiste: false,
    });
    expect(d.accion).toBe('abortar');
    expect(d.mensaje).toContain(
      'sudo env "PATH=$PATH" /repo/node_modules/.bin/playwright install-deps chromium',
    );
    expect(d.mensaje).toContain('docs/e2e.md');
    expect(d.mensaje).toContain('/apano');
  });

  it('el apaño se antepone al LD_LIBRARY_PATH que ya hubiera', () => {
    expect(ldLibraryPathCon('/apano', undefined)).toBe('/apano');
    expect(ldLibraryPathCon('/apano', '/otro')).toBe('/apano:/otro');
  });
});

describe('e2e-local: cierre', () => {
  it('dice cómo abrir el informe y dónde están las trazas solo si existen', () => {
    const con = resumenFinal({ informeExiste: true, trazasExisten: true, codigo: 1 });
    expect(con).toContain('terminó con código 1');
    expect(con).toContain('pnpm exec playwright show-report e2e/playwright-report');
    expect(con).toContain('e2e/test-results');
    const sin = resumenFinal({ informeExiste: false, trazasExisten: false, codigo: 0 });
    expect(sin).toContain('OK');
    expect(sin).not.toContain('show-report');
    expect(sin).not.toContain('test-results');
  });
});
