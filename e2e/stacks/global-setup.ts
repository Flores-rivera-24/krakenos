import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStacks } from './lib/stacks.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Construye la app y levanta los dos stacks (dev y prod) una sola vez para toda
 * la tanda. El build es parte del montaje que se verifica: `pnpm prod` sirve
 * `apps/web/dist`, así que correr contra un `dist` viejo probaría otra cosa.
 * `STACKS_SKIP_BUILD=1` lo salta al iterar en local.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.STACKS_SKIP_BUILD) {
    execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
  }
  await startStacks();
}
