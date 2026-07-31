import type { PrismaClient } from '@prisma/client';
import type {
  IntegrationConfigInfo,
  IntegrationConfigValues,
  IntegrationDomain,
} from '@krakenos/types';
import type { Secretbox } from '../config/secretbox.js';
import { isEncrypted } from '../config/secretbox.js';
import type { DomainRecord } from './factory-config.js';
import { isSecretKey } from './schema.js';
import { deriveTapoAuthHash, isTapoAuthHash } from '../iot/tapo-auth.js';

/**
 * Cambia credenciales por material **derivado** antes de que nada se guarde
 * (US-259). Hoy solo aplica a Tapo, que es el único backend cuyo secreto es la
 * contraseña de la **cuenta del fabricante** —la del portal TP-Link, la que se
 * reutiliza en otros sitios— en vez de una clave del propio aparato.
 *
 * KLAP solo usa `sha256(sha256(email) ‖ sha256(password))`, así que se guarda eso
 * y la contraseña **no llega al disco**. Es una función aparte y pura sobre los
 * valores: así el recorte ocurre **antes** del cifrado y no depende de que quien
 * llame se acuerde. Si mañana otro backend admite lo mismo, se añade aquí.
 */
function derivarCredenciales(
  domain: IntegrationDomain,
  values: IntegrationConfigValues,
): { values: IntegrationConfigValues; descartadas: Set<string> } {
  const descartadas = new Set<string>();
  if (domain !== 'iot') return { values, descartadas };
  const email = values['kasa.tapoEmail'];
  const password = values['kasa.tapoPassword'];
  if (typeof email !== 'string' || typeof password !== 'string') return { values, descartadas };
  if (email === '' || password === '') return { values, descartadas };
  // Una contraseña que ya es un hash no se vuelve a derivar (derivar dos veces
  // rompería el handshake sin un solo error visible).
  if (isTapoAuthHash(password)) return { values, descartadas };

  const out = { ...values };
  out['kasa.tapoAuthHash'] = deriveTapoAuthHash(email, password);
  // Y aquí está el punto de la historia: la contraseña no llega al disco.
  delete out['kasa.tapoPassword'];
  descartadas.add('kasa.tapoPassword');
  return { values: out, descartadas };
}

/**
 * Persistencia de la configuración de integraciones (US-140).
 *
 * Una fila por dominio (`IntegrationConfig`). Los secretos se cifran con
 * {@link Secretbox} (US-139) antes de guardarse y **nunca** se devuelven por la API.
 * `getDecrypted` reconstruye los valores en claro para instanciar el manager;
 * `getInfo` los redacta para la UI. La precedencia DB-sobre-`.env` la resuelve el
 * server usando `factory-config.ts` con lo que devuelve `getDecrypted`.
 */

interface RawRecord {
  kind: string;
  /** Valores tal cual en DB: los secretos siguen cifrados. */
  values: IntegrationConfigValues;
  enabled: boolean;
  updatedAt: Date;
}

/** Registro con secretos ya descifrados + su estado `enabled`. */
export interface DecryptedRecord extends DomainRecord {
  enabled: boolean;
}

function parseValues(json: string): IntegrationConfigValues {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as IntegrationConfigValues;
    }
  } catch {
    /* JSON corrupto → se degrada a vacío en vez de romper */
  }
  return {};
}

export class IntegrationConfigStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secretbox: Secretbox,
  ) {}

  private async getRaw(domain: IntegrationDomain): Promise<RawRecord | null> {
    const row = await this.prisma.integrationConfig.findUnique({ where: { domain } });
    if (!row) return null;
    return {
      kind: row.kind,
      values: parseValues(row.config),
      enabled: row.enabled,
      updatedAt: row.updatedAt,
    };
  }

  /** Registro con secretos DESCIFRADOS listo para el resolver, o `null` si no existe. */
  async getDecrypted(domain: IntegrationDomain): Promise<DecryptedRecord | null> {
    const raw = await this.getRaw(domain);
    if (!raw) return null;
    const values: IntegrationConfigValues = {};
    for (const [key, val] of Object.entries(raw.values)) {
      if (isSecretKey(domain, raw.kind, key) && typeof val === 'string' && isEncrypted(val)) {
        try {
          values[key] = this.secretbox.decrypt(val);
        } catch {
          values[key] = ''; // secreto ilegible (clave rotada/dato dañado) → vacío
        }
      } else {
        values[key] = val;
      }
    }
    return { kind: raw.kind, values, enabled: raw.enabled };
  }

  /**
   * Guarda (upsert) la config de un dominio, cifrando los secretos. Un secreto omitido
   * o vacío **conserva** el ya guardado (si el `kind` no cambió), para que la UI no
   * tenga que reenviar contraseñas al editar otros campos.
   */
  async save(
    domain: IntegrationDomain,
    kind: string,
    values: IntegrationConfigValues,
    enabled = true,
  ): Promise<void> {
    const existing = await this.getRaw(domain);
    const { values: entrantes, descartadas } = derivarCredenciales(domain, values);
    const stored: IntegrationConfigValues = {};
    for (const [key, val] of Object.entries(entrantes)) {
      if (isSecretKey(domain, kind, key)) {
        if (typeof val === 'string' && val !== '') {
          stored[key] = this.secretbox.encrypt(val);
        }
        // secreto vacío/omitido → no se escribe aquí; se preserva abajo si procede
      } else {
        stored[key] = val;
      }
    }
    if (existing && existing.kind === kind) {
      for (const [key, val] of Object.entries(existing.values)) {
        // ⚠️ Una credencial que `derivarCredenciales` acaba de descartar NO se
        // preserva: si no, la contraseña vieja de una instalación legada
        // sobreviviría para siempre a su propia sustitución —el usuario habría
        // hecho justo lo que se le pide (volver a guardar) y el secreto seguiría
        // en disco—, que es el fallo exacto que esta historia viene a cerrar.
        if (descartadas.has(key)) continue;
        if (
          isSecretKey(domain, kind, key) &&
          !(key in stored) &&
          typeof val === 'string' &&
          isEncrypted(val)
        ) {
          stored[key] = val;
        }
      }
    }
    const config = JSON.stringify(stored);
    await this.prisma.integrationConfig.upsert({
      where: { domain },
      create: { domain, kind, config, enabled },
      update: { kind, config, enabled },
    });
  }

  /** Info redactada para la API: sin valores secretos, solo qué secretos hay puestos. */
  async getInfo(domain: IntegrationDomain): Promise<IntegrationConfigInfo | null> {
    const raw = await this.getRaw(domain);
    return raw ? this.toInfo(domain, raw) : null;
  }

  /** Info redactada de todos los dominios con config guardada. */
  async list(): Promise<IntegrationConfigInfo[]> {
    const rows = await this.prisma.integrationConfig.findMany();
    return rows.map((row) =>
      this.toInfo(row.domain as IntegrationDomain, {
        kind: row.kind,
        values: parseValues(row.config),
        enabled: row.enabled,
        updatedAt: row.updatedAt,
      }),
    );
  }

  async remove(domain: IntegrationDomain): Promise<void> {
    await this.prisma.integrationConfig.deleteMany({ where: { domain } });
  }

  private toInfo(domain: IntegrationDomain, raw: RawRecord): IntegrationConfigInfo {
    const config: IntegrationConfigValues = {};
    const secretsSet: string[] = [];
    for (const [key, val] of Object.entries(raw.values)) {
      if (isSecretKey(domain, raw.kind, key)) {
        secretsSet.push(key); // presente ⇒ hay un secreto guardado (no revelamos el valor)
      } else {
        config[key] = val;
      }
    }
    return {
      domain,
      kind: raw.kind,
      enabled: raw.enabled,
      config,
      secretsSet,
      source: 'db',
      updatedAt: raw.updatedAt.toISOString(),
    };
  }
}
