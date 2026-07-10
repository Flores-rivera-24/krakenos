import { afterEach, describe, expect, it } from 'vitest';
import { getGuide, getGuideByKind, getGlossaryEntry, GLOSSARY, GUIDES } from '@/lib/guides';
import { GLOSSARY_EN, GUIDE_TRANSLATIONS_EN } from '@/lib/guides/en';
import { localizeGuide } from '@/lib/guides/localize';
import { setLocale } from '@/lib/i18n';

/**
 * Localización de guías y glosario (US-177). El español es la fuente canónica y
 * define la estructura; el inglés solo superpone texto. Estos tests garantizan que
 * (a) la superposición traduce, (b) lo no traducido cae al español, y (c) la
 * estructura (claves, valores de opción) NUNCA cambia entre idiomas.
 */
describe('localización de guías (US-177)', () => {
  afterEach(() => setLocale('es', { persist: false }));

  it('en español devuelve la fuente sin tocar', () => {
    setLocale('es', { persist: false });
    const es = getGuideByKind('rtsp');
    expect(es?.displayName).toBe('Cámara IP (RTSP)');
    expect(es?.intro).toContain('La mayoría de las cámaras');
  });

  it('en inglés superpone el texto traducido (cámara RTSP)', () => {
    setLocale('en', { persist: false });
    const en = getGuideByKind('rtsp');
    expect(en?.displayName).toBe('IP camera (RTSP)');
    expect(en?.intro).toContain('Most network surveillance cameras');
    // Un paso y un campo traducidos:
    expect(en?.steps[0]?.title).toBe('Enable RTSP and create a user on the camera');
    const transport = en?.fields.find((f) => f.key === 'transport');
    expect(transport?.label).toBe('Transport');
    expect(transport?.options?.find((o) => o.value === 'tcp')?.label).toBe('TCP (recommended)');
  });

  it('la estructura es idéntica entre idiomas (claves, tipos, valores de opción)', () => {
    setLocale('es', { persist: false });
    const es = getGuideByKind('rtsp')!;
    setLocale('en', { persist: false });
    const en = getGuideByKind('rtsp')!;
    expect(en.id).toBe(es.id);
    expect(en.kind).toBe(es.kind);
    expect(en.tier).toBe(es.tier);
    expect(en.fields.map((f) => f.key)).toEqual(es.fields.map((f) => f.key));
    expect(en.fields.map((f) => f.type)).toEqual(es.fields.map((f) => f.type));
    expect(en.fields.map((f) => f.required)).toEqual(es.fields.map((f) => f.required));
    const esOpts = es.fields.find((f) => f.key === 'transport')?.options?.map((o) => o.value);
    const enOpts = en.fields.find((f) => f.key === 'transport')?.options?.map((o) => o.value);
    expect(enOpts).toEqual(esOpts);
    expect(en.steps.length).toBe(es.steps.length);
    expect(en.troubleshooting.length).toBe(es.troubleshooting.length);
  });

  it('sin superposición, el inglés cae al español (traducción parcial segura)', () => {
    const base = GUIDES[0]!;
    // Guía sin traducción registrada → mismo texto que la fuente.
    const same = localizeGuide(base, undefined);
    expect(same).toBe(base);
    // Un id inexistente no rompe:
    setLocale('en', { persist: false });
    expect(getGuide('no-existe')).toBeUndefined();
  });

  it('el glosario cae al español cuando no hay traducción de la clave', () => {
    setLocale('en', { persist: false });
    const entry = getGlossaryEntry('ssid');
    expect(entry?.term).toBeTruthy();
    expect(entry?.short).toBeTruthy();
  });
});

/**
 * Guardas de paridad estructural es↔en (US-177). El typecheck acepta cualquier
 * `field.key`/`option.value` en el overlay (es `Record<string, …>`), así que estos
 * tests atrapan un error del traductor: una clave inexistente se aplicaría en
 * silencio a la nada. También exigen cobertura EN completa (cada guía y cada
 * término del glosario traducidos).
 */
describe('paridad estructural de las traducciones EN (US-177)', () => {
  it('toda guía en español tiene su overlay en inglés', () => {
    const missing = GUIDES.filter((g) => !GUIDE_TRANSLATIONS_EN[g.id]).map((g) => g.id);
    expect(missing).toEqual([]);
  });

  it('ningún overlay referencia un id de guía inexistente', () => {
    const ids = new Set(GUIDES.map((g) => g.id));
    const stray = Object.keys(GUIDE_TRANSLATIONS_EN).filter((id) => !ids.has(id));
    expect(stray).toEqual([]);
  });

  it('los overlays solo referencian field.key / option.value reales y no exceden longitudes', () => {
    for (const guide of GUIDES) {
      const tr = GUIDE_TRANSLATIONS_EN[guide.id];
      if (!tr) continue;
      const fieldKeys = new Set(guide.fields.map((f) => f.key));
      for (const key of Object.keys(tr.fields ?? {})) {
        expect(fieldKeys, `${guide.id}: field.key '${key}'`).toContain(key);
        const field = guide.fields.find((f) => f.key === key)!;
        const optValues = new Set((field.options ?? []).map((o) => o.value));
        for (const value of Object.keys(tr.fields?.[key]?.options ?? {})) {
          expect(optValues, `${guide.id}.${key}: option '${value}'`).toContain(value);
        }
      }
      // Los overlays por índice no deben exceder la fuente (español = estructura).
      expect(tr.prerequisites?.length ?? 0).toBeLessThanOrEqual(guide.prerequisites.length);
      expect(tr.steps?.length ?? 0).toBeLessThanOrEqual(guide.steps.length);
      expect(tr.troubleshooting?.length ?? 0).toBeLessThanOrEqual(guide.troubleshooting.length);
    }
  });

  it('el glosario EN cubre todas las claves y no añade ninguna extra', () => {
    const esKeys = Object.keys(GLOSSARY);
    const enKeys = Object.keys(GLOSSARY_EN);
    const missing = esKeys.filter((k) => !(k in GLOSSARY_EN));
    const stray = enKeys.filter((k) => !(k in GLOSSARY));
    expect(missing).toEqual([]);
    expect(stray).toEqual([]);
  });
});
