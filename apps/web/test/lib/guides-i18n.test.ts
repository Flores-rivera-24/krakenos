import { afterEach, describe, expect, it } from 'vitest';
import { getGuide, getGuideByKind, getGlossaryEntry, GUIDES } from '@/lib/guides';
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
    // GLOSSARY_EN puede estar vacío para esta clave → term/short en español, sin romper.
    expect(entry?.term).toBeTruthy();
    expect(entry?.short).toBeTruthy();
  });
});
