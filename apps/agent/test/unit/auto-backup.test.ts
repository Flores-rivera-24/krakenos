import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import {
  AutoBackupService,
  autoBackupDue,
  generateBackupPassphrase,
} from '../../src/modules/system/auto-backup.service.js';
import type { BackupService } from '../../src/system/backup.service.js';

/**
 * Copias de seguridad automáticas (US-233 / AUD3-21).
 *
 * El agujero: la única copia era el botón manual. En un aparato 24/7 sobre una SD
 * —el fallo de hardware más probable— eso es pérdida total salvo que el usuario se
 * acordara de pulsarlo. Lo que atan estos tests: que la copia se hace, que la
 * retención poda **solo lo nuestro**, que un fallo se cuenta en vez de perderse, y
 * que la UI puede decir «no hay copia reciente» (`stale`).
 */

/** `Setting` en memoria: el servicio solo usa findUnique + upsert. */
function fakePrisma(rows: Record<string, string> = {}): PrismaClient {
  return {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key in rows ? { key: where.key, value: rows[where.key] } : null,
      upsert: async ({
        where,
        update,
      }: {
        where: { key: string };
        update: { value: string };
      }) => {
        rows[where.key] = update.value;
        return { key: where.key, value: update.value };
      },
    },
  } as unknown as PrismaClient;
}

/** BackupService falso: escribe un fichero con el nombre pedido. */
function fakeBackupService(onCreate?: () => void): BackupService {
  return {
    createToFile: vi.fn(async (_pass: string, dest: string) => {
      onCreate?.();
      writeFileSync(dest, 'ARCHIVO-CIFRADO');
      return { path: dest, bytes: 15 };
    }),
  } as unknown as BackupService;
}

function make(opts: { rows?: Record<string, string>; onCreate?: () => void; now?: Date } = {}) {
  const rows = opts.rows ?? {};
  const backupDir = join(mkdtempSync(join(tmpdir(), 'krakenos-auto-')), 'backups');
  const warn = vi.fn();
  const service = new AutoBackupService({
    prisma: fakePrisma(rows),
    secretbox: createSecretbox(generateSecretboxKey()),
    backupService: fakeBackupService(opts.onCreate),
    backupDir,
    now: () => opts.now ?? new Date('2026-07-29T03:30:00.000Z'),
    warn,
  });
  return { service, backupDir, rows, warn };
}

const D = (iso: string) => new Date(iso);

describe('autoBackupDue', () => {
  it('desactivada nunca dispara', () => {
    expect(autoBackupDue('off', D('2026-07-29T02:59:00'), D('2026-07-29T03:01:00'))).toBe(false);
  });

  it('diaria dispara al CRUZAR las 03:00 (una sola vez)', () => {
    expect(autoBackupDue('daily', D('2026-07-29T02:59:00'), D('2026-07-29T03:01:00'))).toBe(true);
    // Un barrido posterior el mismo día ya no cruza.
    expect(autoBackupDue('daily', D('2026-07-29T03:01:00'), D('2026-07-29T04:01:00'))).toBe(false);
  });

  it('semanal solo dispara el lunes', () => {
    // 2026-07-27 es lunes; el 29 es miércoles.
    expect(autoBackupDue('weekly', D('2026-07-27T02:59:00'), D('2026-07-27T03:01:00'))).toBe(true);
    expect(autoBackupDue('weekly', D('2026-07-29T02:59:00'), D('2026-07-29T03:01:00'))).toBe(false);
  });

  it('un barrido perdido de varias horas dispara una vez, no una por hora', () => {
    expect(autoBackupDue('daily', D('2026-07-29T01:00:00'), D('2026-07-29T06:00:00'))).toBe(true);
  });
});

describe('generateBackupPassphrase', () => {
  it('genera contraseñas largas, distintas y sin caracteres problemáticos', () => {
    const a = generateBackupPassphrase();
    const b = generateBackupPassphrase();
    expect(a).not.toBe(b);
    // Suficientemente larga para el mínimo del formato (12) con mucho margen.
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('AutoBackupService', () => {
  it('sin contraseña no hace copia y lo DICE (no falla en silencio)', async () => {
    const { service, backupDir } = make({ rows: { autoBackupFrequency: 'daily' } });
    const status = await service.runNow();
    expect(status.lastError).toMatch(/contraseña/i);
    expect(status.count).toBe(0);
    expect(existsSync(backupDir)).toBe(false);
  });

  it('con contraseña escribe la copia y la cuenta en el estado', async () => {
    const { service, backupDir } = make({ rows: { autoBackupFrequency: 'daily' } });
    await service.setPassphrase();
    const status = await service.runNow();

    expect(status.lastError).toBeNull();
    expect(status.count).toBe(1);
    expect(status.passphraseSet).toBe(true);
    expect(status.lastBackupAt).not.toBeNull();
    expect(readdirSync(backupDir)).toHaveLength(1);
    expect(readdirSync(backupDir)[0]).toMatch(/^krakenos-backup-.*\.kbk$/);
  });

  it('la contraseña se guarda CIFRADA (no en claro en Setting)', async () => {
    const { service, rows } = make();
    const { generated } = await service.setPassphrase();
    expect(generated).toBeTruthy();
    const stored = rows['backup.autoPassphrase']!;
    expect(stored).not.toContain(generated!);
    expect(stored.startsWith('kbx1.')).toBe(true);
    // Y se puede recuperar (una copia que nadie puede descifrar no es una copia).
    expect(await service.revealPassphrase()).toBe(generated);
  });

  it('una contraseña fijada por el admin no se devuelve como «generada»', async () => {
    const { service } = make();
    expect(await service.setPassphrase('la-mia-larga-1')).toEqual({ generated: null });
    expect(await service.revealPassphrase()).toBe('la-mia-larga-1');
  });

  it('si la contraseña guardada no se puede descifrar, avisa y no revienta', async () => {
    const { service, warn } = make({ rows: { 'backup.autoPassphrase': 'kbx1.basura.basura.basura' } });
    const status = await service.runNow();
    expect(warn).toHaveBeenCalled();
    expect(status.lastError).toMatch(/contraseña/i);
  });

  it('la retención poda las copias más viejas y deja las N más recientes', async () => {
    const { service, backupDir } = make({ rows: { autoBackupRetention: '3' } });
    mkdirSync(backupDir, { recursive: true });
    for (const day of ['20', '21', '22', '23', '24']) {
      writeFileSync(join(backupDir, `krakenos-backup-2026-07-${day}T03-00-00-000Z.kbk`), 'x');
    }
    expect(await service.prune()).toBe(2);
    const left = readdirSync(backupDir).sort();
    expect(left).toEqual([
      'krakenos-backup-2026-07-22T03-00-00-000Z.kbk',
      'krakenos-backup-2026-07-23T03-00-00-000Z.kbk',
      'krakenos-backup-2026-07-24T03-00-00-000Z.kbk',
    ]);
  });

  it('la poda NO toca ficheros que no haya creado KrakenOS', async () => {
    const { service, backupDir } = make({ rows: { autoBackupRetention: '1' } });
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, 'krakenos-backup-2026-07-20T03-00-00-000Z.kbk'), 'x');
    writeFileSync(join(backupDir, 'krakenos-backup-2026-07-21T03-00-00-000Z.kbk'), 'x');
    writeFileSync(join(backupDir, 'copia-manual-de-mi-tio.kbk'), 'x');
    writeFileSync(join(backupDir, 'notas.txt'), 'x');

    await service.prune();
    const left = readdirSync(backupDir).sort();
    expect(left).toContain('copia-manual-de-mi-tio.kbk');
    expect(left).toContain('notas.txt');
    expect(left).toContain('krakenos-backup-2026-07-21T03-00-00-000Z.kbk');
    expect(left).not.toContain('krakenos-backup-2026-07-20T03-00-00-000Z.kbk');
  });

  it('marca `stale` sin copias, lo quita con una fresca y lo vuelve a marcar si envejece', async () => {
    // Reloj mutable: la señal `stale` depende de la EDAD de la copia más reciente.
    //
    // ⚠️ El reloj inyectado NO controla la mitad del cálculo: la edad se mide contra
    // el **mtime real** del fichero (`listBackups` lo lee del disco), así que el
    // «ahora» del test tiene que ir referido al reloj real y no a una fecha fija.
    // Con fechas absolutas el test caducaba: pasaba mientras el calendario iba por
    // detrás de ellas y empezaba a fallar solo al alcanzarlas (2026-07-30).
    let now = new Date(Date.now());
    const backupDir = join(mkdtempSync(join(tmpdir(), 'krakenos-auto-')), 'backups');
    const service = new AutoBackupService({
      prisma: fakePrisma({ autoBackupFrequency: 'daily' }),
      secretbox: createSecretbox(generateSecretboxKey()),
      backupService: fakeBackupService(),
      backupDir,
      now: () => now,
    });

    // Sin ninguna copia y con la función activada: stale (es el aviso de la UI).
    expect((await service.getStatus()).stale).toBe(true);

    await service.setPassphrase();
    await service.runNow();
    expect((await service.getStatus()).stale).toBe(false);

    // Cinco días después, esa misma copia ya no vale como reciente.
    now = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const aged = await service.getStatus();
    expect(aged.count).toBe(1);
    expect(aged.stale).toBe(true);
  });

  it('en semanal el margen es más ancho que en diaria', async () => {
    const backupDir = join(mkdtempSync(join(tmpdir(), 'krakenos-auto-')), 'backups');
    // Referido al reloj real por lo mismo que el test de arriba: la edad se mide
    // contra el mtime del fichero, que lo pone el sistema de archivos.
    let now = new Date(Date.now());
    const rows: Record<string, string> = { autoBackupFrequency: 'daily' };
    const service = new AutoBackupService({
      prisma: fakePrisma(rows),
      secretbox: createSecretbox(generateSecretboxKey()),
      backupService: fakeBackupService(),
      backupDir,
      now: () => now,
    });
    await service.setPassphrase();
    await service.runNow();

    // A los 3 días: en diaria ya es vieja…
    now = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect((await service.getStatus()).stale).toBe(true);
    // …pero en semanal todavía no.
    rows.autoBackupFrequency = 'weekly';
    expect((await service.getStatus()).stale).toBe(false);
  });

  it('desactivada nunca marca `stale` (no hay nada que reprochar)', async () => {
    const { service } = make({ rows: { autoBackupFrequency: 'off' } });
    expect((await service.getStatus()).stale).toBe(false);
  });

  it('dos disparos solapados no escriben dos copias (single-flight)', async () => {
    let creates = 0;
    const { service } = make({ onCreate: () => (creates += 1) });
    await service.setPassphrase();
    await Promise.all([service.runNow(), service.runNow()]);
    expect(creates).toBe(1);
  });

  it('el primer barrido fija la base y NO lanza copias atrasadas', async () => {
    const { service, backupDir } = make({ rows: { autoBackupFrequency: 'daily' } });
    await service.setPassphrase();
    await service.tick(D('2026-07-29T03:30:00'));
    expect(existsSync(backupDir)).toBe(false);

    // El siguiente barrido que cruza las 03:00 sí copia.
    await service.tick(D('2026-07-30T02:59:00'));
    await service.tick(D('2026-07-30T03:01:00'));
    expect(readdirSync(backupDir)).toHaveLength(1);
  });
});
