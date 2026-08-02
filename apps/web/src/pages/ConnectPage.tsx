import type {
  DiscoverySuggestion,
  IntegrationConfigInfo,
  IntegrationDomain,
  IntegrationKindSchema,
} from '@krakenos/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CompatibilitySection } from '@/components/connect/CompatibilitySection';
import { IntegrationWizard } from '@/components/connect/IntegrationWizard';
import { MatterCommissionCard } from '@/components/connect/MatterCommissionCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { ProductArt, type ProductArtKind } from '@/components/ui/product-art';
import { Skeleton } from '@/components/ui/skeleton';
import { Slideover } from '@/components/ui/slideover';
import { adoptSuggestion, dismissSuggestion, getDiscovery, scanDiscovery } from '@/lib/discovery';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { type TranslationKey, useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import {
  getGuideByKind,
  guidesByCategory,
  type GuideCategory,
  type GuideDomain,
  type IntegrationGuide,
} from '@/lib/guides';
import {
  CATEGORY_LABELS,
  getIntegrations,
  kindSchemaFor,
  type DomainView,
} from '@/lib/integrations';
import { cn } from '@/lib/utils';

/** Categoría de la guía → ilustración de producto (US-161). */
const CATEGORY_ART: Record<GuideCategory, ProductArtKind> = {
  router: 'router',
  lights: 'bulb',
  plugs: 'plug',
  cameras: 'camera',
  'remote-access': 'vpn',
  'ad-blocking': 'dns',
  firewall: 'firewall',
  vlan: 'switch',
  qos: 'qos',
};

/** Ilustración para una guía. El modo demo (icono `FlaskConical`) prima sobre la categoría. */
function guideToArtKind(guide: IntegrationGuide): ProductArtKind {
  if (guide.icon === 'FlaskConical') return 'demo';
  return CATEGORY_ART[guide.category] ?? 'unknown';
}

/** Dominio de la guía → dominio del backend (`camera` es singular en las guías). */
const GUIDE_DOMAIN: Record<GuideDomain, IntegrationDomain> = {
  driver: 'driver',
  iot: 'iot',
  vpn: 'vpn',
  camera: 'cameras',
  dns: 'dns',
  firewall: 'firewall',
  vlan: 'vlan',
  qos: 'qos',
};

/**
 * Alias de `kind` de guía → `kind` del backend cuando no coinciden. El backend
 * cubre Kasa y Tapo con un único backend `kasa`, así que la guía "Tapo" apunta ahí.
 */
const KIND_ALIASES: Record<string, string> = { tapo: 'kasa' };

/**
 * Guías que no se "configuran" con un formulario, sino que se gestionan en su
 * propia pantalla (lista de dispositivos / acceso). Tabla pequeña y extensible.
 */
const NAVIGATE_RULES: { to: string; match: (g: IntegrationGuide) => boolean }[] = [
  { to: '/settings', match: (g) => g.kind === 'tuya' }, // gestor de focos Tuya (US-42)
  { to: '/cameras', match: (g) => g.category === 'cameras' }, // alta de cámaras por cámara
  { to: '/vpn', match: (g) => g.category === 'remote-access' }, // peers WireGuard + QR
];

/** Orden de las secciones del hub (categorías; firewall/vlan/qos comparten sección). */
const SECTION_ORDER: GuideCategory[] = [
  'router',
  'lights',
  'plugs',
  'cameras',
  'remote-access',
  'ad-blocking',
  'firewall',
  'vlan',
  'qos',
];

/** Pista de dificultad para una persona no técnica. */
const TIER_HINT: Record<1 | 2 | 3 | 4, TranslationKey> = {
  1: 'connect.tier.1',
  2: 'connect.tier.2',
  3: 'connect.tier.3',
  4: 'connect.tier.4',
};

/** Acción de una tarjeta: abrir el asistente o navegar a otra pantalla. */
type CardAction =
  | {
      type: 'wizard';
      domain: IntegrationDomain;
      kind: string;
      kindSchema: IntegrationKindSchema;
      current: IntegrationConfigInfo | null;
      /** Precarga del formulario desde una sugerencia detectada (US-175). */
      initialValues?: Record<string, string>;
    }
  | { type: 'navigate'; to: string };

/** Ilustración por `kind` sugerido por el auto-descubrimiento (US-175). */
const SUGGESTION_ART: Record<string, ProductArtKind> = {
  hue: 'bulb',
  shelly: 'plug',
  kasa: 'plug',
  zigbee: 'router',
  rtsp: 'camera',
};

export function ConnectPage() {
  const t = useT();
  const navigate = useNavigate();
  const [views, setViews] = useState<DomainView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Extract<CardAction, { type: 'wizard' }> | null>(null);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  // Sugerencias del auto-descubrimiento (US-175). Best-effort: si falla, la
  // página funciona igual (solo desaparece la sección "Detectados en tu red").
  const [suggestions, setSuggestions] = useState<DiscoverySuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [adopting, setAdopting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setViews(await getIntegrations());
    } catch (err) {
      setError(describeError(err, t('connect.loadError')));
    } finally {
      setLoading(false);
    }
    try {
      const status = await getDiscovery();
      // Defensivo: un payload inesperado no debe tumbar el hub de Conectar.
      setSuggestions(Array.isArray(status.suggestions) ? status.suggestions : []);
    } catch {
      setSuggestions([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Barrido bajo demanda («Buscar dispositivos en mi red»). */
  const runScan = async () => {
    setScanning(true);
    try {
      const status = await scanDiscovery();
      const found = Array.isArray(status.suggestions) ? status.suggestions : [];
      setSuggestions(found);
      if (found.length === 0) toast.success(t('connect.scanEmpty'));
    } catch (err) {
      toast.error(describeError(err, t('connect.scanError')));
    } finally {
      setScanning(false);
    }
  };

  /** Descarta una sugerencia (persistido en el servidor). */
  const dismiss = async (s: DiscoverySuggestion) => {
    try {
      await dismissSuggestion(s.id);
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      toast.error(describeError(err, t('connect.dismissError')));
    }
  };

  /**
   * Alta **de un toque** (US-249): sin abrir el asistente. Solo se ofrece cuando el
   * servidor dice que la sugerencia es `adoptable`; si aun así responde que faltan
   * datos (la config cambió entre medias), se abre el asistente en vez de enseñar
   * un error que el usuario no puede resolver desde ahí.
   */
  const adopt = async (s: DiscoverySuggestion) => {
    setAdopting(s.id);
    try {
      const status = await adoptSuggestion(s.id);
      setSuggestions(Array.isArray(status.suggestions) ? status.suggestions : []);
      toast.success(t('connect.adoptOk'));
      void load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.body?.code === 'DISCOVERY_NEEDS_INPUT') {
        onSuggestionClick(s);
        return;
      }
      toast.error(describeError(err, t('connect.adoptError')));
    } finally {
      setAdopting(null);
    }
  };

  /** Abre el asistente precargado con lo detectado (US-175). */
  const onSuggestionClick = (s: DiscoverySuggestion) => {
    const view = viewByDomain.get(s.domain);
    if (!view) return;
    const schema = kindSchemaFor(view, s.kind);
    if (!schema) return;
    setActive({
      type: 'wizard',
      domain: view.domain,
      kind: schema.kind,
      kindSchema: schema,
      current: view.current,
      initialValues: s.prefill,
    });
  };

  const viewByDomain = useMemo(
    () => new Map(views.map((v) => [v.domain, v])),
    [views],
  );

  /** El `kind` del backend que usaría una guía (aplica alias). */
  const backendKind = (guide: IntegrationGuide) => KIND_ALIASES[guide.kind] ?? guide.kind;

  /** Cómo actúa la tarjeta de una guía (navegar vs. asistente). */
  const resolve = useCallback(
    (guide: IntegrationGuide): CardAction | null => {
      const nav = NAVIGATE_RULES.find((r) => r.match(guide));
      if (nav) return { type: 'navigate', to: nav.to };
      const view = viewByDomain.get(GUIDE_DOMAIN[guide.domain]);
      if (!view) return null; // catálogo aún no cargado
      const wanted = backendKind(guide);
      // Fallback: si el `kind` de la guía no existe en el backend (p. ej. `vlan`),
      // usa el primer backend real del dominio (p. ej. `switch`).
      const schema = kindSchemaFor(view, wanted) ?? view.kinds.find((k) => k.kind !== 'mock');
      if (!schema) return null;
      return { type: 'wizard', domain: view.domain, kind: schema.kind, kindSchema: schema, current: view.current };
    },
    [viewByDomain],
  );

  /** ¿Ya está conectada esta integración? (para el badge "✓ Conectado"). */
  const isConnected = useCallback(
    (guide: IntegrationGuide): boolean => {
      const view = viewByDomain.get(GUIDE_DOMAIN[guide.domain]);
      if (!view?.current?.enabled) return false;
      const activeKinds = view.current.kind.split(',').map((k) => k.trim());
      return activeKinds.includes(backendKind(guide));
    },
    [viewByDomain],
  );

  const onCardClick = (guide: IntegrationGuide) => {
    const action = resolve(guide);
    if (!action) return;
    if (action.type === 'navigate') navigate(action.to);
    else setActive(action);
  };

  // Secciones deduplicadas por etiqueta (firewall/vlan/qos → "Red avanzada").
  const sections = useMemo(() => {
    const out: { label: string; guides: IntegrationGuide[] }[] = [];
    const byLabel = new Map<string, IntegrationGuide[]>();
    for (const category of SECTION_ORDER) {
      const guides = guidesByCategory(category);
      if (guides.length === 0) continue;
      const label = CATEGORY_LABELS[category];
      const existing = byLabel.get(label);
      if (existing) existing.push(...guides);
      else {
        const bucket = [...guides];
        byLabel.set(label, bucket);
        out.push({ label, guides: bucket });
      }
    }
    return out;
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-kr-2xl font-semibold text-kr-primary">{t('connect.title')}</h1>
        <p className="max-w-2xl text-kr-base text-kr-secondary">{t('connect.intro')}</p>
        <Callout variant="info" title={t('connect.explore.title')}>
          {t('connect.explore.before')}
          <strong>{t('connect.explore.strong')}</strong>
          {t('connect.explore.after')}
        </Callout>
      </header>

      {error && (
        <ErrorBanner>
          {error}{' '}
          <button
            type="button"
            onClick={() => void load()}
            className="underline underline-offset-2 hover:text-kr-primary"
          >
            {t('connect.retry')}
          </button>
        </ErrorBanner>
      )}

      {(suggestions.length > 0 || isAdmin) && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-kr-lg font-semibold text-kr-primary">{t('connect.detected.title')}</h2>
              <p className="text-kr-sm text-kr-muted">{t('connect.detected.desc')}</p>
            </div>
            {isAdmin && (
              <Button variant="outline" size="sm" disabled={scanning} onClick={() => void runScan()}>
                {scanning ? t('connect.scanning') : t('connect.scan')}
              </Button>
            )}
          </div>
          {suggestions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-kr bg-kr-surface px-4 py-3 text-kr-sm text-kr-muted">
              {t('connect.detected.empty')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className="group relative flex h-full items-start gap-3 rounded-xl border border-kr-accent-glow bg-kr-surface p-4"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-kr-muted bg-kr-elevated">
                    <ProductArt kind={SUGGESTION_ART[s.kind] ?? 'unknown'} className="h-10 w-10" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-medium text-kr-primary">{s.label}</span>
                    <span className="block truncate font-mono text-kr-xs text-kr-muted">
                      {s.ip}
                      {s.hostname ? ` · ${s.hostname}` : ''}
                    </span>
                    <span className="flex gap-2 pt-1">
                      {s.adoptable && isAdmin ? (
                        <>
                          <Button
                            size="sm"
                            disabled={adopting === s.id}
                            aria-label={t('connect.adoptLabel', { label: s.label })}
                            onClick={() => void adopt(s)}
                          >
                            {t('connect.adopt')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onSuggestionClick(s)}>
                            {t('connect.configure')}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => onSuggestionClick(s)}>
                          {t('connect.connect')}
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('connect.dismissLabel', { label: s.label })}
                          onClick={() => void dismiss(s)}
                        >
                          {t('connect.dismiss')}
                        </Button>
                      )}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Añadir un dispositivo Matter escaneando su QR/código (US-172), solo admin. */}
      {isAdmin && <MatterCommissionCard />}

      {loading ? (
        <div className="space-y-6" aria-busy="true">
          {Array.from({ length: 2 }).map((_, s) => (
            <div key={s} className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, c) => (
                  <Skeleton key={c} className="h-24 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.label} className="space-y-3">
            <h2 className="text-kr-lg font-semibold text-kr-primary">{section.label}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.guides.map((guide) => (
                <ConnectCard
                  key={guide.id}
                  guide={guide}
                  connected={isConnected(guide)}
                  onClick={() => onCardClick(guide)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {/* Consulta de compatibilidad de hardware (US-208). */}
      <div className="border-t border-kr pt-6">
        <CompatibilitySection />
      </div>

      {active && (
        <Slideover
          open
          onClose={() => setActive(null)}
          title={t('connect.wizardTitle', {
            name: getGuideByKind(active.kind)?.displayName ?? active.kindSchema.label,
          })}
          subtitle={t('connect.wizardSubtitle')}
        >
          <IntegrationWizard
            domain={active.domain}
            kind={active.kind}
            kindSchema={active.kindSchema}
            current={active.current}
            initialValues={active.initialValues}
            onDone={() => {
              setActive(null);
              void load();
            }}
          />
        </Slideover>
      )}
    </div>
  );
}

interface ConnectCardProps {
  guide: IntegrationGuide;
  connected: boolean;
  onClick: () => void;
}

/** Tarjeta clicable de una integración: render del producto + nombre + dificultad + estado. */
function ConnectCard({ guide, connected, onClick }: ConnectCardProps) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-full items-start gap-3 rounded-xl border border-kr bg-kr-surface p-4 text-left transition-all duration-150',
        'hover:-translate-y-0.5 hover:border-kr-accent hover:shadow-kr-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-kr-muted bg-kr-elevated transition-colors group-hover:border-kr-accent-glow">
        <ProductArt kind={guideToArtKind(guide)} className="h-10 w-10" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-kr-primary">{guide.displayName}</span>
          {connected && <Badge variant="online">{t('connect.connected')}</Badge>}
        </span>
        {guide.vendor && <span className="block truncate text-kr-xs text-kr-muted">{guide.vendor}</span>}
        <span className="block text-kr-xs text-kr-secondary">{t(TIER_HINT[guide.tier])}</span>
      </span>
    </button>
  );
}
