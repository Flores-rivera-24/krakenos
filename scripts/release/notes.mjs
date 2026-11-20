/**
 * `node scripts/release/notes.mjs <ref> <versión> <carpeta-release> > notes.md`: notas de la versión
 * generadas de los commits convencionales entre la versión anterior y <ref>, más la tabla de
 * descargas sacada de lo que hay de verdad en la carpeta (no puede desfasarse de lo adjunto).
 *
 * El generador NO traduce: los commits están en es-MX. La release se crea como BORRADOR y el dueño
 * la revisa antes de publicarla; por eso el texto de salida no lo dice.
 * Sin versión anterior sale con 1 (nunca «todo el historial»).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Cualquier guion (ASCII o tipográfico) cuenta: `US‑12` con guion no rompible también es un id interno.
const HYPHEN = '[-‐-―−]';
const ID = new RegExp(`\\bUS${HYPHEN}\\d+\\w*`, 'gi');
const REF_ISSUE = /(?:\b(?:closes?|fixes?|resolves?|refs?)\s+)?#\d+\b/gi;
const FUGA = new RegExp(`\\bUS${HYPHEN}\\d+|docs/internal`, 'i');

/** @returns {{type: string, breaking: boolean, text: string} | null} null si no queda texto. */
export function parseCommit(subject) {
  const m = /^([a-z]+)(?:\([^)]*\))?(!)?:\s*(.*)$/.exec(subject.trim());
  const [type, breaking, crudo] = m ? [m[1], Boolean(m[2]), m[3]] : ['otros', false, subject];
  const text = crudo
    .replace(ID, '')
    .replace(REF_ISSUE, '')
    .replace(/\(\s*[/,;\s]*\)/g, '') // paréntesis que se quedaron sin nada
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:,;\s]+|[:,;\s]+$/g, '')
    .trim();
  return text ? { type, breaking, text } : null;
}

const FILAS = [
  [/_amd64\.deb$/, 'Debian y Ubuntu, amd64 (.deb)'],
  [/_arm64\.deb$/, 'Debian y Ubuntu, arm64 (.deb)'],
  [/\.pkg\.tar\.zst$/, 'Arch Linux y derivadas, x86_64'],
  [/-linux-x64\.tar\.gz$/, 'Portable de Linux, x64'],
  [/-linux-arm64\.tar\.gz$/, 'Portable de Linux, arm64'],
  [/^SHA256SUMS$/, 'Sumas de verificación'],
  [/^manifest\.json$/, 'Manifiesto que lee el actualizador'],
  [/^manifest\.json\.sig$/, 'Firma del manifiesto'],
];

const lista = (titulo, items) =>
  items.length ? `**${titulo}**\n\n${items.map((t) => `- ${t}`).join('\n')}\n\n` : '';

/** @param {{version: string, commits: string[], assets: string[], repo?: string}} input */
export function buildNotes({ commits, assets, repo }) {
  const por = { atencion: [], feat: [], fix: [] };
  let internos = 0;
  for (const subject of commits) {
    const c = parseCommit(subject);
    if (!c) continue;
    if (c.breaking) por.atencion.push(c.text);
    else if (c.type === 'feat') por.feat.push(c.text);
    else if (c.type === 'fix' || c.type === 'perf') por.fix.push(c.text);
    else internos++; // docs, test, ci, chore, refactor, build, style y lo no convencional
  }
  const visibles = por.atencion.length + por.feat.length + por.fix.length;

  let md = `## Qué cambia\n\n`;
  md += lista('Requiere atención', por.atencion);
  md += lista('Novedades', por.feat);
  md += lista('Correcciones', por.fix);
  if (!visibles) md += `Esta versión no trae cambios visibles.\n\n`;
  if (internos)
    md += `${internos} ${internos === 1 ? 'cambio interno no listado' : 'cambios internos no listados'}.\n\n`;

  md += `## Descargas\n\n| Archivo | Para |\n| --- | --- |\n`;
  for (const a of assets) {
    const fila = FILAS.find(([re]) => re.test(a));
    md += `| \`${a}\` | ${fila ? fila[1] : ''} |\n`;
  }

  md += `\n## Verificar la descarga\n\n\`\`\`bash\nsha256sum -c --ignore-missing SHA256SUMS\n\`\`\`\n\n`;
  md += `La suma comprueba que el archivo no se dañó al bajarlo; no es una firma y no prueba quién lo publicó.\n\n`;

  const doc = (f) => (repo ? `https://github.com/${repo}/blob/main/docs/${f}` : `docs/${f}`);
  md += `## Actualizar\n\n- Desde la app: [\`docs/updates.md\`](${doc('updates.md')}).\n`;
  md += `- Instalación y actualización de los paquetes de Linux: [\`docs/install-linux-package.md\`](${doc('install-linux-package.md')}).\n`;
  return md;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main([ref, version, carpeta]) {
  if (!ref || !version || !carpeta)
    throw new Error('uso: notes.mjs <ref> <versión> <carpeta-release>');
  let prev;
  try {
    prev = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', `${ref}^`).trim();
  } catch {
    throw new Error('no hay una versión anterior de la que partir');
  }
  const commits = git('log', '--no-merges', '--format=%s', `${prev}..${ref}`)
    .split('\n')
    .filter(Boolean);
  const assets = readdirSync(carpeta).sort();
  const notas = buildNotes({ version, commits, assets, repo: process.env.GITHUB_REPOSITORY });
  // Red de seguridad: la limpieza de parseCommit puede fallar con un formato raro; esto no deja publicar.
  if (FUGA.test(notas)) {
    const culpables = commits.filter((c) => FUGA.test(parseCommit(c)?.text ?? ''));
    throw new Error(
      `las notas llevarían un identificador interno; commits: ${culpables.map((c) => JSON.stringify(c)).join(', ') || '(ver la salida)'}`,
    );
  }
  process.stdout.write(notas);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
