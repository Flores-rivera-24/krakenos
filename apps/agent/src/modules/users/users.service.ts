import type {
  CreateUserRequest,
  UpdateUserRequest,
  UserRole,
  UserStatus,
  UserSummary,
} from '@krakenos/types';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/auth.service.js';

/** Mismo coste bcrypt que el setup del primer admin. */
const BCRYPT_COST = 12;

/** Error de dominio de gestión de usuarios con código estable (→ 409 en la ruta). */
export class UserError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** Columnas públicas de un usuario — nunca el hash de contraseña. */
const SUMMARY_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface UpdateResult {
  user: UserSummary;
  /** Las sesiones del usuario objetivo se revocaron (cambio de rol o deshabilitado). */
  sessionsRevoked: boolean;
}

/**
 * Gestión de usuarios (US-101): alta, listado, edición de rol/estado, reset de
 * contraseña y baja — todo reservado a `admin` en la capa de rutas. Protege el
 * invariante "siempre debe quedar ≥1 administrador activo" para que nadie pueda
 * dejar la instalación sin acceso administrativo.
 */
export class UsersService {
  private readonly auth: AuthService;

  constructor(private readonly app: FastifyInstance) {
    this.auth = new AuthService(app);
  }

  async list(): Promise<UserSummary[]> {
    const rows = await this.app.prisma.user.findMany({
      select: SUMMARY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSummary);
  }

  async create(body: CreateUserRequest): Promise<UserSummary> {
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    try {
      const row = await this.app.prisma.user.create({
        data: {
          email: body.email,
          displayName: body.displayName,
          passwordHash,
          role: body.role,
        },
        select: SUMMARY_SELECT,
      });
      return toSummary(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new UserError('USER_EMAIL_TAKEN', 'Ya existe un usuario con ese email');
      }
      throw err;
    }
  }

  async update(id: string, patch: UpdateUserRequest): Promise<UpdateResult | null> {
    const data: { displayName?: string; role?: UserRole; status?: UserStatus } = {};
    if (patch.displayName !== undefined) data.displayName = patch.displayName;
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.status !== undefined) data.status = patch.status;

    // Todo dentro de una transacción con comprobación **posterior** al cambio: si el
    // resultado dejara 0 administradores activos, se revierte. Esto es race-free —
    // dos degradaciones/deshabilitaciones concurrentes no pueden ambas confirmar un
    // estado sin admins (antes había un TOCTOU entre contar y escribir).
    const result = await this.app.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: SUMMARY_SELECT });
      if (!target) return null;
      const row = await tx.user.update({ where: { id }, data, select: SUMMARY_SELECT });
      const activeAdmins = await tx.user.count({ where: { role: 'admin', status: 'active' } });
      if (activeAdmins === 0) {
        throw new UserError('LAST_ADMIN', 'Debe quedar al menos un administrador activo');
      }
      return { target, row };
    });
    if (!result) return null;

    // Cambio de rol o deshabilitado → revoca las sesiones del objetivo (tras confirmar
    // la transacción): su access token viejo caduca solo, pero no debe poder refrescar.
    const roleChanged = patch.role !== undefined && patch.role !== result.target.role;
    const disabled = patch.status === 'disabled' && result.target.status !== 'disabled';
    let sessionsRevoked = false;
    if (roleChanged || disabled) {
      await this.auth.revokeAllForUser(id);
      sessionsRevoked = true;
    }
    return { user: toSummary(result.row), sessionsRevoked };
  }

  async resetPassword(id: string, password: string): Promise<boolean> {
    const exists = await this.app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return false;
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await this.app.prisma.user.update({ where: { id }, data: { passwordHash } });
    // El usuario debe volver a iniciar sesión con la nueva contraseña.
    await this.auth.revokeAllForUser(id);
    return true;
  }

  async remove(id: string, actingUserId: string): Promise<boolean> {
    if (id === actingUserId) {
      throw new UserError('CANNOT_DELETE_SELF', 'No puedes eliminar tu propia cuenta');
    }
    // Igual que `update`: borra y comprueba el invariante dentro de la transacción,
    // de modo que no pueda quedar 0 administradores activos por una carrera.
    return this.app.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: { id: true } });
      if (!target) return false;
      // La cascada de Prisma limpia refresh tokens, passkeys, códigos, etc.
      await tx.user.delete({ where: { id } });
      const activeAdmins = await tx.user.count({ where: { role: 'admin', status: 'active' } });
      if (activeAdmins === 0) {
        throw new UserError('LAST_ADMIN', 'Debe quedar al menos un administrador activo');
      }
      return true;
    });
  }
}
