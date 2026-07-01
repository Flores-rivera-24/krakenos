import type { Camera, CreateCameraRequest, UpdateCameraRequest } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slideover } from '@/components/ui/slideover';
import { createCamera, updateCamera } from '@/lib/cameras';
import { describeError } from '@/lib/errors';
import { toast } from '@/store/toast.store';

interface Props {
  /** Si viene una cámara, el panel edita; si no, da de alta una nueva. */
  camera?: Camera | null;
  onClose: () => void;
  /** Refresca la lista tras un alta/edición correcta. */
  onSaved: () => void;
}

/** Ayuda en lenguaje llano de "qué es una URL RTSP y dónde encontrarla". */
const RTSP_HELP = (
  <span className="block space-y-1">
    <span className="block">
      Es la dirección del vídeo en directo de tu cámara dentro de tu red. Suele estar en la app o el
      manual de la cámara (busca «RTSP», «ONVIF» o «stream»).
    </span>
    <span className="block">
      Formato típico:{' '}
      <code className="break-all font-mono text-kr-xs">
        rtsp://usuario:contraseña@192.168.1.50:554/stream1
      </code>
    </span>
  </span>
);

export function CameraFormSlideover({ camera, onClose, onSaved }: Props) {
  const isEdit = camera != null;
  const [name, setName] = useState(camera?.name ?? '');
  const [rtspUrl, setRtspUrl] = useState('');
  const [room, setRoom] = useState(camera?.room ?? '');
  const [model, setModel] = useState(camera?.model ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() !== '' && (isEdit || rtspUrl.trim() !== '');

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const room_ = room.trim() === '' ? null : room.trim();
    const model_ = model.trim() === '' ? null : model.trim();
    try {
      if (isEdit) {
        // rtspUrl en blanco = conservar la actual (el backend nunca la devuelve).
        const body: UpdateCameraRequest = {
          name: name.trim(),
          room: room_,
          model: model_,
          ...(rtspUrl.trim() !== '' ? { rtspUrl: rtspUrl.trim() } : {}),
        };
        await updateCamera(camera.id, body);
        toast.success('Cámara actualizada');
      } else {
        const body: CreateCameraRequest = {
          name: name.trim(),
          rtspUrl: rtspUrl.trim(),
          room: room_,
          model: model_,
        };
        await createCamera(body);
        toast.success('Cámara añadida');
      }
      onSaved();
      onClose();
    } catch (err) {
      const message = describeError(err, isEdit ? 'No se pudo guardar' : 'No se pudo añadir la cámara');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="space-y-2">
      {error && <p className="text-kr-sm text-danger">{error}</p>}
      <Button onClick={() => void submit()} disabled={saving || !canSubmit} className="w-full">
        {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Añadir cámara'}
      </Button>
    </div>
  );

  return (
    <Slideover
      open
      onClose={onClose}
      title={isEdit ? 'Editar cámara' : 'Añadir cámara'}
      subtitle={isEdit ? camera.name : 'Conecta una cámara IP por su URL RTSP'}
      footer={footer}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cam-name">Nombre</Label>
          <Input
            id="cam-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="p. ej. Entrada"
            maxLength={64}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="cam-rtsp">URL RTSP</Label>
            <HelpHint content={RTSP_HELP} label="¿Qué es una URL RTSP y dónde encontrarla?" />
          </div>
          <Input
            id="cam-rtsp"
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
            placeholder={
              isEdit
                ? 'dejar en blanco para conservar'
                : 'rtsp://usuario:contraseña@192.168.1.50:554/stream1'
            }
            autoComplete="off"
            spellCheck={false}
          />
          <Callout variant="info">
            La URL y las credenciales que escribas se guardan solo en tu servidor KrakenOS y nunca
            salen a internet.
          </Callout>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="cam-room">Habitación</Label>
            <Input
              id="cam-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="opcional"
              maxLength={64}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cam-model">Modelo</Label>
            <Input
              id="cam-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="opcional"
              maxLength={64}
            />
          </div>
        </div>
      </div>
    </Slideover>
  );
}
