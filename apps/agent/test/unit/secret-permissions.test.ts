import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkSecretFilePermissions,
  isGroupOrWorldAccessible,
} from '../../src/config/secret-permissions.js';

describe('secret-permissions (US-79, F8)', () => {
  it('isGroupOrWorldAccessible detecta bits de grupo/otros', () => {
    expect(isGroupOrWorldAccessible(0o600)).toBe(false);
    expect(isGroupOrWorldAccessible(0o400)).toBe(false);
    expect(isGroupOrWorldAccessible(0o640)).toBe(true); // lectura de grupo
    expect(isGroupOrWorldAccessible(0o604)).toBe(true); // lectura de otros
    expect(isGroupOrWorldAccessible(0o644)).toBe(true);
    expect(isGroupOrWorldAccessible(0o660)).toBe(true);
  });

  it('avisa solo de los ficheros accesibles por grupo/otros (stat inyectado)', () => {
    const modes: Record<string, number> = {
      '/secrets/.env': 0o644,
      '/secrets/key.pem': 0o600,
    };
    const stat = (p: string): number | null => modes[p] ?? null;
    const warnings = checkSecretFilePermissions(['/secrets/.env', '/secrets/key.pem'], stat);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toBe('/secrets/.env');
    expect(warnings[0]!.mode).toBe('644');
  });

  it('ignora ficheros inexistentes (stat → null)', () => {
    const warnings = checkSecretFilePermissions(['/no/existe'], () => null);
    expect(warnings).toEqual([]);
  });

  describe('contra el sistema de ficheros real', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'kraken-secrets-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('no avisa de un fichero 0600 y sí de uno 0644', () => {
      const tight = join(dir, 'tight.env');
      const loose = join(dir, 'loose.env');
      writeFileSync(tight, 'SECRET=1');
      writeFileSync(loose, 'SECRET=1');
      chmodSync(tight, 0o600);
      chmodSync(loose, 0o644);

      const warnings = checkSecretFilePermissions([tight, loose]);
      const paths = warnings.map((w) => w.path);
      expect(paths).toContain(loose);
      expect(paths).not.toContain(tight);
    });
  });
});
