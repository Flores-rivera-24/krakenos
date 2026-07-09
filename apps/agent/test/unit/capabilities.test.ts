import { USER_ROLES } from '@krakenos/types';
import type { UserRole } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, can, type Capability } from '../../src/auth/capabilities.js';

/** Matriz rol×capacidad esperada (US-179). Explícita: un cambio accidental falla aquí. */
const EXPECTED: Record<UserRole, Capability[]> = {
  admin: ['home.view', 'home.control', 'network.manage', 'users.manage', 'system.manage'],
  member: ['home.view', 'home.control'],
  kid: ['home.view'],
  guest: ['home.view'],
  viewer: ['home.view'],
};

describe('auth/capabilities (US-179)', () => {
  it('la matriz rol×capacidad es exactamente la esperada', () => {
    for (const role of USER_ROLES) {
      for (const cap of CAPABILITIES) {
        expect(can(role, cap), `${role} × ${cap}`).toBe(EXPECTED[role].includes(cap));
      }
    }
  });

  it('no-escalada: ningún rol no-admin gestiona red, usuarios ni sistema', () => {
    for (const role of USER_ROLES.filter((r) => r !== 'admin')) {
      expect(can(role, 'network.manage')).toBe(false);
      expect(can(role, 'users.manage')).toBe(false);
      expect(can(role, 'system.manage')).toBe(false);
    }
  });

  it('un rol desconocido (dato legado en DB) no puede nada', () => {
    expect(can('superadmin' as UserRole, 'home.view')).toBe(false);
  });
});
