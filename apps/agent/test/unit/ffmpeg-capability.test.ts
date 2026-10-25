import { describe, expect, it } from 'vitest';
import { FfmpegRequiresSetupError, ffmpegSetupStep } from '../../src/cameras/ffmpeg-capability.js';
import { RtspCameraManager } from '../../src/cameras/rtsp.cameras.js';

/** US-280: un paquete no trae ffmpeg; sin él las cámaras RTSP lo dicen y dicen qué hacer. */
describe('ffmpegSetupStep', () => {
  const hay = () => true;
  const noHay = () => false;

  it('con una ruta explícita que existe → null (no falta nada)', () => {
    expect(
      ffmpegSetupStep({ ffmpegPath: 'C:\\ffmpeg\\ffmpeg.exe', platform: 'win32', exists: hay }),
    ).toBeNull();
  });

  it('con una ruta explícita que no existe → el paso nombra FFMPEG_PATH pero NO la ruta (la ve un viewer)', () => {
    const step = ffmpegSetupStep({
      ffmpegPath: 'C:\\ffmpeg\\ffmpeg.exe',
      platform: 'win32',
      exists: noHay,
    });
    expect(step).toContain('FFMPEG_PATH');
    expect(step).not.toContain('C:\\ffmpeg');
  });

  it('en Windows manda reiniciar el servicio: FFMPEG_PATH y el PATH se leen al arrancar', () => {
    const step = ffmpegSetupStep({
      ffmpegPath: 'ffmpeg',
      platform: 'win32',
      env: { PATH: 'C:\\x', PATHEXT: '.EXE' },
      exists: noHay,
    });
    expect(step).toMatch(/reinicia/i);
    expect(step).not.toMatch(/no hace falta reiniciar/i);
  });

  it('en Docker no recomienda apt: dice que la imagen no lo trae y qué alternativa hay', () => {
    const step = ffmpegSetupStep({
      ffmpegPath: 'ffmpeg',
      platform: 'linux',
      deployMode: 'docker',
      env: { PATH: '/usr/bin' },
      exists: noHay,
    });
    expect(step).not.toContain('apt');
    expect(step).toMatch(/imagen de Docker/);
    expect(step).toMatch(/Frigate/);
  });

  it('nombre suelto: lo busca en el PATH (en Windows, con las extensiones de PATHEXT)', () => {
    const visto: string[] = [];
    const exists = (p: string) => {
      visto.push(p);
      return p === 'C:\\tools\\ffmpeg.EXE';
    };
    expect(
      ffmpegSetupStep({
        ffmpegPath: 'ffmpeg',
        platform: 'win32',
        env: { PATH: 'C:\\x;C:\\tools', PATHEXT: '.COM;.EXE' },
        exists,
      }),
    ).toBeNull();
    expect(visto).toContain('C:\\x\\ffmpeg.COM');
  });

  it('nombre suelto que no está en el PATH → paso con la instalación (Windows)', () => {
    const step = ffmpegSetupStep({
      ffmpegPath: 'ffmpeg',
      platform: 'win32',
      env: { PATH: 'C:\\x', PATHEXT: '.EXE' },
      exists: noHay,
    });
    expect(step).toContain('ffmpeg.exe');
    expect(step).toContain('FFMPEG_PATH');
  });

  it('en Linux sugiere el paquete del sistema', () => {
    const step = ffmpegSetupStep({
      ffmpegPath: 'ffmpeg',
      platform: 'linux',
      env: { PATH: '/usr/bin:/bin' },
      exists: noHay,
    });
    expect(step).toContain('apt install ffmpeg');
  });

  it('con la plataforma inyectada, «ruta» la decide esa plataforma y no el sistema que corre el test', () => {
    // `C:\\…` no es una ruta en Linux (no hay barra ni empieza por «/»): se busca en el PATH.
    // Con el `isAbsolute` nativo, en Windows esto se tomaría por ruta y devolvería null.
    expect(
      ffmpegSetupStep({
        ffmpegPath: 'C:\\ffmpeg\\ffmpeg.exe',
        platform: 'linux',
        env: { PATH: '/usr/bin' },
        exists: (p) => p === 'C:\\ffmpeg\\ffmpeg.exe',
      }),
    ).not.toBeNull();
  });

  it('en Linux lo encuentra en el PATH', () => {
    expect(
      ffmpegSetupStep({
        ffmpegPath: 'ffmpeg',
        platform: 'linux',
        env: { PATH: '/usr/bin:/opt/b' },
        exists: (p) => p === '/opt/b/ffmpeg',
      }),
    ).toBeNull();
  });
});

describe('RtspCameraManager sin ffmpeg', () => {
  const camaras = [{ id: 'c1', name: 'Entrada', rtspUrl: 'rtsp://10.0.0.5/s' }];
  const base = {
    cameras: camaras,
    exec: async () => ({ stdout: Buffer.from([1]), code: 0 }),
    hls: { baseDir: '/tmp/hls-x' },
  };

  it('getSnapshot lanza FFMPEG_REQUIRES_SETUP (503) con el paso, sin lanzar ffmpeg', async () => {
    let lanzado = false;
    const m = new RtspCameraManager({
      ...base,
      exec: async () => {
        lanzado = true;
        return { stdout: Buffer.from([1]), code: 0 };
      },
      ffmpegSetup: () => 'Instala ffmpeg y fija FFMPEG_PATH.',
    });
    const err = await m.getSnapshot('c1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FfmpegRequiresSetupError);
    expect(err).toMatchObject({
      statusCode: 503,
      code: 'FFMPEG_REQUIRES_SETUP',
    });
    expect((err as Error).message).toContain('Instala ffmpeg y fija FFMPEG_PATH.');
    expect(lanzado).toBe(false);
  });

  it('startStream también lo declara', async () => {
    const m = new RtspCameraManager({ ...base, ffmpegSetup: () => 'paso' });
    await expect(m.startStream('c1')).rejects.toBeInstanceOf(FfmpegRequiresSetupError);
  });

  it('se reevalúa en cada llamada: al instalarlo ya no declara nada', async () => {
    let paso: string | null = 'paso';
    const m = new RtspCameraManager({ ...base, ffmpegSetup: () => paso });
    await expect(m.getSnapshot('c1')).rejects.toBeInstanceOf(FfmpegRequiresSetupError);
    paso = null;
    expect((await m.getSnapshot('c1'))?.cameraId).toBe('c1');
  });
});
