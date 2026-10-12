/**
 * Requisito de Node de una versión de KrakenOS (puro).
 *
 * El actualizador de un clic no miraba la versión de Node: si una release pasaba a
 * exigir un Node más nuevo que el del servicio, el `restart` fallaba y el rollback
 * revertía sin decir por qué. Aquí se compara el `engines.node` del `package.json`
 * **del tag de destino** con el Node que corre ahora, ANTES de tocar nada.
 *
 * Solo se entiende el rango que usa este repo (`>=N` o `>=N.M[.P]`). Cualquier otra
 * forma se trata como «no sé» y NO bloquea: negar una actualización por no saber
 * interpretar un rango sería peor que dejarla seguir hasta el healthcheck.
 */

/** Código estable con el que el actualizador declara que se negó por el Node. */
export const NODE_TOO_OLD = 'NODE_TOO_OLD' as const;

/** Una actualización que se rechaza ANTES de tocar nada: no hay nada que revertir. */
export class UpdateBlockedError extends Error {
  constructor(
    readonly code: typeof NODE_TOO_OLD,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateBlockedError';
  }
}

export interface NodeVersionParts {
  major: number;
  minor: number;
}

/** `v24.15.0` / `24.1` / `24` → `{ major, minor }`; cualquier otra cosa → `null`. */
export function parseNodeVersion(raw: string): NodeVersionParts | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.\d+)?/.exec(raw.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) };
}

/** `">=24"` / `">= 22.12.0"` → mínimo exigido; rangos que no son `>=` → `null`. */
export function parseEnginesNode(range: string): NodeVersionParts | null {
  const m = /^\s*>=\s*(\d+(?:\.\d+){0,2})\s*$/.exec(range);
  return m ? parseNodeVersion(m[1]!) : null;
}

export type NodeRequirementCheck =
  | { ok: true }
  | { ok: false; required: string; current: string; message: string };

/** ¿Cumple `current` (p. ej. `process.version`) el `engines.node` de la versión destino? */
export function checkNodeRequirement(
  enginesNode: string | null | undefined,
  current: string,
): NodeRequirementCheck {
  if (!enginesNode) return { ok: true };
  const need = parseEnginesNode(enginesNode);
  const have = parseNodeVersion(current);
  if (!need || !have) return { ok: true };
  if (have.major > need.major || (have.major === need.major && have.minor >= need.minor)) {
    return { ok: true };
  }
  const required = need.minor > 0 ? `${need.major}.${need.minor}` : String(need.major);
  const currentLabel = `${have.major}.${have.minor}`;
  return {
    ok: false,
    required,
    current: currentLabel,
    message:
      `Esta versión necesita Node ${required} o superior y el sistema tiene ${currentLabel}. ` +
      'Actualiza con `sudo bash scripts/install.sh --update`, que instala el Node necesario.',
  };
}

/** Extrae `engines.node` de un `package.json` en texto; ilegible → `null`. */
export function readEnginesNode(packageJson: string): string | null {
  try {
    const pkg = JSON.parse(packageJson) as { engines?: { node?: unknown } };
    const node = pkg.engines?.node;
    return typeof node === 'string' ? node : null;
  } catch {
    return null;
  }
}
