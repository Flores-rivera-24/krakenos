import 'dotenv/config';
import { env } from './config/env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Recibido ${signal}, cerrando…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.port, host: env.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
