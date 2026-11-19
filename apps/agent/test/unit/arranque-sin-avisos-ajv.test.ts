import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/server.js';

describe('arranque del servidor real', () => {
  afterEach(() => vi.restoreAllMocks());

  it('construir el servidor no deja avisos de Ajv por tipos unión', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = await buildServer({
      setupTokenFile: join(mkdtempSync(join(tmpdir(), 'krakenos-setup-')), 'setup-token'),
    });
    await app.ready();
    await app.close();
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/allowUnionTypes/);
  });
});
