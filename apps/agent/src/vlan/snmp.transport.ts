/**
 * Transporte SNMP para configurar el switch gestionado. El manager no conoce
 * net-snmp: opera contra esta interfaz, lo que permite testear el contrato con
 * un transporte falso (sin un switch ni `net-snmp`). La implementación real
 * (`NetSnmpTransport`) carga `net-snmp` de forma perezosa.
 */

/** Tipo SNMP de un varbind soportado (los que usa la gestión de VLANs). */
export type SnmpType = 'Integer' | 'OctetString';

export interface SnmpVarbind {
  oid: string;
  type: SnmpType;
  value: number | string;
}

export interface SnmpTransport {
  /** Aplica un SET SNMP con uno o varios varbinds. Lanza si el switch rechaza. */
  set(varbinds: SnmpVarbind[]): Promise<void>;
  dispose?(): Promise<void>;
}

export interface NetSnmpOptions {
  host: string;
  /** Community string SNMPv2c (por defecto `private` para escritura). */
  community?: string;
  port?: number;
}

/**
 * Transporte SNMP real sobre `net-snmp` (SNMPv2c). La dependencia se carga con
 * import dinámico (especificador no-literal) para no exigirla en
 * `install`/tests/typecheck: solo se instala en el servidor (`pnpm add net-snmp`).
 * No se cubre con unit tests (requiere un switch); la lógica testeable vive en
 * los builders puros y en `SwitchVlanManager` con un transporte falso.
 */
export class NetSnmpTransport implements SnmpTransport {
  private session: unknown = null;
  private snmp: unknown = null;

  constructor(private readonly opts: NetSnmpOptions) {}

  private async ensureSession(): Promise<{
    session: { set: (vbs: unknown[], cb: (err: Error | null, vbs: unknown[]) => void) => void };
    snmp: { ObjectType: Record<string, number> };
  }> {
    if (!this.session) {
      const moduleName = 'net-snmp';
      const snmp = (await import(moduleName).catch(() => {
        throw new Error(
          'El gestor de VLANs por switch requiere el paquete "net-snmp". Instálalo en el servidor (pnpm add net-snmp).',
        );
      })) as {
        createSession: (host: string, community: string, opts: Record<string, unknown>) => unknown;
        ObjectType: Record<string, number>;
        Version2c?: number;
      };
      this.snmp = snmp;
      this.session = snmp.createSession(this.opts.host, this.opts.community ?? 'private', {
        port: this.opts.port ?? 161,
        version: snmp.Version2c,
      });
    }
    return {
      session: this.session as {
        set: (vbs: unknown[], cb: (err: Error | null, vbs: unknown[]) => void) => void;
      },
      snmp: this.snmp as { ObjectType: Record<string, number> },
    };
  }

  async set(varbinds: SnmpVarbind[]): Promise<void> {
    const { session, snmp } = await this.ensureSession();
    const mapped = varbinds.map((vb) => ({
      oid: vb.oid,
      type: snmp.ObjectType[vb.type],
      value: vb.value,
    }));
    await new Promise<void>((resolve, reject) => {
      session.set(mapped, (err) => (err ? reject(err) : resolve()));
    });
  }

  async dispose(): Promise<void> {
    if (this.session) {
      (this.session as { close?: () => void }).close?.();
      this.session = null;
    }
  }
}
