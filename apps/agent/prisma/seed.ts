import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Crea un usuario admin inicial para desarrollo. */
async function main(): Promise<void> {
  const email = 'admin@krakenos.local';
  const password = 'changeme123';
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, displayName: 'Administrador', passwordHash, role: 'admin' },
  });

  console.log(`Usuario admin listo: ${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
