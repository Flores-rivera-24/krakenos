import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DISCONNECT_TIMEOUT_MS, SHUTDOWN_TIMEOUT_MS } from '../../src/system/shutdown.js';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { renderWinswXml, verifyWinswBinary, WINSW } from '../../../../scripts/package/winsw.mjs';

/** WinSW 2.12.0: la suma del binario que se empaqueta y el XML del servicio. */

const bytes = Buffer.from('un ejecutable cualquiera');
const sha = createHash('sha256').update(bytes).digest('hex');

describe('verifyWinswBinary', () => {
  it('acepta el binario cuya suma coincide', () => {
    expect(() => verifyWinswBinary(bytes, sha)).not.toThrow();
  });

  it('rechaza un byte alterado diciendo que no verifica', () => {
    const alterado = Buffer.from(bytes);
    alterado[0] = (alterado[0] ?? 0) ^ 1;
    expect(() => verifyWinswBinary(alterado, sha)).toThrow(
      `WinSW no verifica: esperaba ${sha}, obtuve ${createHash('sha256').update(alterado).digest('hex')}`,
    );
  });
});

describe('WINSW (winsw.json)', () => {
  it('fija la versión exacta, la URL de esa release y una suma sha256 de 64 hex', () => {
    expect(WINSW.version).toBe('2.12.0');
    expect(WINSW.url).toBe(
      'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
    );
    expect(WINSW.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('renderWinswXml', () => {
  const xml: string = renderWinswXml({ port: 3123 });
  const sinComentarios = xml.replace(/<!--[\s\S]*?-->/g, '');

  it('identifica el servicio y envuelve node.exe directo, sin krakenos.cmd', () => {
    expect(xml).toContain('<id>KrakenOS</id>');
    expect(xml).toContain('<executable>%BASE%\\..\\node\\node.exe</executable>');
    expect(xml).toMatch(/<arguments>[^<]*app\\agent\\dist\\index\.js[^<]*<\/arguments>/);
    expect(sinComentarios).not.toContain('krakenos.cmd');
  });

  it('trabaja en ProgramData y fija el entorno sin KRAKENOS_DEPLOY_MODE', () => {
    expect(xml).toContain('<workingdirectory>%ProgramData%\\KrakenOS</workingdirectory>');
    expect(xml).toContain('<env name="KRAKENOS_DATA_DIR" value="%ProgramData%\\KrakenOS"');
    expect(xml).toContain('<env name="KRAKENOS_APP_DIR" value="%BASE%\\..\\app\\agent"');
    expect(xml).toContain('<env name="NODE_ENV" value="production"');
    expect(xml).toContain('<env name="PORT" value="3123"');
    expect(sinComentarios).not.toContain('KRAKENOS_DEPLOY_MODE');
  });

  it('arranca solo (retrasado) y se reinicia tras fallar, sin rendirse', () => {
    expect(xml).toContain('<startmode>Automatic</startmode>');
    expect(xml).toMatch(/<delayedAutoStart>true<\/delayedAutoStart>/);
    const reinicios = xml.match(/<onfailure action="restart"[^>]*\/>/g) ?? [];
    expect(reinicios).toHaveLength(3);
    expect(xml).not.toMatch(/<onfailure action="(none|reboot)"/);
    expect(xml).toMatch(/<resetfailure>[^<]+<\/resetfailure>/);
  });

  it('rechaza un puerto que no es entero de 1 a 65535', () => {
    for (const port of [0, 70000, 3.5, NaN, '3001'])
      expect(() => renderWinswXml({ port })).toThrow(/puerto/);
  });

  it('da al agente más tiempo de parada que su propio tope de cierre', () => {
    const m = /<stoptimeout>(\d+) sec<\/stoptimeout>/.exec(xml);
    expect(m).not.toBeNull();
    const seg = Number(m?.[1]);
    expect(seg).toBe(20);
    expect(seg * 1000).toBeGreaterThan(SHUTDOWN_TIMEOUT_MS + DISCONNECT_TIMEOUT_MS);
  });
});
