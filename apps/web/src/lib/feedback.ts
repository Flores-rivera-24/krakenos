/**
 * Canal de feedback (US-218): construye la URL de un issue de GitHub
 * **pre-rellenado** (plantilla + versión + modo de despliegue). Local-first
 * honesto: KrakenOS no envía nada solo — abre el navegador del usuario y es él
 * quien pega/adjunta lo que quiera (p. ej. el bundle de soporte sanitizado).
 */

export const KRAKENOS_REPO = 'Flores-rivera-24/krakenos';

export type FeedbackKind = 'bug' | 'hardware-report' | 'feature';

const TEMPLATE_BY_KIND: Record<FeedbackKind, string> = {
  bug: 'bug.yml',
  'hardware-report': 'hardware-report.yml',
  feature: 'feature.yml',
};

export interface FeedbackContext {
  /** Versión instalada del agente (del plan de update, US-190). */
  version?: string | null;
  /** Modo de despliegue (`systemd`/`docker`), si se conoce. */
  deployMode?: string | null;
}

/**
 * URL de «nuevo issue» con la plantilla y los campos `version`/`deploy`
 * pre-rellenados (los ids coinciden con los del formulario YAML). Pura.
 */
export function buildIssueUrl(
  kind: FeedbackKind,
  ctx: FeedbackContext = {},
  repo: string = KRAKENOS_REPO,
): string {
  const params = new URLSearchParams({ template: TEMPLATE_BY_KIND[kind] });
  if (ctx.version) params.set('version', ctx.version);
  if (ctx.deployMode) params.set('deploy', ctx.deployMode);
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}
