import type { CreateFloorPlanRequest, FloorPlan, UpdateFloorPlanRequest } from '@krakenos/types';
import { useState } from 'react';
import { ImageOff, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slideover } from '@/components/ui/slideover';
import { createFloorPlan, deleteFloorPlan, updateFloorPlan } from '@/lib/coverage';
import { describeError } from '@/lib/errors';
import { toast } from '@/store/toast.store';

interface Props {
  /** Si viene un plano, el panel edita; si no, da de alta uno nuevo. */
  plan?: FloorPlan | null;
  onClose: () => void;
  /** Refresca la lista tras un alta/edición correcta. */
  onSaved: (plan: FloorPlan) => void;
  /** Notifica el borrado del plano (solo en modo edición). */
  onDeleted?: (id: string) => void;
}

/** Lee un fichero de imagen y devuelve su Data URL (base64). */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

/**
 * Alta/edición de un plano de planta (nombre, medidas reales en metros e imagen
 * de fondo opcional). Sigue el patrón de `CameraFormSlideover`: estado local de
 * guardado/error, toasts y `Slideover`. La geometría (paredes/APs) se edita
 * luego en el propio lienzo de la página.
 */
export function FloorPlanFormSlideover({ plan, onClose, onSaved, onDeleted }: Props) {
  const isEdit = plan != null;
  const [name, setName] = useState(plan?.name ?? '');
  const [widthM, setWidthM] = useState(plan ? String(plan.widthM) : '10');
  const [heightM, setHeightM] = useState(plan ? String(plan.heightM) : '8');
  const [backgroundImage, setBackgroundImage] = useState<string | null>(
    plan?.backgroundImage ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const width = Number(widthM);
  const height = Number(heightM);
  const canSubmit =
    name.trim() !== '' &&
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0;

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setBackgroundImage(await readAsDataUrl(file));
    } catch (err) {
      toast.error(describeError(err, 'No se pudo cargar la imagen'));
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      let saved: FloorPlan;
      if (isEdit) {
        const body: UpdateFloorPlanRequest = {
          name: name.trim(),
          widthM: width,
          heightM: height,
          backgroundImage,
        };
        saved = await updateFloorPlan(plan.id, body);
        toast.success('Plano actualizado');
      } else {
        const body: CreateFloorPlanRequest = {
          name: name.trim(),
          widthM: width,
          heightM: height,
          backgroundImage,
        };
        saved = await createFloorPlan(body);
        toast.success('Plano creado');
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      const message = describeError(err, isEdit ? 'No se pudo guardar' : 'No se pudo crear el plano');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!isEdit) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteFloorPlan(plan.id);
      toast.success('Plano eliminado');
      onDeleted?.(plan.id);
      onClose();
    } catch (err) {
      const message = describeError(err, 'No se pudo eliminar el plano');
      setError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const footer = (
    <div className="space-y-2">
      {error && <p className="text-kr-sm text-danger">{error}</p>}
      <Button
        onClick={() => void submit()}
        disabled={saving || deleting || !canSubmit}
        className="w-full"
      >
        {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear plano'}
      </Button>
      {isEdit && onDeleted && (
        <Button
          variant="outline"
          onClick={() => void remove()}
          disabled={saving || deleting}
          className="w-full"
        >
          {deleting ? 'Eliminando…' : 'Eliminar plano'}
        </Button>
      )}
    </div>
  );

  return (
    <Slideover
      open
      onClose={onClose}
      title={isEdit ? 'Editar plano' : 'Nuevo plano'}
      subtitle={
        isEdit ? plan.name : 'Define las medidas reales de la planta para calcular la cobertura'
      }
      footer={footer}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="plan-name">Nombre</Label>
          <Input
            id="plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="p. ej. Planta baja"
            maxLength={64}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="plan-width">Ancho (m)</Label>
            <Input
              id="plan-width"
              type="number"
              min={1}
              step={0.5}
              value={widthM}
              onChange={(e) => setWidthM(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-height">Alto (m)</Label>
            <Input
              id="plan-height"
              type="number"
              min={1}
              step={0.5}
              value={heightM}
              onChange={(e) => setHeightM(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="plan-bg">Imagen de fondo (opcional)</Label>
          <p className="text-kr-xs text-kr-muted">
            Sube un plano o boceto de tu casa para dibujar las paredes encima.
          </p>
          {backgroundImage ? (
            <div className="space-y-2">
              <img
                src={backgroundImage}
                alt="Vista previa del plano de fondo"
                className="max-h-40 w-full rounded-md border border-kr object-contain"
              />
              <Button variant="ghost" size="sm" onClick={() => setBackgroundImage(null)}>
                <ImageOff className="h-4 w-4" aria-hidden />
                Quitar imagen
              </Button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-kr px-3 py-6 text-kr-sm text-kr-secondary hover:bg-kr-elevated">
              <Upload className="h-5 w-5" aria-hidden />
              Elegir imagen
              <input
                id="plan-bg"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void onPickImage(e.target.files?.[0])}
              />
            </label>
          )}
        </div>

        <Callout variant="info">
          Las medidas se usan para escalar el mapa de calor. Ajusta ancho y alto a los metros reales
          de tu casa para que la predicción sea fiable.
        </Callout>
      </div>
    </Slideover>
  );
}
