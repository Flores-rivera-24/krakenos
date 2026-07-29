import { describe, expect, it } from 'vitest';
import { readStorageInfo } from '../../src/system/storage.js';

/**
 * Gauges de disco y tamaño de la base (US-233 / AUD3-21). Nada medía el espacio
 * libre, que es el fallo más probable de un aparato que vive sobre una SD: cuando se
 * llena, SQLite deja de escribir, la auditoría se pierde y la copia de seguridad no
 * se puede crear — todo a la vez y sin ninguna señal previa.
 */
describe('readStorageInfo', () => {
  const fsOk = { bsize: 4096, blocks: 1_000_000, bavail: 250_000 };

  it('suma el fichero principal y su WAL (con WAL, la base son los dos)', async () => {
    const info = await readStorageInfo('/data/app.db', {
      statfs: async () => fsOk,
      stat: async (path) => ({ size: path.endsWith('-wal') ? 3_000 : 10_000 }),
    });
    expect(info.dbBytes).toBe(13_000);
  });

  it('sin WAL cuenta solo el fichero principal', async () => {
    const info = await readStorageInfo('/data/app.db', {
      statfs: async () => fsOk,
      stat: async (path) => {
        if (path.endsWith('-wal')) throw new Error('ENOENT');
        return { size: 10_000 };
      },
    });
    expect(info.dbBytes).toBe(10_000);
  });

  it('calcula libre, total y porcentaje usado', async () => {
    const info = await readStorageInfo('/data/app.db', {
      statfs: async () => fsOk,
      stat: async () => ({ size: 0 }),
    });
    expect(info.diskTotalBytes).toBe(4096 * 1_000_000);
    expect(info.diskFreeBytes).toBe(4096 * 250_000);
    expect(info.diskUsedPercent).toBe(75);
  });

  it('lo que no se puede medir sale como null, sin lanzar', async () => {
    const info = await readStorageInfo('/data/app.db', {
      statfs: async () => {
        throw new Error('ENOSYS');
      },
      stat: async () => {
        throw new Error('EACCES');
      },
    });
    expect(info).toEqual({
      dbBytes: null,
      diskFreeBytes: null,
      diskTotalBytes: null,
      diskUsedPercent: null,
    });
  });

  it('un total de 0 no produce una división absurda', async () => {
    const info = await readStorageInfo('/data/app.db', {
      statfs: async () => ({ bsize: 4096, blocks: 0, bavail: 0 }),
      stat: async () => ({ size: 1 }),
    });
    expect(info.diskUsedPercent).toBeNull();
  });

  it('mide el disco real de este proceso sin lanzar', async () => {
    const info = await readStorageInfo(process.cwd());
    // `cwd` es un directorio, no un fichero: dbBytes puede ser cualquier cosa, pero
    // el disco sí debe medirse en un sistema normal.
    expect(info.diskTotalBytes).toBeGreaterThan(0);
    expect(info.diskUsedPercent).not.toBeNull();
  });
});
