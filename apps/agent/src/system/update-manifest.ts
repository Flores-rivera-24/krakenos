/**
 * Manifiesto firmado de una versión (US-291a, puro): parseo estricto, firma
 * ed25519 y reglas anti-downgrade. No toca red ni disco.
 */
import { createPublicKey, verify } from 'node:crypto';
import { UpdateBlockedError } from './node-requirement.js';
import { isNewer } from './version-compare.js';

export const PLATFORMS = ['deb-amd64', 'deb-arm64', 'arch-x86_64'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Artifact {
  platform: Platform;
  name: string;
  sha256: string;
  size: number;
}
export interface Manifest {
  schema: 1;
  version: string;
  minFrom: string;
  artifacts: Artifact[];
}

// Sin ceros a la izquierda y ≤ 9 dígitos por parte: así `parseInt` (isNewer) no se desborda ni confunde 01 con 1.
const PART = '(?:0|[1-9]\\d{0,8})';
const VERSION = new RegExp(`^${PART}\\.${PART}\\.${PART}$`);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
const NAME_MAX = 128;
const NAME_EXT = /(\.deb|\.pkg\.tar\.zst)$/;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(why: string): never {
  throw new Error(`Manifiesto inválido: ${why}.`);
}

function onlyKeys(o: Record<string, unknown>, keys: string[], what: string): void {
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) fail(`${what} trae campos desconocidos (${extra.join(', ')})`);
}

export function parseManifest(bytes: Buffer): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail('no es JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('no es un objeto');
  const m = raw as Record<string, unknown>;
  onlyKeys(m, ['schema', 'version', 'minFrom', 'artifacts'], 'el manifiesto');
  if (m.schema !== 1) fail('schema no soportado');
  if (typeof m.version !== 'string' || !VERSION.test(m.version)) fail('versión mal formada');
  if (typeof m.minFrom !== 'string' || !VERSION.test(m.minFrom)) fail('minFrom mal formado');
  if (!Array.isArray(m.artifacts) || m.artifacts.length === 0) fail('sin artefactos');
  const seen = new Set<string>();
  const artifacts = m.artifacts.map((a: unknown): Artifact => {
    if (typeof a !== 'object' || a === null) return fail('artefacto mal formado');
    const x = a as Record<string, unknown>;
    onlyKeys(x, ['platform', 'name', 'sha256', 'size'], 'un artefacto');
    if (!PLATFORMS.includes(x.platform as Platform)) return fail('plataforma desconocida');
    if (
      typeof x.name !== 'string' ||
      x.name.length > NAME_MAX ||
      x.name.includes('..') ||
      !NAME.test(x.name) ||
      !NAME_EXT.test(x.name)
    )
      return fail('nombre de artefacto no válido');
    if (typeof x.sha256 !== 'string' || !SHA256.test(x.sha256)) return fail('sha256 no válido');
    if (!Number.isSafeInteger(x.size) || (x.size as number) <= 0) return fail('tamaño no válido');
    if (seen.has(x.platform as string)) return fail('plataforma repetida');
    seen.add(x.platform as string);
    return x as unknown as Artifact;
  });
  return { schema: 1, version: m.version, minFrom: m.minFrom, artifacts };
}

/** `false` ante cualquier fallo (firma, base64, clave): nunca lanza. */
export function verifyManifest(bytes: Buffer, sigB64: string, publicKeyPem: string): boolean {
  try {
    const sig = Buffer.from(sigB64.trim(), 'base64');
    if (sig.length !== 64) return false;
    return verify(null, bytes, createPublicKey(publicKeyPem), sig);
  } catch {
    return false;
  }
}

/**
 * Punto único para leer un manifiesto: la firma se comprueba sobre los bytes crudos
 * ANTES de interpretarlos (un JSON hostil no llega al parser).
 */
export function verifyAndParse(bytes: Buffer, sigB64: string, publicKeyPem: string): Manifest {
  if (!verifyManifest(bytes, sigB64, publicKeyPem)) {
    throw new UpdateBlockedError(
      'BAD_SIGNATURE',
      'El manifiesto de la versión no está firmado con la clave del proyecto; no se instala nada.',
    );
  }
  return parseManifest(bytes);
}

/**
 * Anti-downgrade: versión estrictamente mayor y la instalada ≥ `minFrom`.
 * `isNewer` usa parseInt: una instalada `0.3.0-rc1` cuenta como `0.3.0` (no es upgrade a 0.3.0).
 */
export function checkUpgrade(m: Manifest, installed: string): void {
  if (!isNewer(m.version, installed)) {
    throw new UpdateBlockedError(
      'NOT_AN_UPGRADE',
      `La versión ${m.version} no es más nueva que la instalada (${installed}).`,
    );
  }
  if (isNewer(m.minFrom, installed)) {
    throw new UpdateBlockedError(
      'MIN_FROM',
      `La versión ${m.version} exige partir de la ${m.minFrom} o más nueva; la instalada es la ${installed}.`,
    );
  }
}

export function artifactFor(m: Manifest, platform: Platform): Artifact {
  const a = m.artifacts.find((x) => x.platform === platform);
  if (!a)
    throw new UpdateBlockedError(
      'NO_ARTIFACT',
      `La versión ${m.version} no trae paquete para ${platform}.`,
    );
  return a;
}

export { UPDATE_PUBLIC_KEY_PEM } from './update-signing-key.js';
