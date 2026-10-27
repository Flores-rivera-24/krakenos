import { describe, expect, it } from 'vitest';
import { secretPermissionsStartupNotice } from '../../src/config/secret-permissions.js';

const ROOT = 'C:\\KrakenOS';
const HOME = 'C:\\Users\\marta';

describe('aviso de secretos en Windows (el instalador de Windows aún no existe)', () => {
  it('en win32 es un warn que nombra la raíz y la salida, sin atribuir nada al instalador', () => {
    const notice = secretPermissionsStartupNotice(
      'win32',
      { stateRoot: ROOT, candidates: [`${ROOT}\\keys`, `${ROOT}\\prisma`] },
      HOME,
    );
    expect(notice).not.toBeNull();
    expect(notice!.message).toContain(ROOT);
    expect(notice!.message).toMatch(/icacls/);
    expect(notice!.message).toMatch(/KRAKENOS_DATA_DIR/);
    expect(notice!.message).toMatch(/perfil/);
    expect(notice!.message).toMatch(/no se ha comprobado/i);
    expect(notice!.message).toMatch(/modos de fichero/);
    expect(notice!.message).not.toMatch(/instalador/i);
  });

  it('con todo dentro de la raíz solo nombra la raíz', () => {
    const notice = secretPermissionsStartupNotice(
      'win32',
      {
        stateRoot: ROOT,
        candidates: [`${ROOT}\\keys`, `${ROOT}\\.env`, `${ROOT}\\data\\backups`, `${ROOT}\\var`],
      },
      HOME,
    );
    expect(notice!.message.match(/C:\\/g)).toHaveLength(1);
  });

  it('nombra las rutas con secretos que caen fuera de la raíz, sin duplicados', () => {
    const notice = secretPermissionsStartupNotice(
      'win32',
      {
        stateRoot: ROOT,
        candidates: ['D:\\claves', 'D:\\claves', 'E:\\copias', `${ROOT}\\var`],
      },
      HOME,
    );
    expect(notice!.message).toContain('D:\\claves');
    expect(notice!.message).toContain('E:\\copias');
    expect(notice!.message.split('D:\\claves')).toHaveLength(2);
    expect(notice!.message).not.toContain(`${ROOT}\\var`);
  });

  it('rutas que solo difieren en mayúsculas cuentan como dentro, y un prefijo parecido no', () => {
    const notice = secretPermissionsStartupNotice(
      'win32',
      { stateRoot: ROOT, candidates: ['c:\\krakenos\\KEYS', 'C:\\KrakenOS-viejo\\keys'] },
      HOME,
    );
    expect(notice!.message).not.toContain('c:\\krakenos');
    expect(notice!.message).toContain('C:\\KrakenOS-viejo\\keys');
  });

  it('no escribe el nombre de usuario: el perfil se muestra como %USERPROFILE%', () => {
    const notice = secretPermissionsStartupNotice(
      'win32',
      {
        stateRoot: 'C:\\Users\\marta\\AppData\\KrakenOS',
        candidates: ['c:\\users\\MARTA\\claves', 'D:\\otra'],
      },
      HOME,
    );
    expect(notice!.message).not.toMatch(/marta/i);
    expect(notice!.message).toContain('%USERPROFILE%\\AppData\\KrakenOS');
    expect(notice!.message).toContain('%USERPROFILE%\\claves');
    expect(notice!.message).toContain('D:\\otra');
  });

  it('en linux y darwin no emite nada', () => {
    const dirs = { stateRoot: ROOT, candidates: [] };
    expect(secretPermissionsStartupNotice('linux', dirs, HOME)).toBeNull();
    expect(secretPermissionsStartupNotice('darwin', dirs, HOME)).toBeNull();
  });
});
