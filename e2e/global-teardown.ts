import { stopServer } from './lib/server.js';

/** Detiene el agente e2e al terminar la suite (US-189). */
export default async function globalTeardown(): Promise<void> {
  stopServer();
}
