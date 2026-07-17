#!/usr/bin/env node
/**
 * Gate de auditoría de dependencias (AUD-23) sobre datos de OSV.
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
 * Uso: node scripts/audit-osv.mjs <osv-report.json>
 * Sale con código 1 solo si hay CRITICAL en producción.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Uso: node scripts/audit-osv.mjs <osv-report.json>');
  process.exit(2);
}

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

const prod = collectProdPackages();
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const bySeverity = new Map();
const prodCriticals = [];
const prodOthers = [];

for (const result of report.results ?? []) {
  for (const pkg of result.packages ?? []) {
    const name = pkg.package?.name;
    const version = pkg.package?.version;
    const inProd = prod.has(`${name}@${version}`);
    for (const vuln of pkg.vulnerabilities ?? []) {
      const severity = String(vuln.database_specific?.severity ?? 'UNKNOWN').toUpperCase();
      bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
      const line = `${severity} ${name}@${version} ${vuln.id} — ${vuln.summary ?? ''}`;
      if (inProd && severity === 'CRITICAL') prodCriticals.push(line);
      else if (inProd) prodOthers.push(line);
    }
  }
}

const summary = [...bySeverity.entries()].map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · ');
console.log(`OSV: ${summary || 'sin vulnerabilidades conocidas'} (lockfile completo, dev incluido)`);
console.log(`Producción: ${prod.size} paquetes · ${prodOthers.length} aviso(s) no críticos · ${prodCriticals.length} CRITICAL`);
for (const line of prodOthers) console.log(`  aviso  ${line}`);

if (prodCriticals.length > 0) {
  console.error('\nCRITICAL en dependencias de PRODUCCIÓN (bloqueante, AUD-23):');
  for (const line of prodCriticals) console.error(`  ${line}`);
  process.exit(1);
}
console.log('Sin CRITICAL en producción: OK');
