/**
 * Comprobación de actualizaciones (US-116). Compara la versión actual del agente
 * con la última release de GitHub. **Opt-in** (privacy-first): sin `UPDATE_CHECK_REPO`
 * no hace ninguna llamada externa. Fetcher inyectable (mock-first) + caché de 1 h.
 */

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

/** Parsea "v1.2.3" o "1.2.3" a `[major, minor, patch]` (no numérico → 0). */
export function parseVersion(v: string): [number, number, number] {
  const parts = v.replace(/^v/i, '').split('.');
  const num = (i: number) => {
    const n = parseInt(parts[i] ?? '0', 10);
    return Number.isFinite(n) ? n : 0;
  };
  return [num(0), num(1), num(2)];
}

/** ¿Es `a` una versión más nueva que `b`? */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x[i]! > y[i]!) return true;
    if (x[i]! < y[i]!) return false;
  }
  return false;
}

const defaultFetch: UpdateFetch = (url) =>
  fetch(url, {
    headers: { 'User-Agent': 'KrakenOS', Accept: 'application/vnd.github+json' },
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
    const base: UpdateStatus = { enabled: true, current: this.current, latest: null, updateAvailable: false };
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
