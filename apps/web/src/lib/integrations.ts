import type {
  IntegrationConfigInfo,
  IntegrationDomain,
  IntegrationKindSchema,
  IntegrationTestResult,
  SaveIntegrationConfigRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';
import type { GuideCategory } from '@/lib/guides';

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
  /** `kind` que está realmente activo (de DB o de `.env`). */
  effectiveKind: string;
  /** De dónde sale la config activa. */
  source: 'db' | 'env';
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
export function saveIntegration(
  domain: IntegrationDomain,
  body: SaveIntegrationConfigRequest,
): Promise<IntegrationConfigInfo> {
  return api.put<IntegrationConfigInfo>(`/integrations/${domain}`, body);
}

/** Prueba la conexión de una config propuesta, sin persistirla. */
export function testIntegration(
  domain: IntegrationDomain,
  body: SaveIntegrationConfigRequest,
): Promise<IntegrationTestResult> {
  return api.post<IntegrationTestResult>(`/integrations/${domain}/test`, body);
}

/** Borra la config guardada de un dominio (vuelve al fallback de `.env`). */
export function deleteIntegration(domain: IntegrationDomain): Promise<void> {
  return api.del<void>(`/integrations/${domain}`);
}

/** Esquema técnico de un `kind` dentro de un `DomainView`, o `undefined` si no existe. */
export function kindSchemaFor(
  view: DomainView,
  kind: string,
): IntegrationKindSchema | undefined {
  return view.kinds.find((k) => k.kind === kind);
}

/**
 * Etiquetas en español llano por categoría de guía, para agrupar el hub de
 * conexión de cara a una persona no técnica. `firewall`/`vlan`/`qos` comparten
 * el mismo título ("Red avanzada") a propósito: se muestran en una sola sección.
 */
export const CATEGORY_LABELS: Record<GuideCategory, string> = {
  router: 'Tu red y router',
  lights: 'Luces inteligentes',
  plugs: 'Enchufes e interruptores',
  cameras: 'Cámaras',
  'remote-access': 'Acceso remoto (VPN)',
  'ad-blocking': 'Bloqueo de anuncios (DNS)',
  firewall: 'Red avanzada',
  vlan: 'Red avanzada',
  qos: 'Red avanzada',
};
