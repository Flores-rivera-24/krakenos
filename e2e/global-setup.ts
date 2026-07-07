import { startServer } from './lib/server.js';

/**
 * Arranca el agente construido (managers mock, DB efímera) una sola vez para toda
 * la suite e2e (US-189). El proceso queda vivo; `global-teardown` lo detiene. El
 * PID y el token de setup se persisten en disco para los specs y el teardown.
 */
export default async function globalSetup(): Promise<void> {
  await startServer();
}
