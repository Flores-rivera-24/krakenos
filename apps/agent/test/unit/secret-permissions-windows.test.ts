import { describe, expect, it } from 'vitest';
import {
  checkSecretFilePermissions,
  secretPermissionsStartupNotice,
  SECRET_PERMISSIONS_NOT_APPLICABLE,
} from '../../src/config/secret-permissions.js';

const DIRS = { dataDir: 'C:\\KrakenOS\\data', keysDir: 'C:\\KrakenOS\\keys' };

describe('aviso de secretos en Windows (el instalador de Windows aún no existe)', () => {
  it('en win32 es un warn que nombra las carpetas y la salida, sin atribuir nada al instalador', () => {
    const notice = secretPermissionsStartupNotice('win32', DIRS);
    expect(notice).not.toBeNull();
    expect(notice!.level).toBe('warn');
    expect(notice!.message).toContain(DIRS.dataDir);
    expect(notice!.message).toContain(DIRS.keysDir);
    expect(notice!.message).toMatch(/icacls/);
    expect(notice!.message).toMatch(/perfil/);
    expect(notice!.message).toMatch(/no se ha comprobado/i);
    expect(notice!.message).toMatch(/modos de fichero/);
    expect(notice!.message).not.toMatch(/instalador con ACL/);
  });

  it('en linux y darwin no emite nada', () => {
    expect(secretPermissionsStartupNotice('linux', DIRS)).toBeNull();
    expect(secretPermissionsStartupNotice('darwin', DIRS)).toBeNull();
  });

  it('el texto de «no aplica» ya no dice que lo fija el instalador', () => {
    expect(SECRET_PERMISSIONS_NOT_APPLICABLE).not.toMatch(/instalador/);
  });

  it('en linux el chequeo de modos devuelve los mismos avisos', () => {
    const stat = (p: string): number | null => (p === '/k/.env' ? 0o100644 : 0o100600);
    expect(checkSecretFilePermissions(['/k/.env', '/k/key.pem'], stat, 'linux')).toEqual([
      { path: '/k/.env', mode: '644' },
    ]);
  });
});
