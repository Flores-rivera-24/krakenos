import { randomBytes } from 'node:crypto';

/**
 * Recuperación de la cuenta de administrador (US-233 / AUD3-21).
 *
 * El agujero que cierra: **no había ninguna vía**. `POST /api/setup/init` responde
 * 409 en cuanto existe un usuario, el `seed` hace `update: {}` (o sea, nada, si el
 * usuario ya está), y `docs/recovery.md` §3 describía un procedimiento que el código
 * no implementaba. Resultado real: perder la contraseña de admin sin otro admin
 * activo dejaba la instalación inservible, con los datos ahí pero inaccesibles.
 *
 * La postura de seguridad no cambia: esto **no** es un endpoint. Corre en el host
 * (`node dist/reset-admin.js`), donde ya se tiene acceso al disco — y quien controla
 * el disco controla la instancia, como dice el modelo de amenazas. Lo que se evita es
 * tener que escribir un hash bcrypt a mano en SQLite.
 *
 * Núcleo **puro** (prisma y el hash se inyectan) para poder probar la política de
 * contraseña, la creación y el reseteo sin tocar la base real.
 */

/** Política del setup (US-02): ≥10 caracteres con al menos una letra y un dígito. */
const MIN_PASSWORD = 10;
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /\d/;

export function validateAdminPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
  }
  if (!HAS_LETTER.test(password) || !HAS_DIGIT.test(password)) {
    return 'La contraseña debe incluir al menos una letra y un dígito';
  }
  return null;
}

/** Email con forma razonable (la validación fina la hace el schema de la API). */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Contraseña temporal legible pero fuerte, garantizando letra y dígito (si saliera
 * un base64url sin dígitos, la política la rechazaría).
 */
export function generateAdminPassword(): string {
  return `${randomBytes(12).toString('base64url')}0a`;
}

interface AdminResetPrisma {
  user: {
    findUnique(args: { where: { email: string } }): Promise<{ id: string } | null>;
    update(args: {
      where: { email: string };
      data: { passwordHash: string; role: string; status: string };
    }): Promise<{ id: string }>;
    create(args: {
      data: {
        email: string;
        displayName: string;
        passwordHash: string;
        role: string;
        status: string;
      };
    }): Promise<{ id: string }>;
  };
  refreshToken: {
    updateMany(args: {
      where: { userId: string; revoked: boolean };
      data: { revoked: boolean };
    }): Promise<{ count: number }>;
  };
}

export interface AdminResetDeps {
  prisma: AdminResetPrisma;
  hash: (password: string) => Promise<string>;
}

export interface AdminResetResult {
  email: string;
  /** `true` si no existía y se ha creado; `false` si se ha reseteado el existente. */
  created: boolean;
  /** Sesiones revocadas (0 al crear). */
  revokedSessions: number;
}

/**
 * Crea el admin o resetea el existente (contraseña + rol admin + cuenta activa).
 * Revoca sus sesiones: si alguien recupera la cuenta, los refresh tokens anteriores
 * no deben seguir siendo válidos.
 */
export async function resetAdmin(
  deps: AdminResetDeps,
  input: { email: string; password: string; displayName?: string },
): Promise<AdminResetResult> {
  if (!isPlausibleEmail(input.email)) throw new Error(`Email no válido: ${input.email}`);
  const policyError = validateAdminPassword(input.password);
  if (policyError) throw new Error(policyError);

  const passwordHash = await deps.hash(input.password);
  const existing = await deps.prisma.user.findUnique({ where: { email: input.email } });

  if (!existing) {
    await deps.prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName ?? 'Administrador',
        passwordHash,
        role: 'admin',
        status: 'active',
      },
    });
    return { email: input.email, created: true, revokedSessions: 0 };
  }

  // Reactiva la cuenta además de resetear: si el admin se deshabilitó a sí mismo,
  // dejarla en `disabled` la mantendría inservible.
  await deps.prisma.user.update({
    where: { email: input.email },
    data: { passwordHash, role: 'admin', status: 'active' },
  });
  const { count } = await deps.prisma.refreshToken.updateMany({
    where: { userId: existing.id, revoked: false },
    data: { revoked: true },
  });
  return { email: input.email, created: false, revokedSessions: count };
}
