import { createHash, randomBytes } from 'node:crypto';
import type {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  Invitation,
  InvitationPreview,
  UserRole,
} from '@krakenos/types';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/** Coste de bcrypt para la contraseña que elige la persona invitada (igual que el alta normal). */
const BCRYPT_COST = 12;
/** Vida por defecto del enlace. Un enlace que no caduca es una puerta abierta en un chat. */
const DEFAULT_TTL_HOURS = 24;
const MAX_TTL_HOURS = 24 * 7;
/** Política de contraseña del setup (US-02): ≥8 en el wizard; aquí se exige lo mismo. */
const MIN_PASSWORD = 8;

export class InvitationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}

/** Hash del token. Alta entropía (192 bits) → sha256 basta, como en los códigos de recuperación. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

interface InvitationRow {
  id: string;
  email: string;
  displayName: string;
  role: string;
  expiresAt: Date;
  accountExpiresAt: Date | null;
  usedAt: Date | null;
  createdAt: Date;
}

/**
 * Estado derivado en el SERVIDOR y no en la interfaz: comparar fechas en el cliente
 * es una invitación a que una zona horaria mal resuelta enseñe como válido un
 * enlace muerto (o al revés).
 */
function toInvitation(row: InvitationRow, now = new Date()): Invitation {
  const status = row.usedAt !== null ? 'used' : row.expiresAt <= now ? 'expired' : 'pending';
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as UserRole,
    expiresAt: row.expiresAt.toISOString(),
    accountExpiresAt: row.accountExpiresAt?.toISOString() ?? null,
    usedAt: row.usedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    status,
  };
}

/**
 * Invitaciones de un solo uso (US-267).
 *
 * Solo se guarda el hash del token: ni el servidor puede volver a enseñarlo después
 * de crearlo. Es deliberado y es el mismo trato que reciben los refresh y los
 * códigos de recuperación — si se pierde el enlace, se emite otro.
 */
export class InvitationsService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    body: CreateInvitationRequest,
    createdById: string,
  ): Promise<{ invitation: Invitation; token: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new InvitationError('USER_EMAIL_TAKEN', 'Ya existe un usuario con ese correo');
    }

    const hours = Math.min(Math.max(body.expiresInHours ?? DEFAULT_TTL_HOURS, 1), MAX_TTL_HOURS);
    const token = generateToken();

    // Una invitación viva por correo: reinvitar sustituye la anterior en vez de
    // dejar dos enlaces buenos circulando, que es justo lo que no se quiere.
    await this.prisma.invitation.deleteMany({ where: { email: body.email, usedAt: null } });

    const row = await this.prisma.invitation.create({
      data: {
        tokenHash: hashToken(token),
        email: body.email,
        displayName: body.displayName,
        role: body.role,
        expiresAt: new Date(Date.now() + hours * 3600_000),
        ...(body.accountExpiresAt !== undefined
          ? { accountExpiresAt: new Date(body.accountExpiresAt) }
          : {}),
        createdById,
      },
    });

    return { invitation: toInvitation(row), token };
  }

  async list(): Promise<Invitation[]> {
    const rows = await this.prisma.invitation.findMany({ orderBy: { createdAt: 'desc' } });
    const now = new Date();
    return rows.map((r) => toInvitation(r, now));
  }

  /** Revoca (borra) una invitación. Devuelve `false` si no existía. */
  async revoke(id: string): Promise<boolean> {
    const result = await this.prisma.invitation.deleteMany({ where: { id } });
    return result.count === 1;
  }

  /** Busca una invitación **utilizable** por su token: existe, sin usar y sin caducar. */
  private async findUsable(token: string) {
    const row = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt !== null || row.expiresAt <= new Date()) return null;
    return row;
  }

  /** Lo que se enseña antes de aceptar. Escueto a propósito: el token es adivinable a fuerza bruta solo en teoría, pero no hay razón para exponer más. */
  async preview(token: string, homeName: string): Promise<InvitationPreview | null> {
    const row = await this.findUsable(token);
    if (!row) return null;
    return {
      email: row.email,
      displayName: row.displayName,
      role: row.role as UserRole,
      homeName,
    };
  }

  /**
   * Acepta la invitación: crea la cuenta con la contraseña que elige la persona y
   * consume el enlace. Devuelve el id del usuario para que la ruta emita sesión.
   *
   * El consumo es **condicional y atómico** (`usedAt: null` en el `where`): si dos
   * peticiones llegan a la vez con el mismo enlace, solo una puede marcarlo, así que
   * un enlace de un solo uso no puede crear dos cuentas.
   */
  async accept(token: string, body: AcceptInvitationRequest): Promise<string> {
    if (body.password.length < MIN_PASSWORD) {
      throw new InvitationError(
        'PASSWORD_TOO_SHORT',
        `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`,
      );
    }

    const row = await this.findUsable(token);
    if (!row) throw new InvitationError('INVITATION_INVALID', 'Invitación no válida o caducada');

    const claimed = await this.prisma.invitation.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new InvitationError('INVITATION_INVALID', 'Invitación no válida o caducada');
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    const role = row.role as UserRole;
    try {
      const user = await this.prisma.user.create({
        data: {
          email: row.email,
          displayName: body.displayName?.trim() || row.displayName,
          passwordHash,
          role,
          // Mismo criterio que el alta por admin (US-176).
          uiMode: role === 'kid' || role === 'guest' ? 'simple' : 'advanced',
          ...(row.accountExpiresAt !== null ? { expiresAt: row.accountExpiresAt } : {}),
        },
      });
      return user.id;
    } catch {
      // Alguien creó esa cuenta entre medias. El enlace ya está consumido, y así se
      // queda: reabrirlo dejaría vivo un enlace cuyo correo ya tiene dueño.
      throw new InvitationError('USER_EMAIL_TAKEN', 'Ya existe un usuario con ese correo');
    }
  }
}
