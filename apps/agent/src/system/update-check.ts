/**
 * Comprobación de actualizaciones (US-116). Compara la versión actual del agente
 * con la última release de GitHub. **Opt-in** (privacy-first): sin `UPDATE_CHECK_REPO`
 * no hace ninguna llamada externa. Fetcher inyectable (mock-first) + caché de 1 h.
 */

import { safeFetch } from '../net/egress.js';
import { isNewer, parseVersion } from './version-compare.js';

export { isNewer, parseVersion };

export interface UpdateStatus {
  /** ¿Está activada la comprobación (hay repo configurado)? */
  enabled: boolean;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

export interface FetchLike {
  ok: boolean;
  json(): Promise<unknown>;
}
export type UpdateFetch = (url: string) => Promise<FetchLike>;

const CACHE_TTL_MS = 60 * 60 * 1000;

const defaultFetch: UpdateFetch = (url) =>
  // `safeFetch` valida la URL y **cada redirect** contra la política de egress:
  // ni la URL de GitHub ni un 3xx pueden reapuntar a metadata/interno (SSRF).
  safeFetch(url, {
    headers: { 'User-Agent': 'KrakenOS', Accept: 'application/vnd.github+json' },
    // Sin timeout, una conexión que GitHub deje colgada retiene el handler
    // indefinidamente. 10 s de tope; el `catch` de `fetchLatest` lo degrada a
    // "sin datos" sin romper la página.
    signal: AbortSignal.timeout(10_000),
  });

export class UpdateChecker {
  private cache: { at: number; status: UpdateStatus } | null = null;

  constructor(
    private readonly current: string,
    private readonly repo: string | null,
    private readonly fetchFn: UpdateFetch = defaultFetch,
    /** Reloj inyectable para la caché (tests). */
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(): Promise<UpdateStatus> {
    if (!this.repo) {
      return { enabled: false, current: this.current, latest: null, updateAvailable: false };
    }
    if (this.cache && this.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.status;
    }
    const status = await this.fetchLatest();
    this.cache = { at: this.now(), status };
    return status;
  }

  private async fetchLatest(): Promise<UpdateStatus> {
    const base: UpdateStatus = {
      enabled: true,
      current: this.current,
      latest: null,
      updateAvailable: false,
    };
    try {
      const res = await this.fetchFn(`https://api.github.com/repos/${this.repo}/releases/latest`);
      if (!res.ok) return base;
      const body = (await res.json()) as { tag_name?: unknown };
      const latest = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/i, '') : null;
      return { ...base, latest, updateAvailable: latest ? isNewer(latest, this.current) : false };
    } catch {
      return base;
    }
  }
}
