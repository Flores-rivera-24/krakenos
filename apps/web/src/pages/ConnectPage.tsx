import type { IntegrationConfigInfo, IntegrationDomain, IntegrationKindSchema } from '@krakenos/types';
import {
  Camera,
  Flame,
  FlaskConical,
  Gauge,
  Lightbulb,
  Network,
  Plug,
  Puzzle,
  Router,
  ShieldBan,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IntegrationWizard } from '@/components/connect/IntegrationWizard';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { Slideover } from '@/components/ui/slideover';
import { describeError } from '@/lib/errors';
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

/** Resuelve el `icon` (string de la guía) a un componente lucide. */
const ICON_MAP: Record<string, LucideIcon> = {
  Camera,
  Flame,
  FlaskConical,
  Gauge,
  Lightbulb,
  Network,
  Plug,
  Router,
  ShieldBan,
  ShieldCheck,
};

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
const TIER_HINT: Record<1 | 2 | 3 | 4, string> = {
  1: 'Muy fácil',
  2: 'Fácil',
  3: 'Intermedio',
  4: 'Avanzado',
};

/** Acción de una tarjeta: abrir el asistente o navegar a otra pantalla. */
type CardAction =
  | { type: 'wizard'; domain: IntegrationDomain; kind: string; kindSchema: IntegrationKindSchema; current: IntegrationConfigInfo | null }
  | { type: 'navigate'; to: string };

export function ConnectPage() {
  const navigate = useNavigate();
  const [views, setViews] = useState<DomainView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Extract<CardAction, { type: 'wizard' }> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setViews(await getIntegrations());
    } catch (err) {
      setError(describeError(err, 'No se pudo cargar el catálogo de integraciones'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        <h1 className="text-kr-2xl font-semibold text-kr-primary">¿Qué quieres conectar?</h1>
        <p className="max-w-2xl text-kr-base text-kr-secondary">
          Elige el tipo de aparato o función y te guiamos paso a paso, sin tecnicismos. No
          necesitas salir de aquí ni leer manuales.
        </p>
        <Callout variant="info" title="¿Solo quieres explorar?">
          Activa el <strong>Modo demostración</strong> en «Tu red y router» para probar KrakenOS con
          una casa simulada, sin ningún aparato real.
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
            Reintentar
          </button>
        </ErrorBanner>
      )}

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

      {active && (
        <Slideover
          open
          onClose={() => setActive(null)}
          title={`Conectar ${getGuideByKind(active.kind)?.displayName ?? active.kindSchema.label}`}
          subtitle="Te guiamos paso a paso"
        >
          <IntegrationWizard
            domain={active.domain}
            kind={active.kind}
            kindSchema={active.kindSchema}
            current={active.current}
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

/** Tarjeta clicable de una integración: icono + nombre + dificultad + estado. */
function ConnectCard({ guide, connected, onClick }: ConnectCardProps) {
  const Icon = ICON_MAP[guide.icon] ?? Puzzle;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-full items-start gap-3 rounded-xl border border-kr bg-kr-surface p-4 text-left transition-colors',
        'hover:border-kr-accent hover:bg-kr-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kr-elevated text-kr-accent">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-kr-primary">{guide.displayName}</span>
          {connected && <Badge variant="online">✓ Conectado</Badge>}
        </span>
        {guide.vendor && <span className="block truncate text-kr-xs text-kr-muted">{guide.vendor}</span>}
        <span className="block text-kr-xs text-kr-secondary">{TIER_HINT[guide.tier]}</span>
      </span>
    </button>
  );
}
