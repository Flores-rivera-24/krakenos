import { API_TOKEN_SCOPES, USER_ROLES } from '@krakenos/types';
import type { UserRole } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, can, type Capability } from '../../src/auth/capabilities.js';

/**
 * Matriz rol×capacidad esperada (US-179). Explícita: un cambio accidental falla aquí.
 *
 * `home.cameras` (US-227/AUD3-02) se separa de `home.view` porque enseña el interior
 * de la casa en directo: la tienen admin, member y el viewer adulto de solo lectura;
 * **no** la tienen `kid` ni `guest`.
 *
 * `home.activity` (US-250) se separa por el mismo motivo pero es **solo de admin**:
 * ver a qué dominios habla cada aparato y cuánto consume cada uno es el historial
 * de la familia, y dársela a `member`/`viewer` reabriría por `/traffic/devices` lo
 * que US-184 ya cerró en `/wellbeing/usage` (donde el no-admin ve solo lo suyo).
 */
const EXPECTED: Record<UserRole, Capability[]> = {
  admin: [
    'home.view',
    'home.control',
    'home.cameras',
    'home.activity',
    'network.manage',
    'users.manage',
    'system.manage',
  ],
  member: ['home.view', 'home.control', 'home.cameras'],
  kid: ['home.view'],
  guest: ['home.view'],
  viewer: ['home.view', 'home.cameras'],
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

  it('kid y guest no ven las cámaras (AUD3-02)', () => {
    expect(can('kid', 'home.cameras')).toBe(false);
    expect(can('guest', 'home.cameras')).toBe(false);
    // Y siguen viendo el resto del hogar: la restricción es del vídeo, no general.
    expect(can('kid', 'home.view')).toBe(true);
    expect(can('guest', 'home.view')).toBe(true);
  });

  it('solo admin ve la actividad por aparato (US-250)', () => {
    expect(can('admin', 'home.activity')).toBe(true);
    for (const role of USER_ROLES.filter((r) => r !== 'admin')) {
      expect(can(role, 'home.activity'), `${role} × home.activity`).toBe(false);
      // La restricción es de la actividad, no del hogar: siguen viendo lo demás.
      expect(can(role, 'home.view'), `${role} × home.view`).toBe(true);
    }
  });

  it('ni las cámaras ni la actividad son alcanzables por un token de API', () => {
    // `requireCapability` exige que la capacidad esté entre los `apiScopes` cuando
    // la petición llega con token, así que lo que no esté en esta allowlist es
    // inalcanzable **incluso para un admin**. Atarlo aquí evita que añadir un scope
    // conceda de paso el vídeo o el historial a todos los tokens ya emitidos.
    const scopes: readonly string[] = API_TOKEN_SCOPES;
    expect(scopes).not.toContain('home.cameras');
    expect(scopes).not.toContain('home.activity');
    // Guard de tamaño: si la lista se vaciara, las dos aserciones de arriba pasarían.
    expect(scopes.length).toBeGreaterThanOrEqual(2);
  });
});
