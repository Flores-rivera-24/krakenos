import { USER_ROLES } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { navGroupsForRole, mobileNavForRole } from '@/components/layout/nav';
import { ROLE_LABELS, canControlHome } from '@/lib/roles';

/** Roles del hogar en el cliente (US-179) — capa cosmética del servidor. */
describe('lib/roles + nav por rol (US-179)', () => {
  it('canControlHome: admin y member operan; kid/guest/viewer no', () => {
    expect(canControlHome('admin')).toBe(true);
    expect(canControlHome('member')).toBe(true);
    expect(canControlHome('kid')).toBe(false);
    expect(canControlHome('guest')).toBe(false);
    expect(canControlHome('viewer')).toBe(false);
    expect(canControlHome(undefined)).toBe(false);
  });

  it('hay etiqueta humana para todos los roles', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('admin y viewer ven toda la navegación', () => {
    for (const role of ['admin', 'viewer'] as const) {
      expect(navGroupsForRole(role).map((g) => g.label)).toEqual([
        'General',
        'Red',
        'Hogar',
        'Red avanzada',
        'Sistema',
      ]);
    }
  });

  it('member no ve «Red avanzada»; kid/guest ven la UI reducida', () => {
    expect(navGroupsForRole('member').map((g) => g.label)).toEqual([
      'General',
      'Red',
      'Hogar',
      'Sistema',
    ]);
    for (const role of ['kid', 'guest'] as const) {
      const groups = navGroupsForRole(role);
      expect(groups.map((g) => g.label)).toEqual(['General', 'Hogar', 'Sistema']);
      const paths = groups.flatMap((g) => g.items.map((i) => i.to));
      expect(paths).not.toContain('/firewall');
      expect(paths).not.toContain('/connect');
      expect(paths).toContain('/settings'); // su perfil (contraseña, passkeys)
    }
  });

  it('la bottom-nav móvil se filtra al conjunto visible del rol', () => {
    const kid = mobileNavForRole('kid');
    const kidPaths = [...kid.primary, ...kid.secondary].map((i) => i.to);
    expect(kidPaths).not.toContain('/firewall');
    expect(kidPaths).not.toContain('/traffic');
    expect(kidPaths).toContain('/iot');

    const admin = mobileNavForRole('admin');
    expect(admin.primary.map((i) => i.to)).toContain('/traffic');
  });
});
