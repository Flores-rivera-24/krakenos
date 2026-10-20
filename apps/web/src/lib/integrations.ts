import type {
  DomainState,
  IntegrationConfigInfo,
  IntegrationDomain,
  IntegrationKindSchema,
  IntegrationTestResult,
  SaveIntegrationConfigRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';
import type { GuideCategory } from '@/lib/guides';
import { refrescarEstados } from '@/lib/integration-states';
import type { TranslationKey } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/conectar';

/**
 * Cliente tipado del sistema de configuración de integraciones (US-140+),
 * consumido por el asistente de conexión (US-145…US-149). Envuelve los
 * endpoints `/api/integrations` del agente con las formas de `@krakenos/types`;
 * los secretos nunca viajan en las respuestas (el agente los redacta).
 */

/** Config efectiva + catálogo de un dominio, tal como lo devuelve `GET /api/integrations`. */
export interface DomainView {
  domain: IntegrationDomain;
  /** Todos los `kind` que soporta el dominio (con sus campos y flags). */
  kinds: IntegrationKindSchema[];
  /** Config guardada del dominio, o `null` si hereda de `.env`. */
  current: IntegrationConfigInfo | null;
  /** `kind` que está realmente VIVO (puede ser `none` o `mock`, que no están en `kinds`). */
  effectiveKind: string;
  /** De dónde sale la config viva: la base de datos o `.env` (una guardada pero desactivada no cuenta). */
  source: 'db' | 'env';
  /** Estado del dominio: conectado, de demostración o sin configurar. */
  state: DomainState;
}

interface OverviewResponse {
  domains: DomainView[];
}

/** Catálogo de integraciones + config efectiva por dominio. */
export async function getIntegrations(): Promise<DomainView[]> {
  const res = await api.get<OverviewResponse>('/integrations');
  return res?.domains ?? [];
}

/** Guarda (cifrando secretos) la config de un dominio y recarga su manager en caliente. */
export async function saveIntegration(
  domain: IntegrationDomain,
  body: SaveIntegrationConfigRequest,
): Promise<IntegrationConfigInfo> {
  const saved = await api.put<IntegrationConfigInfo>(`/integrations/${domain}`, body);
  // Conectar algo saca al dominio de «sin configurar»: las páginas lo saben sin esperar al sondeo.
  void refrescarEstados();
  return saved;
}

/** Prueba la conexión de una config propuesta, sin persistirla. */
export function testIntegration(
  domain: IntegrationDomain,
  body: SaveIntegrationConfigRequest,
): Promise<IntegrationTestResult> {
  return api.post<IntegrationTestResult>(`/integrations/${domain}/test`, body);
}

/** Borra la config guardada de un dominio (vuelve al fallback de `.env`). */
export async function deleteIntegration(domain: IntegrationDomain): Promise<void> {
  await api.del<void>(`/integrations/${domain}`);
  void refrescarEstados();
}

/** Esquema técnico de un `kind` dentro de un `DomainView`, o `undefined` si no existe. */
export function kindSchemaFor(view: DomainView, kind: string): IntegrationKindSchema | undefined {
  return view.kinds.find((k) => k.kind === kind);
}

/**
 * Etiqueta en lenguaje llano por categoría de guía (la **clave** del catálogo, no
 * el texto), para agrupar el hub de conexión de cara a una persona no técnica.
 * `firewall`/`vlan`/`qos` comparten la misma clave («Red avanzada») a propósito: se
 * muestran en una sola sección, y la sección se identifica por esa clave.
 */
export const CATEGORY_LABEL_KEYS: Record<GuideCategory, TranslationKey> = {
  router: 'connect.category.router',
  lights: 'connect.category.lights',
  plugs: 'connect.category.plugs',
  cameras: 'connect.category.cameras',
  'remote-access': 'connect.category.remoteAccess',
  'ad-blocking': 'connect.category.adBlocking',
  firewall: 'connect.category.advanced',
  vlan: 'connect.category.advanced',
  qos: 'connect.category.advanced',
};
