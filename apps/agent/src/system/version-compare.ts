/**
 * Comparación de versiones semver sin red ni dependencias: la usa también el verificador que
 * ejecuta root (`verify-update.ts`), que no puede arrastrar el código de egress.
 */

/** Parsea "v1.2.3" o "1.2.3" a `[major, minor, patch]` (no numérico → 0). */
export function parseVersion(v: string): [number, number, number] {
  const parts = v.replace(/^v/i, '').split('.');
  const num = (i: number) => {
    const n = parseInt(parts[i] ?? '0', 10);
    return Number.isFinite(n) ? n : 0;
  };
  return [num(0), num(1), num(2)];
}

/** ¿Es `a` una versión más nueva que `b`? */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x[i]! > y[i]!) return true;
    if (x[i]! < y[i]!) return false;
  }
  return false;
}
