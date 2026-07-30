#!/usr/bin/env node
/**
 * Gate de auditoría de dependencias (AUD-23 · endurecido en US-231/AUD3-32) sobre
 * datos de OSV.
 *
 * npm retiró sus endpoints legacy de audit (410 desde 2026-07-15) y pnpm aún no
 * habla el endpoint bulk (pnpm/pnpm#11265), así que `pnpm audit` se quedó sin
 * datos. Este gate mantiene la garantía original — **bloquear ante una
 * vulnerabilidad CRITICAL en dependencias de producción** — cruzando:
 *   1. el informe JSON de `osv-scanner --lockfile=pnpm-lock.yaml` (argumento), y
 *   2. el árbol real de producción (`pnpm -r list --prod --depth Infinity --json`),
 * porque el lockfile entero incluye tooling de dev (vitest/vite/tar) cuyas
 * vulnerabilidades no corren en el agente del usuario: se reportan, no bloquean.
 *
 * ## Por qué esto se reescribió (US-231)
 *
 * La versión anterior leía la severidad **solo** de `vuln.database_specific.severity`,
 * que es un campo **no estándar** que muchas fuentes de OSV no rellenan. Comprobado
 * con fixtures: una CVE con CVSS **9.8** publicada en el array `severity` estándar
 * imprimía `0 CRITICAL` y **salía 0**. El gate decía «OK» ante una crítica real.
 *
 * Ahora la severidad se resuelve por **tres vías y se toma la peor**:
 *   1. `vuln.database_specific.severity` (etiqueta, cuando existe),
 *   2. `vuln.severity[]` estándar de OSV → vector CVSS v3.x → puntuación base
 *      calculada aquí (la fórmula es determinista y está en la spec),
 *   3. `group.max_severity` de osv-scanner (numérico ya calculado).
 *
 * Y **falla cerrado**: si el informe no parsea o no trae `results`, sale con error
 * en vez de anunciar «sin vulnerabilidades» (en CI el scanner corre con `|| true`,
 * así que un fallo suyo dejaba un fichero vacío que aquí pasaba de largo).
 *
 * Uso: node scripts/audit-osv.mjs <osv-report.json>
 * Sale 1 si hay CRITICAL en producción · 2 si el informe no es utilizable.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ─────────────────────────────── CVSS v3.x ────────────────────────────────

const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC = { L: 0.77, H: 0.44 };
const PR_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 };
const PR_CHANGED = { N: 0.85, L: 0.68, H: 0.5 };
const UI = { N: 0.85, R: 0.62 };
const CIA = { H: 0.56, L: 0.22, N: 0 };

/**
 * Redondeo hacia arriba a 1 decimal **según la spec de CVSS v3.1** (no es
 * `Math.ceil(x*10)/10`: la spec trabaja en enteros para evitar que el error de
 * coma flotante suba un 8.6 exacto a 8.7).
 */
function roundUp1(value) {
  const i = Math.round(value * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
}

/**
 * Puntuación base de un vector CVSS v3.0/v3.1 (`CVSS:3.1/AV:N/AC:L/...`).
 * Devuelve `null` si el vector no es v3.x o le faltan métricas base — no se
 * inventa una puntuación: quien llama decide qué hacer con la ausencia.
 *
 * CVSS v4 **no** se calcula (fórmula distinta y mucho más larga); para esos casos
 * queda la vía de `max_severity`, y si tampoco está, la vulnerabilidad se cuenta
 * como `UNKNOWN` y aparece en el log.
 */
export function cvss3BaseScore(vector) {
  if (typeof vector !== 'string' || !/^CVSS:3\.[01]\//.test(vector)) return null;
  const m = Object.fromEntries(
    vector
      .split('/')
      .slice(1)
      .map((part) => part.split(':'))
      .filter((kv) => kv.length === 2),
  );
  const scopeChanged = m.S === 'C';
  const av = AV[m.AV];
  const ac = AC[m.AC];
  const pr = (scopeChanged ? PR_CHANGED : PR_UNCHANGED)[m.PR];
  const ui = UI[m.UI];
  const c = CIA[m.C];
  const i = CIA[m.I];
  const a = CIA[m.A];
  if ([av, ac, pr, ui, c, i, a].some((v) => v === undefined) || (m.S !== 'C' && m.S !== 'U')) {
    return null;
  }

  const iscBase = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged
    ? 7.52 * (iscBase - 0.029) - 3.25 * (iscBase - 0.02) ** 15
    : 6.42 * iscBase;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundUp1(raw);
}

/** Etiqueta cualitativa de una puntuación CVSS (rangos de la spec). */
export function scoreToLabel(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'UNKNOWN';
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'NONE';
}

const RANK = { UNKNOWN: -1, NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** La peor de dos etiquetas (para combinar las tres fuentes de severidad). */
function worst(a, b) {
  return (RANK[b] ?? -1) > (RANK[a] ?? -1) ? b : a;
}

/**
 * Severidad de una vulnerabilidad combinando las tres fuentes posibles y
 * quedándose con la **peor**. Nunca degrada por ausencia de una de ellas: ese era
 * exactamente el fallo del gate anterior.
 */
export function severityOf(vuln, groupMaxSeverity) {
  let label = 'UNKNOWN';

  const declared = vuln?.database_specific?.severity;
  if (typeof declared === 'string' && RANK[declared.toUpperCase()] !== undefined) {
    label = worst(label, declared.toUpperCase());
  }

  for (const entry of vuln?.severity ?? []) {
    const score = cvss3BaseScore(entry?.score);
    if (score !== null) label = worst(label, scoreToLabel(score));
  }

  if (groupMaxSeverity !== undefined && groupMaxSeverity !== null && groupMaxSeverity !== '') {
    const n = Number(groupMaxSeverity);
    if (!Number.isNaN(n)) label = worst(label, scoreToLabel(n));
  }

  return label;
}

/**
 * Analiza un informe de osv-scanner contra el conjunto de paquetes de producción
 * (`Set` de `nombre@versión`). Puro: no lee ficheros ni sale del proceso, para
 * poder testearlo con fixtures.
 */
export function analyzeReport(report, prodPackages) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.results)) {
    throw new Error(
      'el informe de OSV no tiene un array `results`: el scanner falló o cambió de formato. ' +
        'Se falla cerrado a propósito — un informe ilegible no es «sin vulnerabilidades».',
    );
  }

  const bySeverity = new Map();
  const prodCriticals = [];
  const prodOthers = [];

  for (const result of report.results) {
    for (const pkg of result?.packages ?? []) {
      const name = pkg?.package?.name;
      const version = pkg?.package?.version;
      const inProd = prodPackages.has(`${name}@${version}`);

      // osv-scanner agrupa los ids equivalentes y publica el peor score del grupo.
      const maxByVulnId = new Map();
      for (const group of pkg?.groups ?? []) {
        for (const id of group?.ids ?? []) maxByVulnId.set(id, group?.max_severity);
      }

      for (const vuln of pkg?.vulnerabilities ?? []) {
        const severity = severityOf(vuln, maxByVulnId.get(vuln?.id));
        bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
        const line = `${severity} ${name}@${version} ${vuln?.id} — ${vuln?.summary ?? ''}`;
        if (inProd && severity === 'CRITICAL') prodCriticals.push(line);
        else if (inProd) prodOthers.push(line);
      }
    }
  }

  return { bySeverity, prodCriticals, prodOthers };
}

// ────────────────────────────────── CLI ───────────────────────────────────

/** Recorre el árbol de `pnpm list --json` y junta cada `name@version` instalado. */
function collectProdPackages() {
  const raw = execFileSync('pnpm', ['-r', 'list', '--prod', '--depth', 'Infinity', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const projects = JSON.parse(raw);
  const found = new Set();
  const walk = (deps) => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, info] of Object.entries(deps)) {
      if (!info || typeof info !== 'object') continue;
      if (typeof info.version === 'string') {
        const key = `${name}@${info.version}`;
        if (found.has(key)) continue;
        found.add(key);
      }
      walk(info.dependencies);
    }
  };
  for (const project of Array.isArray(projects) ? projects : []) {
    walk(project.dependencies);
    // `optionalDependencies` también se instala en producción.
    walk(project.optionalDependencies);
  }
  return found;
}

function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('Uso: node scripts/audit-osv.mjs <osv-report.json>');
    process.exit(2);
  }

  let report;
  try {
    const raw = readFileSync(reportPath, 'utf8');
    if (raw.trim() === '') throw new Error('el fichero está vacío');
    report = JSON.parse(raw);
  } catch (err) {
    console.error(`No se pudo leer el informe de OSV (${reportPath}): ${err.message}`);
    console.error('Se falla cerrado: un informe ilegible no puede interpretarse como «limpio».');
    process.exit(2);
  }

  let analysis;
  try {
    analysis = analyzeReport(report, collectProdPackages());
  } catch (err) {
    console.error(`Informe de OSV inutilizable: ${err.message}`);
    process.exit(2);
  }

  const { bySeverity, prodCriticals, prodOthers } = analysis;
  const summary = [...bySeverity.entries()].map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · ');
  console.log(`OSV: ${summary || 'sin vulnerabilidades conocidas'} (lockfile completo, dev incluido)`);
  console.log(
    `Producción: ${prodOthers.length} aviso(s) no críticos · ${prodCriticals.length} CRITICAL`,
  );
  for (const line of prodOthers) console.log(`  aviso  ${line}`);

  if (prodCriticals.length > 0) {
    console.error('\nCRITICAL en dependencias de PRODUCCIÓN (bloqueante, AUD-23):');
    for (const line of prodCriticals) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log('Sin CRITICAL en producción: OK');
}

// Solo actúa como CLI cuando se ejecuta directamente; al importarlo desde un test
// se exponen las funciones puras sin efectos.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
