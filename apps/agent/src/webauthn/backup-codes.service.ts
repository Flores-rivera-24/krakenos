import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/** Número de códigos de recuperación que se generan por lote. */
const CODE_COUNT = 10;

/**
 * Hash sha256 (hex) de un código. Los códigos son aleatorios de alta entropía
 * (80 bits los nuevos; los emitidos antes eran de 48 bits y siguen valiendo, porque
 * el hash es del texto normalizado), así que un hash rápido es suficiente (a diferencia de las contraseñas,
 * que usan bcrypt). Nunca se persiste el texto plano.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/**
 * Genera un código legible tipo `a1b2c-3d4e5-f6a7b-8c9d0` (20 hex = 80 bits, en
 * 4 grupos de 5). Los códigos antiguos (`a1b2-c3d4-e5f6`, 48 bits) ya emitidos
 * se siguen aceptando al verificar.
 */
function generateCode(): string {
  const hex = randomBytes(10).toString('hex');
  return [0, 5, 10, 15].map((i) => hex.slice(i, i + 5)).join('-');
}

/**
 * Gestión de los códigos de recuperación 2FA (US-59): permiten completar el segundo
 * factor si el usuario pierde su última passkey. Solo se persiste el hash; el texto
 * plano se devuelve una vez al generarlos. Cada código es de un solo uso.
 */
export class BackupCodeService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * (Re)genera el lote de códigos: borra los anteriores y crea nuevos en una sola
   * transacción. Devuelve el texto plano (que solo se muestra una vez).
   */
  async generate(userId: string, count = CODE_COUNT): Promise<string[]> {
    const codes = Array.from({ length: count }, generateCode);
    await this.prisma.$transaction([
      this.prisma.backupCode.deleteMany({ where: { userId } }),
      ...codes.map((c) =>
        this.prisma.backupCode.create({ data: { userId, codeHash: hashCode(c) } }),
      ),
    ]);
    return codes;
  }

  /**
   * Genera códigos solo si el usuario no tiene ninguno todavía (al registrar la
   * primera passkey). Devuelve los códigos, o `null` si ya tenía.
   */
  async generateIfNone(userId: string): Promise<string[] | null> {
    const existing = await this.prisma.backupCode.count({ where: { userId } });
    if (existing > 0) return null;
    return this.generate(userId);
  }

  /** Número de códigos sin usar que le quedan al usuario. */
  async remaining(userId: string): Promise<number> {
    return this.prisma.backupCode.count({ where: { userId, usedAt: null } });
  }

  /**
   * Consume un código de recuperación sin usar (atómico, de un solo uso): marca
   * `usedAt`. Devuelve `true` si el código era válido y se consumió, `false` si no
   * existía o ya estaba usado.
   */
  async consume(userId: string, code: string): Promise<boolean> {
    const result = await this.prisma.backupCode.updateMany({
      where: { userId, codeHash: hashCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }
}
