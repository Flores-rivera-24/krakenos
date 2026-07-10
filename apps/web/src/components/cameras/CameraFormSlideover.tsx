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
import { useT } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

interface Props {
  /** Si viene una cámara, el panel edita; si no, da de alta una nueva. */
  camera?: Camera | null;
  onClose: () => void;
  /** Refresca la lista tras un alta/edición correcta. */
  onSaved: () => void;
}

export function CameraFormSlideover({ camera, onClose, onSaved }: Props) {
  const t = useT();
  const isEdit = camera != null;
  /** Ayuda en lenguaje llano de "qué es una URL RTSP y dónde encontrarla". */
  const rtspHelp = (
    <span className="block space-y-1">
      <span className="block">{t('cameras.rtspHelp1')}</span>
      <span className="block">
        {t('cameras.rtspHelpFormat')}{' '}
        <code className="break-all font-mono text-kr-xs">{t('cameras.rtspExample')}</code>
      </span>
    </span>
  );
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
        toast.success(t('cameras.updated'));
      } else {
        const body: CreateCameraRequest = {
          name: name.trim(),
          rtspUrl: rtspUrl.trim(),
          room: room_,
          model: model_,
        };
        await createCamera(body);
        toast.success(t('cameras.added'));
      }
      onSaved();
      onClose();
    } catch (err) {
      const message = describeError(
        err,
        isEdit ? t('cameras.saveError') : t('cameras.addError'),
      );
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
        {saving ? t('common.saving') : isEdit ? t('common.saveChanges') : t('cameras.add')}
      </Button>
    </div>
  );

  return (
    <Slideover
      open
      onClose={onClose}
      title={isEdit ? t('cameras.editTitle') : t('cameras.add')}
      subtitle={isEdit ? camera.name : t('cameras.addSubtitle')}
      footer={footer}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cam-name">{t('cameras.name')}</Label>
          <Input
            id="cam-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('cameras.namePlaceholder')}
            maxLength={64}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="cam-rtsp">{t('cameras.rtspLabel')}</Label>
            <HelpHint content={rtspHelp} label={t('cameras.rtspHelpLabel')} />
          </div>
          <Input
            id="cam-rtsp"
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
            placeholder={isEdit ? t('cameras.rtspPlaceholderEdit') : t('cameras.rtspExample')}
            autoComplete="off"
            spellCheck={false}
          />
          <Callout variant="info">{t('cameras.rtspCallout')}</Callout>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="cam-room">{t('cameras.room')}</Label>
            <Input
              id="cam-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder={t('cameras.optional')}
              maxLength={64}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cam-model">{t('cameras.model')}</Label>
            <Input
              id="cam-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('cameras.optional')}
              maxLength={64}
            />
          </div>
        </div>
      </div>
    </Slideover>
  );
}
