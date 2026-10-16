import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fixture de Prisma 5 (US-276): una base SQLite SINTÉTICA escrita por Prisma 5.22.0 y
 * el oráculo con lo que Prisma 5 leyó de ella. Se regenera con
 * `scripts/fixtures-prisma5/generar.mjs`.
 */
export const PRISMA5_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'prisma5',
);
export const PRISMA5_DB = join(PRISMA5_DIR, 'prisma5.db');

/** Un valor serializado en el oráculo: fecha, bytes y bigint llevan marca. */
export type ValorOraculo =
  | string
  | number
  | boolean
  | null
  | { $date: string }
  | { $bytes: string }
  | { $bigint: string };

export type FilaOraculo = Record<string, ValorOraculo>;

export interface FechaCruda {
  k: string;
  t: string;
  v: number | null;
}

export interface Oraculo {
  generadoCon: string;
  t0Ms: number;
  migraciones: string[];
  passkey: {
    seed: string;
    credentialId: string;
    userId: string;
    email: string;
    publicKeyHex: string;
    counter: number;
  };
  /** Filas por tabla, tal como las leyó Prisma 5 (`findMany`, ordenadas por clave). */
  filas: Record<string, FilaOraculo[]>;
  /** `typeof` y valor crudo de cada columna DATETIME, por `Tabla.columna`. */
  fechasCrudas: Record<string, FechaCruda[]>;
  agregados: {
    params: { bucketMs: number; sinceMs: number };
    traffic: Record<string, number>[];
    deviceTraffic: Record<string, string | number>[];
    energy: Record<string, string | number>[];
  };
}

export function leerOraculo(): Oraculo {
  return JSON.parse(readFileSync(join(PRISMA5_DIR, 'oraculo.json'), 'utf8')) as Oraculo;
}

/** Copia la fixture a un directorio temporal (nunca se abre la versionada: dejaría `-wal`). */
export function copiarFixture(): { dir: string; dbFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kr-p5-'));
  const dbFile = join(dir, 'prisma5.db');
  copyFileSync(PRISMA5_DB, dbFile);
  return { dir, dbFile };
}
