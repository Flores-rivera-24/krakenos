import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentPaths, resetAgentPathsForTests, resolvePaths } from '../../src/config/paths.js';
import { resolveDbFile } from '../../src/db/database-url.js';
import { defaultBackupDir, defaultMigrationsDir } from '../../src/db/migrate.js';
import { keyPathsFromEnv } from '../../src/crypto/keys.js';

// Rutas absolutas del SO anfitrión (en Windows `resolve('/srv/x')` añade la unidad).
const CWD = resolve('/srv/krakenos/apps/agent');
const DATOS = resolve('/var/lib/krakenos');
const CODIGO = resolve('/opt/krakenos/apps/agent');

describe('resolvePaths (US-280)', () => {
  it('sin variables, el layout es el de siempre relativo al cwd', () => {
    const p = resolvePaths({}, CWD);
    expect(p.dataRoot).toBe(CWD);
    expect(p.appRoot).toBe(CWD);
    expect(p.dataDir).toBe(join(CWD, 'data'));
    expect(p.varDir).toBe(join(CWD, 'var'));
    expect(p.keysDir).toBe(join(CWD, 'keys'));
    expect(p.certsDir).toBe(join(CWD, 'certs'));
    expect(p.prismaDir).toBe(join(CWD, 'prisma'));
    expect(p.migrationsDir).toBe(join(CWD, 'prisma', 'migrations'));
    expect(p.webDistDir).toBe(resolve(CWD, '..', 'web', 'dist'));
    expect(p.repoDir).toBe(resolve(CWD, '..', '..'));
  });

  it('KRAKENOS_DATA_DIR mueve el estado y deja el código donde estaba', () => {
    const p = resolvePaths({ KRAKENOS_DATA_DIR: DATOS }, CWD);
    expect(p.dataDir).toBe(join(DATOS, 'data'));
    expect(p.varDir).toBe(join(DATOS, 'var'));
    expect(p.keysDir).toBe(join(DATOS, 'keys'));
    expect(p.certsDir).toBe(join(DATOS, 'certs'));
    expect(p.prismaDir).toBe(join(DATOS, 'prisma'));
    // el código sigue en el cwd
    expect(p.migrationsDir).toBe(join(CWD, 'prisma', 'migrations'));
    expect(p.webDistDir).toBe(resolve(CWD, '..', 'web', 'dist'));
  });

  it('KRAKENOS_APP_DIR mueve el código y deja el estado donde estaba', () => {
    const p = resolvePaths({ KRAKENOS_APP_DIR: CODIGO }, CWD);
    expect(p.migrationsDir).toBe(join(CODIGO, 'prisma', 'migrations'));
    expect(p.webDistDir).toBe(resolve(CODIGO, '..', 'web', 'dist'));
    expect(p.varDir).toBe(join(CWD, 'var'));
    expect(p.dataDir).toBe(join(CWD, 'data'));
  });

  it('una ruta relativa en la variable se resuelve contra el cwd; una vacía se ignora', () => {
    expect(resolvePaths({ KRAKENOS_DATA_DIR: 'estado' }, CWD).dataRoot).toBe(join(CWD, 'estado'));
    expect(resolvePaths({ KRAKENOS_DATA_DIR: '  ', KRAKENOS_APP_DIR: '' }, CWD).dataRoot).toBe(CWD);
  });

  it('KRAKENOS_REPO_DIR gana sobre el derivado del código', () => {
    const repo = resolve('/srv/otro');
    expect(resolvePaths({ KRAKENOS_REPO_DIR: repo, KRAKENOS_APP_DIR: CODIGO }, CWD).repoDir).toBe(
      repo,
    );
  });
});

describe('consumidores de agentPaths() (US-280)', () => {
  const previo = {
    data: process.env.KRAKENOS_DATA_DIR,
    app: process.env.KRAKENOS_APP_DIR,
    pre: process.env.KRAKENOS_PRE_MIGRATE_DIR,
  };
  const restaurar = (clave: string, valor: string | undefined) => {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  };
  afterEach(() => {
    restaurar('KRAKENOS_DATA_DIR', previo.data);
    restaurar('KRAKENOS_APP_DIR', previo.app);
    restaurar('KRAKENOS_PRE_MIGRATE_DIR', previo.pre);
    resetAgentPathsForTests();
  });

  it('se resuelve una vez: cambiar el entorno después no la mueve hasta el reset', () => {
    process.env.KRAKENOS_DATA_DIR = DATOS;
    resetAgentPathsForTests();
    const a = agentPaths();
    process.env.KRAKENOS_DATA_DIR = resolve('/otro');
    expect(agentPaths()).toBe(a);
    expect(agentPaths().dataRoot).toBe(DATOS);
  });

  it('una DATABASE_URL relativa cuelga de <dataRoot>/prisma; una absoluta, no se toca', () => {
    process.env.KRAKENOS_DATA_DIR = DATOS;
    resetAgentPathsForTests();
    expect(resolveDbFile('file:./dev.db?connection_limit=1')).toBe(join(DATOS, 'prisma', 'dev.db'));
    const absoluta = resolve('/srv/db/app.db');
    expect(resolveDbFile(`file:${absoluta}`)).toBe(absoluta);
  });

  it('sin KRAKENOS_DATA_DIR la base sigue en <cwd>/prisma (Linux y Docker no cambian)', () => {
    delete process.env.KRAKENOS_DATA_DIR;
    resetAgentPathsForTests();
    expect(resolveDbFile('file:./dev.db')).toBe(resolve('prisma', 'dev.db'));
  });

  it('migraciones del código y copia previa del estado; KRAKENOS_PRE_MIGRATE_DIR gana', () => {
    process.env.KRAKENOS_DATA_DIR = DATOS;
    process.env.KRAKENOS_APP_DIR = CODIGO;
    delete process.env.KRAKENOS_PRE_MIGRATE_DIR;
    resetAgentPathsForTests();
    expect(defaultMigrationsDir()).toBe(join(CODIGO, 'prisma', 'migrations'));
    expect(defaultBackupDir()).toBe(join(DATOS, 'var'));
    const volumen = resolve('/data/premigrate');
    process.env.KRAKENOS_PRE_MIGRATE_DIR = volumen;
    expect(defaultBackupDir()).toBe(volumen);
  });

  it('las claves: KRAKENOS_KEYS_DIR > KRAKENOS_DATA_DIR/keys > <agente>/keys', () => {
    const agente = resolve('/opt/agente');
    expect(keyPathsFromEnv({}, agente).privatePath).toBe(join(agente, 'keys', 'jwt-private.pem'));
    expect(keyPathsFromEnv({ KRAKENOS_DATA_DIR: DATOS }, agente).privatePath).toBe(
      join(DATOS, 'keys', 'jwt-private.pem'),
    );
    const keys = resolve('/etc/krakenos/keys');
    expect(
      keyPathsFromEnv({ KRAKENOS_DATA_DIR: DATOS, KRAKENOS_KEYS_DIR: keys }, agente).privatePath,
    ).toBe(join(keys, 'jwt-private.pem'));
  });
});
