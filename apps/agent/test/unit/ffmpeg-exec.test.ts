import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock, spawn: vi.fn() }));

import { createFfmpegExec, MOTION_FRAME_TIMEOUT_MS } from '../../src/cameras/ffmpeg.js';

/**
 * US-229 / AUD3-18: el `timeout` de `execFile` mata con **SIGTERM** por defecto,
 * y ffmpeg lo **ignora** mientras espera un stream RTSP que no responde. Es decir:
 * el timeout no cerraba nada y el proceso seguía vivo mientras el barrido de
 * movimiento (cada 5 s) lanzaba el siguiente. El spawner de streaming ya usaba
 * SIGKILL por esta misma razón; el exec de un disparo no.
 */
describe('createFfmpegExec (US-229)', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: null, out: Buffer) => void) => {
        cb(null, Buffer.alloc(0));
      },
    );
  });

  /** Ejecuta y devuelve las opciones con las que se invocó `execFile`. */
  async function optsOf(exec: ReturnType<typeof createFfmpegExec>): Promise<Record<string, unknown>> {
    await exec(['-i', 'rtsp://camara']);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const call = execFileMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    return call[2];
  }

  it('mata con SIGKILL al agotarse el timeout (ffmpeg ignora SIGTERM en RTSP)', async () => {
    const opts = await optsOf(createFfmpegExec('ffmpeg'));

    expect(opts.killSignal).toBe('SIGKILL');
    expect(opts.timeout).toBe(10_000);
  });

  it('el fotograma de movimiento usa un timeout por debajo del barrido de 5 s', async () => {
    // Con el default de 10 s, el ciclo tardaba el doble que su propio intervalo.
    expect(MOTION_FRAME_TIMEOUT_MS).toBeLessThan(5_000);

    const opts = await optsOf(createFfmpegExec('ffmpeg', MOTION_FRAME_TIMEOUT_MS));

    expect(opts.timeout).toBe(MOTION_FRAME_TIMEOUT_MS);
    expect(opts.killSignal).toBe('SIGKILL');
  });
});
