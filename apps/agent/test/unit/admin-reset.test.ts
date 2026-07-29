import { describe, expect, it, vi } from 'vitest';
import {
  generateAdminPassword,
  isPlausibleEmail,
  resetAdmin,
  validateAdminPassword,
} from '../../src/system/admin-reset.js';

/**
 * Recuperación de la cuenta de admin (US-233 / AUD3-21).
 *
 * El agujero: no había ninguna vía. `/setup/init` da 409 con un usuario existente,
 * el seed hace `update: {}` y `recovery.md` §3 describía un procedimiento que el
 * código no implementaba — perder la contraseña sin otro admin activo dejaba la
 * instalación con los datos dentro e inaccesibles.
 */

function fakePrisma(users: { id: string; email: string }[] = []) {
  const calls = {
    created: [] as unknown[],
    updated: [] as unknown[],
    revoked: [] as unknown[],
  };
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
      create: async (args: unknown) => {
        calls.created.push(args);
        return { id: 'nuevo' };
      },
      update: async (args: unknown) => {
        calls.updated.push(args);
        return { id: 'existente' };
      },
    },
    refreshToken: {
      updateMany: async (args: unknown) => {
        calls.revoked.push(args);
        return { count: 3 };
      },
    },
  };
  return { prisma: prisma as Parameters<typeof resetAdmin>[0]['prisma'], calls };
}

const hash = vi.fn(async (pw: string) => `hash(${pw})`);

describe('validateAdminPassword', () => {
  it('exige la misma política que el setup: ≥10 con letra y dígito', () => {
    expect(validateAdminPassword('corta1')).toMatch(/al menos 10/);
    expect(validateAdminPassword('solamenteletras')).toMatch(/letra y un dígito/);
    expect(validateAdminPassword('1234567890')).toMatch(/letra y un dígito/);
    expect(validateAdminPassword('contrasena1')).toBeNull();
  });
});

describe('isPlausibleEmail', () => {
  it('acepta correos normales y rechaza basura', () => {
    expect(isPlausibleEmail('yo@casa.local')).toBe(true);
    for (const bad of ['sinarroba', 'a@b', 'con espacio@x.com', '@x.com', `${'a'.repeat(250)}@x.com`]) {
      expect(isPlausibleEmail(bad), bad).toBe(false);
    }
  });
});

describe('generateAdminPassword', () => {
  it('la contraseña generada cumple la política y no se repite', () => {
    const a = generateAdminPassword();
    expect(validateAdminPassword(a)).toBeNull();
    expect(a).not.toBe(generateAdminPassword());
  });
});

describe('resetAdmin', () => {
  it('crea el admin cuando no existe', async () => {
    const { prisma, calls } = fakePrisma();
    const result = await resetAdmin({ prisma, hash }, { email: 'yo@casa.local', password: 'contrasena1' });
    expect(result).toEqual({ email: 'yo@casa.local', created: true, revokedSessions: 0 });
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({
      data: { email: 'yo@casa.local', role: 'admin', status: 'active', passwordHash: 'hash(contrasena1)' },
    });
    // Nada que revocar en una cuenta nueva.
    expect(calls.revoked).toHaveLength(0);
  });

  it('resetea el existente: contraseña, rol admin y cuenta ACTIVA', async () => {
    const { prisma, calls } = fakePrisma([{ id: 'u1', email: 'yo@casa.local' }]);
    const result = await resetAdmin({ prisma, hash }, { email: 'yo@casa.local', password: 'contrasena1' });
    expect(result).toMatchObject({ created: false, revokedSessions: 3 });
    // Reactivar importa: un admin que se deshabilitó a sí mismo quedaba encerrado.
    expect(calls.updated[0]).toMatchObject({
      where: { email: 'yo@casa.local' },
      data: { role: 'admin', status: 'active' },
    });
  });

  it('revoca las sesiones vivas del usuario (un refresh viejo no debe sobrevivir)', async () => {
    const { prisma, calls } = fakePrisma([{ id: 'u1', email: 'yo@casa.local' }]);
    await resetAdmin({ prisma, hash }, { email: 'yo@casa.local', password: 'contrasena1' });
    expect(calls.revoked[0]).toMatchObject({
      where: { userId: 'u1', revoked: false },
      data: { revoked: true },
    });
  });

  it('rechaza email inválido y contraseña floja SIN tocar la base', async () => {
    const { prisma, calls } = fakePrisma();
    await expect(
      resetAdmin({ prisma, hash }, { email: 'nope', password: 'contrasena1' }),
    ).rejects.toThrow(/Email no válido/);
    await expect(
      resetAdmin({ prisma, hash }, { email: 'yo@casa.local', password: 'corta' }),
    ).rejects.toThrow(/al menos 10/);
    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toHaveLength(0);
  });

  it('nunca guarda la contraseña en claro (solo su hash)', async () => {
    const { prisma, calls } = fakePrisma();
    await resetAdmin({ prisma, hash }, { email: 'yo@casa.local', password: 'contrasena1' });
    expect(JSON.stringify(calls.created)).not.toContain('"contrasena1"');
  });
});
