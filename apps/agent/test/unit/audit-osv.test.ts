import { describe, expect, it } from 'vitest';
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { analyzeReport, cvss3BaseScore, scoreToLabel, severityOf } from '../../../../scripts/audit-osv.mjs';

/**
 * US-231 (AUD3-32) — **el gate de dependencias no tenía ni un test.**
 *
 * Se comprobó con fixtures sintéticos que degradaba a «pasa» en silencio: leía la
 * severidad solo de `database_specific.severity`, un campo **no estándar**, así que
 * una CVE con CVSS **9.8** publicada en el array `severity` estándar de OSV
 * imprimía `0 CRITICAL` y salía 0. El gate decía OK ante una crítica real.
 *
 * Estos tests atan las tres vías de severidad y el fallo-cerrado.
 */

const PROD = new Set(['vulnerable-lib@1.0.0']);
const DEV_ONLY = new Set(['otra-cosa@9.9.9']);

/** Informe con la severidad SOLO en el array `severity` estándar (el agujero). */
const REPORT_CVSS_ESTANDAR = {
  results: [
    {
      packages: [
        {
          package: { name: 'vulnerable-lib', version: '1.0.0' },
          vulnerabilities: [
            {
              id: 'GHSA-xxxx-yyyy-zzzz',
              summary: 'RCE sin autenticar',
              // Sin `database_specific`: exactamente el caso que se colaba.
              severity: [
                { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Informe con la severidad en el campo no estándar (lo único que se leía antes). */
const REPORT_DATABASE_SPECIFIC = {
  results: [
    {
      packages: [
        {
          package: { name: 'vulnerable-lib', version: '1.0.0' },
          vulnerabilities: [
            {
              id: 'GHSA-aaaa-bbbb-cccc',
              summary: 'Deserialización insegura',
              database_specific: { severity: 'CRITICAL' },
            },
          ],
        },
      ],
    },
  ],
};

describe('cvss3BaseScore', () => {
  it('calcula la puntuación base de vectores conocidos', () => {
    // Vectores publicados, verificables contra la calculadora de FIRST:
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8); // BlueKeep
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10); // Log4Shell
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N')).toBe(4.3);
    // Impacto bajo + explotabilidad baja: 6.42·0.22 + 8.22·0.85·0.44·0.27·0.62 = 1.927 → 2.0.
    // Comprueba de paso el redondeo de la spec (hacia arriba a 1 decimal).
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N')).toBe(2);
  });

  it('acepta también v3.0 y devuelve null para lo que no sabe calcular', () => {
    expect(cvss3BaseScore('CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss3BaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H')).toBeNull();
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L')).toBeNull(); // faltan métricas base
    expect(cvss3BaseScore('no es un vector')).toBeNull();
    expect(cvss3BaseScore(undefined)).toBeNull();
  });

  it('un impacto nulo da 0 aunque el vector sea explotable', () => {
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
  });
});

describe('scoreToLabel', () => {
  it('usa los rangos de la spec, con 9.0 ya como CRITICAL', () => {
    expect(scoreToLabel(9.8)).toBe('CRITICAL');
    expect(scoreToLabel(9.0)).toBe('CRITICAL'); // el borde exacto
    expect(scoreToLabel(8.9)).toBe('HIGH');
    expect(scoreToLabel(4.0)).toBe('MEDIUM');
    expect(scoreToLabel(0.1)).toBe('LOW');
    expect(scoreToLabel(0)).toBe('NONE');
    expect(scoreToLabel(undefined)).toBe('UNKNOWN');
  });
});

describe('severityOf (combina las tres fuentes y toma la PEOR)', () => {
  it('lee el array `severity` estándar cuando no hay database_specific', () => {
    const vuln = { severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] };
    expect(severityOf(vuln, undefined)).toBe('CRITICAL');
  });

  it('lee `max_severity` del grupo de osv-scanner', () => {
    expect(severityOf({ id: 'X' }, '9.1')).toBe('CRITICAL');
    expect(severityOf({ id: 'X' }, '5.0')).toBe('MEDIUM');
  });

  it('NO deja que una fuente benigna rebaje a otra grave', () => {
    // El campo no estándar dice MEDIUM, pero el vector estándar es un 9.8.
    const vuln = {
      database_specific: { severity: 'MODERATE' }, // etiqueta no reconocida → se ignora
      severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
    };
    expect(severityOf(vuln, '2.0')).toBe('CRITICAL');
  });

  it('sin ninguna fuente utilizable devuelve UNKNOWN (no NONE)', () => {
    // Importante: UNKNOWN es visible en el log; NONE parecería «comprobado y limpio».
    expect(severityOf({ id: 'X' }, undefined)).toBe('UNKNOWN');
  });
});

describe('analyzeReport', () => {
  it('CAZA una CRITICAL de producción anunciada solo con CVSS estándar (regresión AUD3-32)', () => {
    const { prodCriticals } = analyzeReport(REPORT_CVSS_ESTANDAR, PROD);
    expect(prodCriticals).toHaveLength(1);
    expect(prodCriticals[0]).toContain('CRITICAL vulnerable-lib@1.0.0');
  });

  it('sigue cazando la CRITICAL anunciada en database_specific (no se rompió lo que iba)', () => {
    const { prodCriticals } = analyzeReport(REPORT_DATABASE_SPECIFIC, PROD);
    expect(prodCriticals).toHaveLength(1);
  });

  it('una CRITICAL que NO está en producción se reporta pero no bloquea', () => {
    const { prodCriticals, prodOthers, bySeverity } = analyzeReport(REPORT_CVSS_ESTANDAR, DEV_ONLY);
    expect(prodCriticals).toHaveLength(0);
    expect(prodOthers).toHaveLength(0);
    expect(bySeverity.get('CRITICAL')).toBe(1); // sale en el resumen del log
  });

  it('falla CERRADO ante un informe sin `results` (scanner roto ≠ limpio)', () => {
    expect(() => analyzeReport({}, PROD)).toThrow(/results/);
    expect(() => analyzeReport(null, PROD)).toThrow(/results/);
    expect(() => analyzeReport({ results: 'nope' }, PROD)).toThrow(/results/);
  });

  it('un informe legítimamente vacío pasa sin bloquear', () => {
    const { prodCriticals, bySeverity } = analyzeReport({ results: [] }, PROD);
    expect(prodCriticals).toHaveLength(0);
    expect(bySeverity.size).toBe(0);
  });
});
