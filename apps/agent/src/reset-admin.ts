/**
 * Recuperación de la cuenta de administrador (US-233 / AUD3-21). Entrypoint
 * **independiente**, como el actualizador: `node dist/reset-admin.js <email> [pass]`.
 *
 * Se ejecuta **en el host**, nunca por HTTP: no hay «he olvidado mi contraseña» en
 * KrakenOS porque no hay nube que lo respalde, y quien tiene acceso al disco ya
 * controla la instancia. Lo que esto evita es la única alternativa que había hasta
 * ahora: escribir un hash bcrypt a mano en SQLite (o quedarse fuera para siempre).
 *
 * Sin contraseña en los argumentos, genera una temporal y la imprime. Cámbiala al
 * entrar (Ajustes → Cuenta).
 */

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { generateAdminPassword, resetAdmin } from './system/admin-reset.js';

const BCRYPT_ROUNDS = 12;

function usage(): void {
  process.stdout.write(
    [
      'Uso: node dist/reset-admin.js <email> [contraseña]',
      '',
      'Crea el administrador o resetea el existente (contraseña, rol admin y cuenta',
      'activa) y revoca sus sesiones. Sin contraseña, genera una temporal y la',
      'imprime. Ejecútalo en el servidor, con el usuario del servicio:',
      '',
      '  sudo -u krakenos node dist/reset-admin.js tu@correo.com',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);
  if (!email || email === '--help' || email === '-h') {
    usage();
    process.exit(email ? 0 : 1);
  }

  const finalPassword = password ?? generateAdminPassword();
  const prisma = new PrismaClient();
  try {
    const result = await resetAdmin(
      { prisma, hash: (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS) },
      { email, password: finalPassword },
    );
    const lines = [
      '',
      result.created
        ? `Administrador creado: ${result.email}`
        : `Administrador reseteado: ${result.email} (rol admin, cuenta activa)`,
    ];
    if (!password) {
      lines.push(`Contraseña temporal: ${finalPassword}`, 'Cámbiala al entrar (Ajustes → Cuenta).');
    }
    if (result.revokedSessions > 0) {
      lines.push(`Sesiones revocadas: ${result.revokedSessions}`);
    }
    lines.push('');
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (err) {
    process.stderr.write(`\nERROR: ${err instanceof Error ? err.message : 'error'}\n\n`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
