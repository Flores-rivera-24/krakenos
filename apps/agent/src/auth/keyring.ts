import { createHash } from 'node:crypto';

/**
 * Llavero de claves RS256 para firmar/verificar JWT con rotación (US-64).
 *
 * - Hay **una** clave de firma (la "actual") y cero o más claves públicas
 *   **previas** que solo verifican, para que durante el solape de una rotación
 *   los tokens aún válidos firmados con la clave anterior sigan aceptándose.
 * - Cada clave se identifica por un `kid` **derivado** de su clave pública (no
 *   hace falta metadato aparte): el mismo PEM siempre produce el mismo `kid`,
 *   así emisor y verificador coinciden sin coordinación.
 *
 * El `kid` viaja en la cabecera del JWT; al verificar se elige la clave pública
 * cuyo `kid` coincide. Un token **sin** `kid` (emitido antes de la rotación con
 * kid) cae a la clave actual, de modo que el primer despliegue de US-64 no cierra
 * sesiones.
 */
export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

/** Deriva un `kid` corto y estable del contenido de la clave pública PEM. */
export function deriveKid(publicKeyPem: string): string {
  const normalized = publicKeyPem.replace(/\s+/g, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export class Keyring {
  /** `kid` de la clave con la que se firman los tokens nuevos. */
  readonly signingKid: string;
  private readonly privateKey: string;
  private readonly publicKey: string;
  /** kid → clave pública (incluye la actual y todas las previas). */
  private readonly publicByKid = new Map<string, string>();

  constructor(current: KeyPair, previousPublicKeys: readonly string[] = []) {
    this.signingKid = deriveKid(current.publicKey);
    this.privateKey = current.privateKey;
    this.publicKey = current.publicKey;
    this.publicByKid.set(this.signingKid, current.publicKey);
    for (const pub of previousPublicKeys) {
      const kid = deriveKid(pub);
      // No pisar la actual si una "previa" resulta ser la misma clave.
      if (!this.publicByKid.has(kid)) this.publicByKid.set(kid, pub);
    }
  }

  /** Clave privada con la que se firman los tokens nuevos. */
  signingPrivateKey(): string {
    return this.privateKey;
  }

  /** Clave pública correspondiente a la clave de firma actual. */
  signingPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Clave pública para verificar un token con el `kid` dado. Sin `kid` (tokens
   * previos a la rotación) → la clave actual. `kid` desconocido → `undefined`
   * (el verificador rechaza el token).
   */
  publicKeyForKid(kid: string | undefined): string | undefined {
    if (!kid) return this.publicByKid.get(this.signingKid);
    return this.publicByKid.get(kid);
  }

  /** Todos los `kid` que el llavero puede verificar (actual + previas). */
  kids(): string[] {
    return [...this.publicByKid.keys()];
  }
}
