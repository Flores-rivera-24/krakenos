import type {
  IntegrationConfigInfo,
  IntegrationDomain,
  IntegrationField,
  IntegrationKindSchema,
  IntegrationTestResult,
} from '@krakenos/types';
import { useMemo, useState, type ReactNode } from 'react';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { GuideStep, GuideStepList } from '@/components/ui/guide-step';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Stepper, type StepperStep } from '@/components/ui/stepper';
import { Switch } from '@/components/ui/switch';
import { describeError } from '@/lib/errors';
import { getGuideByKind, type GuideField } from '@/lib/guides';
import { saveIntegration, testIntegration } from '@/lib/integrations';
import { toast } from '@/store/toast.store';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 py-2 text-kr-base text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Valor de un campo del formulario: booleano para `boolean`, texto para el resto. */
type FieldValue = string | boolean;

export interface IntegrationWizardProps {
  domain: IntegrationDomain;
  /** `kind` del backend a configurar (para `iot`, un único backend, p. ej. `hue`). */
  kind: string;
  /** Esquema técnico (fuente de verdad de qué campos existen / son obligatorios / secretos). */
  kindSchema: IntegrationKindSchema;
  /** Config actualmente guardada del dominio, o `null`. */
  current: IntegrationConfigInfo | null;
  /** Se invoca al terminar (tras guardar con éxito) para cerrar y refrescar. */
  onDone: () => void;
}

/**
 * Asistente de conexión data-driven (US-145…US-149): un `Stepper` de 2-3 pasos
 * — **Prepara** (guía humana), **Conecta** (formulario derivado del esquema del
 * backend) y **Prueba y guarda** — que traduce una `IntegrationGuide` + su
 * `IntegrationKindSchema` en un flujo paso a paso para una persona no técnica.
 *
 * El backend manda en qué campos existen; la guía aporta la copia (títulos,
 * ayudas, pasos). Para el dominio `iot` las claves se guardan con espacio de
 * nombres `backend.campo` (p. ej. `hue.appKey`), así que aquí se prefijan al
 * leer/escribir la config.
 */
export function IntegrationWizard({
  domain,
  kind,
  kindSchema,
  current,
  onDone,
}: IntegrationWizardProps) {
  const guide = getGuideByKind(kind);
  const displayName = guide?.displayName ?? kindSchema.label;
  const isIot = domain === 'iot';
  const fields = kindSchema.fields;
  // Los `kind` sin config (mock/demo) saltan directamente a "Prueba y guarda".
  const skipConnect = kindSchema.zeroConfig === true || fields.length === 0;

  /** Clave con la que el backend guarda el valor (namespaced en `iot`). */
  const storageKey = (fieldKey: string) => (isIot ? `${kind}.${fieldKey}` : fieldKey);

  /** Copia de usuario (label/ayuda/placeholder) por clave de campo. */
  const guideFields = useMemo(
    () => new Map<string, GuideField>((guide?.fields ?? []).map((f) => [f.key, f])),
    [guide],
  );

  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const out: Record<string, FieldValue> = {};
    for (const f of fields) {
      if (f.type === 'boolean') {
        const stored = current?.config[storageKey(f.key)];
        out[f.key] = typeof stored === 'boolean' ? stored : Boolean(f.default ?? false);
      } else if (isSecret(f)) {
        out[f.key] = ''; // nunca se prefilla un secreto
      } else {
        const stored = current?.config[storageKey(f.key)];
        out[f.key] =
          stored !== undefined && stored !== null
            ? String(stored)
            : f.default !== undefined
              ? String(f.default)
              : '';
      }
    }
    return out;
  });

  const [step, setStep] = useState(0);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<IntegrationTestResult | null>(null);
  const busy = testing || saving;

  const secretStored = (fieldKey: string) =>
    current?.secretsSet.includes(storageKey(fieldKey)) ?? false;

  const setField = (key: string, value: FieldValue) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  /** ¿El campo obligatorio está satisfecho? Un secreto ya guardado cuenta. */
  const fieldSatisfied = (f: IntegrationField): boolean => {
    if (!f.required || f.type === 'boolean') return true;
    const raw = values[f.key];
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (isSecret(f)) return text !== '' || secretStored(f.key);
    return text !== '';
  };
  const formReady = fields.every(fieldSatisfied);

  /** Config a enviar: coacciona por tipo y omite secretos en blanco (conserva el guardado). */
  const buildConfig = (): Record<string, string | number | boolean> => {
    const config: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      const raw = values[f.key];
      const key = storageKey(f.key);
      if (f.type === 'boolean') {
        config[key] = raw === true;
        continue;
      }
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (isSecret(f)) {
        if (text !== '') config[key] = text; // en blanco → el backend conserva el guardado
        continue;
      }
      if (text === '') continue; // opcional vacío → no se envía
      if (f.type === 'number') {
        const n = Number(text);
        if (!Number.isNaN(n)) config[key] = n;
      } else {
        config[key] = text;
      }
    }
    return config;
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testIntegration(domain, { kind, config: buildConfig() }));
    } catch (err) {
      const message = describeError(err, `No se pudo probar ${displayName}`);
      setResult({ ok: false, message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const runSave = async () => {
    setSaving(true);
    try {
      await saveIntegration(domain, { kind, enabled: true, config: buildConfig() });
      toast.success(`¡${displayName} conectado!`);
      onDone();
    } catch (err) {
      toast.error(describeError(err, `No se pudo guardar ${displayName}`));
    } finally {
      setSaving(false);
    }
  };

  // --- Contenido de cada paso ---

  const prepare = (
    <div className="space-y-4">
      <p className="text-kr-sm text-kr-secondary">
        {guide?.intro ?? `Vamos a configurar ${kindSchema.label}.`}
      </p>
      {guide && guide.prerequisites.length > 0 && (
        <div className="rounded-lg border border-kr bg-kr-elevated p-3">
          <p className="mb-2 text-kr-sm font-semibold text-kr-primary">Qué necesitas</p>
          <ul className="list-disc space-y-1 pl-5 text-kr-sm text-kr-secondary">
            {guide.prerequisites.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {guide && guide.steps.length > 0 && (
        <GuideStepList>
          {guide.steps.map((s, i) => (
            <GuideStep
              key={i}
              index={i + 1}
              title={s.title}
              command={s.command}
              note={s.note}
              warning={s.warning}
              external={s.external}
            >
              {s.body}
            </GuideStep>
          ))}
        </GuideStepList>
      )}
    </div>
  );

  const connect = (
    <div className="space-y-4">
      <p className="text-kr-sm text-kr-secondary">
        Rellena los datos. Los marcados con <span className="text-danger">*</span> son
        obligatorios; el resto puedes dejarlos como están.
      </p>
      {fields.map((f) => (
        <FieldRow
          key={f.key}
          field={f}
          guide={guideFields.get(f.key)}
          value={values[f.key] ?? (f.type === 'boolean' ? false : '')}
          secretStored={isSecret(f) && secretStored(f.key)}
          onChange={(v) => setField(f.key, v)}
        />
      ))}
    </div>
  );

  const testSave = (
    <div className="space-y-4">
      <p className="text-kr-sm text-kr-secondary">
        Prueba la conexión para confirmar que todo está bien y luego guarda. Si tu dispositivo
        no es accesible desde este navegador, puedes guardar sin probar.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void runTest()} disabled={busy}>
          {testing ? 'Probando…' : 'Probar conexión'}
        </Button>
        <button
          type="button"
          onClick={() => void runSave()}
          disabled={busy}
          className="text-kr-sm text-kr-secondary underline underline-offset-2 hover:text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Guardar sin probar
        </button>
      </div>
      {result && (
        <Callout
          variant={result.ok ? 'success' : 'danger'}
          title={result.ok ? 'Conexión correcta' : 'No se pudo conectar'}
        >
          <p>{result.message}</p>
          {result.ok && result.details && Object.keys(result.details).length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {Object.entries(result.details).map(([k, v]) => (
                <li key={k}>
                  <span className="text-kr-muted">{k}:</span> {String(v)}
                </li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {guide && guide.troubleshooting.length > 0 && (
        <div>
          <p className="mb-2 text-kr-sm font-semibold text-kr-primary">¿Problemas?</p>
          <Accordion>
            {guide.troubleshooting.map((t, i) => (
              <AccordionItem key={i} id={`ts-${i}`} title={t.q}>
                {t.a}
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}
    </div>
  );

  const steps: StepperStep[] = [
    { id: 'prepare', title: 'Prepara', description: displayName, content: prepare },
  ];
  if (!skipConnect) {
    steps.push({ id: 'connect', title: 'Conecta', canAdvance: formReady, content: connect });
  }
  steps.push({
    id: 'save',
    title: 'Prueba y guarda',
    canAdvance: result?.ok === true,
    content: testSave,
  });

  return (
    <Stepper
      steps={steps}
      current={step}
      onStepChange={setStep}
      onComplete={() => void runSave()}
      busy={busy}
      finishLabel="Guardar y conectar"
    />
  );
}

/** ¿El campo es un secreto (contraseña/clave)? Se cifra en reposo y nunca se prefilla. */
function isSecret(field: IntegrationField): boolean {
  return field.secret === true || field.type === 'password';
}

interface FieldRowProps {
  field: IntegrationField;
  guide: GuideField | undefined;
  value: FieldValue;
  secretStored: boolean;
  onChange: (value: FieldValue) => void;
}

/** Una fila del formulario: etiqueta amable + ayuda contextual + control por tipo. */
function FieldRow({ field, guide, value, secretStored, onChange }: FieldRowProps) {
  const id = `intfield-${field.key}`;
  const labelId = `${id}-label`;
  const label = guide?.label ?? field.key;
  const help = guide?.help;
  const placeholder = guide?.placeholder;
  const secret = isSecret(field);
  const options = field.options ?? guide?.options ?? [];

  let control: ReactNode;
  if (field.type === 'boolean') {
    control = (
      <Switch
        id={id}
        checked={value === true}
        onCheckedChange={(c) => onChange(c)}
        aria-labelledby={labelId}
      />
    );
  } else if (field.type === 'select') {
    control = (
      <select
        id={id}
        className={SELECT_CLASS}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {!field.required && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <Input
        id={id}
        type={secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          secret && secretStored ? '•••••• (guardado — deja en blanco para conservar)' : placeholder
        }
        autoComplete={secret ? 'new-password' : undefined}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label id={labelId} htmlFor={id}>
          {label}
          {field.required && <span className="text-danger"> *</span>}
        </Label>
        {help && <HelpHint content={help} />}
      </div>
      {control}
    </div>
  );
}
