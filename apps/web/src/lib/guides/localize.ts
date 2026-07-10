import type { GlossaryEntry } from './glossary';
import type { IntegrationGuide } from './types';

/**
 * Superposición de traducción de una guía (US-177).
 *
 * El contenido en español (`integrations/*.ts`) es la **fuente canónica** y define
 * la estructura (ids, `kind`, claves de campo, valores de opción, tiers…). Una
 * traducción solo aporta el **texto visible**; la estructura se toma siempre del
 * original, así que un idioma no puede desalinear campos ni romper el contrato con
 * el backend. Cualquier cadena ausente cae al español (traducción parcial segura).
 */
export interface GuideTranslation {
  displayName?: string;
  vendor?: string;
  intro?: string;
  /** Mismo orden y longitud que los prerequisitos en español. */
  prerequisites?: string[];
  /** Mismo orden que los pasos en español; cada entrada superpone su texto. */
  steps?: {
    title?: string;
    body?: string;
    command?: string;
    note?: string;
    warning?: string;
  }[];
  /** Indexado por `field.key`. */
  fields?: Record<
    string,
    {
      label?: string;
      help?: string;
      placeholder?: string;
      /** Indexado por `option.value` → etiqueta traducida. */
      options?: Record<string, string>;
    }
  >;
  /** Mismo orden que `troubleshooting` en español. */
  troubleshooting?: { q?: string; a?: string }[];
}

/** Todas las superposiciones de un idioma, indexadas por `guide.id`. */
export type GuideTranslations = Record<string, GuideTranslation>;

/** Superposición de una entrada del glosario (US-177); estructura del español. */
export type GlossaryTranslation = Partial<Pick<GlossaryEntry, 'term' | 'short' | 'long'>>;
export type GlossaryTranslations = Record<string, GlossaryTranslation>;

/**
 * Aplica una superposición de traducción a una guía en español, devolviendo una
 * guía nueva con el texto traducido donde exista y el original donde no. La
 * estructura (ids, claves, valores de opción, tiers) proviene SIEMPRE del
 * original: nunca de la traducción.
 */
export function localizeGuide(base: IntegrationGuide, tr?: GuideTranslation): IntegrationGuide {
  if (!tr) return base;
  return {
    ...base,
    displayName: tr.displayName ?? base.displayName,
    vendor: tr.vendor ?? base.vendor,
    intro: tr.intro ?? base.intro,
    prerequisites: base.prerequisites.map((p, i) => tr.prerequisites?.[i] ?? p),
    steps: base.steps.map((step, i) => {
      const s = tr.steps?.[i];
      if (!s) return step;
      return {
        ...step,
        title: s.title ?? step.title,
        body: s.body ?? step.body,
        command: s.command ?? step.command,
        note: s.note ?? step.note,
        warning: s.warning ?? step.warning,
      };
    }),
    fields: base.fields.map((field) => {
      const f = tr.fields?.[field.key];
      if (!f) return field;
      return {
        ...field,
        label: f.label ?? field.label,
        help: f.help ?? field.help,
        placeholder: f.placeholder ?? field.placeholder,
        options: field.options?.map((opt) => ({
          ...opt,
          label: f.options?.[opt.value] ?? opt.label,
        })),
      };
    }),
    troubleshooting: base.troubleshooting.map((item, i) => {
      const q = tr.troubleshooting?.[i];
      if (!q) return item;
      return { q: q.q ?? item.q, a: q.a ?? item.a };
    }),
  };
}

/** Aplica una superposición de traducción a una entrada del glosario. */
export function localizeGlossaryEntry(
  base: GlossaryEntry,
  tr?: GlossaryTranslation,
): GlossaryEntry {
  if (!tr) return base;
  return {
    term: tr.term ?? base.term,
    short: tr.short ?? base.short,
    long: tr.long ?? base.long,
  };
}
