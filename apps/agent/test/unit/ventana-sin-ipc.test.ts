import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const TAURI = resolve(ROOT, 'apps/window/src-tauri');
const leer = (ruta: string) => readFileSync(ruta, 'utf8');

/**
 * La ventana de Windows carga la web del agente (contenido remoto): ese contenido no
 * debe poder llamar a Tauri. Sin `withGlobalTauri`, sin capability `remote` y con
 * permisos solo para la ventana `main` y lo que usa el Rust.
 */
describe('ventana de Windows: la web del agente no tiene IPC de Tauri', () => {
  // Tauri carga también .json5 y .toml de esa carpeta: se lista TODO y solo vale .json.
  const todo = existsSync(resolve(TAURI, 'capabilities'))
    ? readdirSync(resolve(TAURI, 'capabilities'))
    : [];
  const capabilities = todo.filter((f) => f.endsWith('.json'));

  it('hay capabilities que leer (guard de tamaño)', () => {
    expect(capabilities.length).toBeGreaterThan(0);
  });

  it('en capabilities/ solo hay .json (Tauri también carga .json5 y .toml)', () => {
    expect(todo.filter((f) => !f.endsWith('.json'))).toEqual([]);
  });

  it('tauri.conf.json no declara capabilities en línea', () => {
    const conf = JSON.parse(leer(resolve(TAURI, 'tauri.conf.json')));
    expect(conf.app.security?.capabilities).toBeUndefined();
  });

  it('no hay configuración por plataforma ni Tauri.toml que Tauri fusione', () => {
    const raros = readdirSync(TAURI).filter(
      (f) => /^tauri\..+\.conf\./i.test(f) || /^tauri\.toml$/i.test(f),
    );
    expect(raros).toEqual([]);
  });

  it('withGlobalTauri es false', () => {
    const conf = JSON.parse(leer(resolve(TAURI, 'tauri.conf.json')));
    expect(conf.app.withGlobalTauri).toBe(false);
  });

  it('ninguna capability tiene remote y solo apuntan a la ventana main', () => {
    for (const f of capabilities) {
      const cap = JSON.parse(leer(resolve(TAURI, 'capabilities', f)));
      expect(cap.remote, f).toBeUndefined();
      expect(cap.webviews, f).toBeUndefined();
      expect(cap.windows, f).toEqual(['main']);
    }
  });

  it('las capabilities no dan permisos a la web (solo core:default)', () => {
    for (const f of capabilities) {
      const cap = JSON.parse(leer(resolve(TAURI, 'capabilities', f)));
      expect(cap.permissions, f).toEqual([]);
    }
  });

  it('la página local no importa @tauri-apps', () => {
    expect(leer(resolve(ROOT, 'apps/window/pagina/index.html'))).not.toContain('@tauri-apps');
  });

  it('la página local lleva la CSP exacta y no carga scripts ajenos', () => {
    const html = leer(resolve(ROOT, 'apps/window/pagina/index.html'));
    expect(html).toContain(
      `content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self'"`,
    );
  });

  it('.gitignore ancla /apps/window/src-tauri/target/', () => {
    expect(leer(resolve(ROOT, '.gitignore')).split('\n')).toContain(
      '/apps/window/src-tauri/target/',
    );
  });

  describe('la página local no afirma nada antes de medir', () => {
    const app = leer(resolve(ROOT, 'apps/window/pagina/app.js'));
    const main = leer(resolve(TAURI, 'src/main.rs'));
    const ESTADOS = ['no-responde', 'no-listo', 'sin-configurar', 'certificado'];

    /** Ejecuta app.js con un DOM mínimo y devuelve lo que pinta. */
    function pintar(search: string, language: string) {
      const els: Record<string, { textContent: string }> = {
        titulo: { textContent: 'KrakenOS' },
        detalle: { textContent: '' },
        reintento: { textContent: '' },
      };
      vm.runInNewContext(app, {
        URLSearchParams,
        location: { search },
        navigator: { language },
        document: { documentElement: {}, getElementById: (id: string) => els[id] },
      });
      return {
        titulo: els.titulo!.textContent,
        detalle: els.detalle!.textContent,
        reintento: els.reintento!.textContent,
      };
    }

    it('el Rust arranca la ventana con el estado neutro y sin reintento', () => {
      expect(main).toContain('const ESTADO_INICIAL: &str = "inicial";');
      expect(main).toMatch(/ESTADO_INICIAL\s*\} else \{\s*"sin-configurar"/);
      expect(main).toContain('format!("index.html?estado={estado_inicial}")');
    });

    for (const idioma of ['es', 'en']) {
      it(`el estado inicial (${idioma}) solo pinta la marca: sin detalle, sin reintento, sin ningún título de estado`, () => {
        const titulos = ESTADOS.map((e) => pintar(`?estado=${e}&reintento=2`, idioma).titulo);
        for (const q of ['?estado=inicial&reintento=2', '?estado=inicial', '', '?estado=raro']) {
          expect(pintar(q, idioma)).toEqual({ titulo: 'KrakenOS', detalle: '', reintento: '' });
        }
        for (const t of titulos) expect(t).not.toBe('KrakenOS');
      });
    }
  });
});

/**
 * El job `ventana` de la CI es lo único que compila la ventana fuera del Windows del dueño:
 * si pierde `cargo test`, el clippy estricto o la versión exacta de Rust, nadie lo nota.
 */
describe('ci.yml compila la ventana y corre cargo test', () => {
  const ci = leer(resolve(ROOT, '.github/workflows/ci.yml'));
  const m = /^ {2}ventana:\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\n|(?![\s\S]))/m.exec(ci);
  const job = m?.[1] ?? '';
  const version = /channel\s*=\s*"([^"]+)"/.exec(leer(resolve(TAURI, 'rust-toolchain.toml')))?.[1];

  it('ci.yml compila la ventana y corre cargo test', () => {
    expect(job, 'falta el job `ventana`').not.toBe('');
    expect(job).toMatch(/runs-on:\s*windows-latest/);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    // la misma versión exacta que fija rust-toolchain.toml
    expect(job).toContain(`rustup toolchain install ${version}`);
    expect(job).toMatch(/cargo fmt --check/);
    expect(job).toMatch(/cargo test --locked/);
    expect(job).toMatch(/cargo clippy --locked -- -D warnings/);
    expect(job).toMatch(/tauri build --no-bundle/);
    expect(job).toMatch(/hashFiles\('apps\/window\/src-tauri\/Cargo\.lock'\)/);
    expect(job).toMatch(/upload-artifact@v\d+[\s\S]*retention-days:\s*7/);
    // bloquea: ya pasó las pasadas verdes en main
    expect(job).not.toMatch(/continue-on-error/);
  });

  it('el job solo usa las acciones que ya usa el resto del workflow, a un tag mayor', () => {
    expect(job).not.toBe('');
    const fuera = [...job.matchAll(/uses:\s*(\S+)/g)]
      .map((x) => x[1] as string)
      .filter((u) => !/^(actions|pnpm)\/[\w-]+@v\d+$/.test(u));
    expect(fuera).toEqual([]);
  });
});

describe('ventana de Windows: el sufijo del user agent', () => {
  it('el sufijo del user agent coincide entre la ventana y la web', () => {
    const rust = leer(resolve(TAURI, 'src/agente_web.rs')).match(/format!\("(\w+)\/\{version\}"\)/);
    const web = leer(resolve(ROOT, 'apps/web/src/lib/desktop-window.ts')).match(/\/\\b(\w+)\\\/\//);
    expect(rust, 'literal del sufijo en agente_web.rs').not.toBeNull();
    expect(web, 'regex del sufijo en desktop-window.ts').not.toBeNull();
    expect(rust?.[1], 'sufijo en agente_web.rs').toBe('KrakenOSWindow');
    expect(web?.[1], 'sufijo en desktop-window.ts (debe coincidir con agente_web.rs)').toBe(
      rust?.[1],
    );
  });
});
