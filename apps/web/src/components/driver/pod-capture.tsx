'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/locale-context';
import { Camera, Eraser, PencilLine, SealCheck } from '@phosphor-icons/react';

import { PrivacyLink } from '@/components/privacy-sheet';
import { Button, Card, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { currentPosition, GeoError } from '@/lib/geo';
import { compressImage } from '@/lib/image';
import { runOrQueue } from '@/lib/offline-queue';

/** Signature pad: freehand pointer drawing on a canvas, exportable as a PNG blob. */
function SignaturePad({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const { t } = useT();
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height,
    };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    const p = point(e);
    if (ctx && last.current) {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };
  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="h-40 w-full touch-none rounded-xl border border-dashed border-[color:var(--border)] bg-white"
      />
      <button
        type="button"
        onClick={clear}
        className="inline-flex items-center gap-1 text-sm text-[color:var(--muted)] hover:text-brand-600"
      >
        <Eraser size={16} />
        {t('hrFix.pod.clearSignature')}
      </button>
    </div>
  );
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Blob → data URL, so a queued proof survives a page reload (a Blob would not). */
// `fallbackError` is passed in rather than translated here: this is a plain helper, and a
// hook cannot be called from one.
function toDataUrl(blob: Blob, fallbackError: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(fallbackError));
    reader.readAsDataURL(blob);
  });
}

function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return !data.some((byte) => byte !== 0);
}

interface Props {
  deliveryId: string;
  orderNumber: string;
  onDone: () => void;
}

/**
 * Proof-of-Delivery capture: a delivery photo (native camera) + a recipient
 * signature (canvas). On submit it uploads both to the storage endpoint (two
 * calls) and completes the delivery with the returned URLs + GPS position.
 */
export function PodCapture({ deliveryId, orderNumber, onDone }: Props) {
  const { t } = useT();
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState('');
  const [sealOk, setSealOk] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPhoto(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const submit = useCallback(async () => {
    setError(null);
    const canvas = canvasRef.current;
    if (!photo) return setError(t('hrFix.pod.photoFirst'));
    if (!sealOk) return setError(t('hrFix.pod.sealFirst'));
    if (!recipientName.trim()) return setError(t('hrFix.pod.nameRequired'));

    setSubmitting(true);
    try {
      const position = await currentPosition();

      // Photo (downscaled) is mandatory. Signature is optional: carried only if the
      // recipient actually drew one. Both travel as data URLs so the queue can survive a
      // reload — the uploads themselves happen inside the queue, online or on flush.
      const photoBlob = await compressImage(photo);
      const signatureBlob = canvas && !isCanvasBlank(canvas) ? await canvasToBlob(canvas) : null;

      // Queued counts as done for the courier: the handover happened, and holding them on
      // this screen until signal returns would strand them at the customer's gate. The
      // driver shell shows the pending item until it reaches the server.
      await runOrQueue({
        kind: 'pod',
        payload: {
          deliveryId,
          orderNumber,
          photo: await toDataUrl(photoBlob, t('hrFix.pod.readFailed')),
          signature: signatureBlob
            ? await toDataUrl(signatureBlob, t('hrFix.pod.readFailed'))
            : undefined,
          // Always true here — Selesai is gated on it above — but sent rather than assumed
          // server-side, because the server must be able to tell "said yes" from "never
          // asked", and an old APK is exactly the second case.
          sealIntact: sealOk,
          recipientName: recipientName.trim(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          note: note.trim() || undefined,
        },
      });
      onDone();
    } catch (e) {
      // J1: `e.message` on a GeoError is its reason token — this screen showed the courier
      // the bare word "timeout" at the one moment they are standing at a customer's door.
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof GeoError
            ? t(`errors.geo.${e.reason}`)
            : e instanceof Error
              ? e.message
              : t('hrFix.pod.finishFailed'),
      );
    } finally {
      setSubmitting(false);
    }
  }, [photo, sealOk, recipientName, note, deliveryId, orderNumber, onDone, t]);

  return (
    <Card className="space-y-4 p-5">
      <h3 className="font-semibold">{t('hrFix.pod.heading', { order: orderNumber })}</h3>

      <div className="space-y-2">
        <span className="text-sm font-medium">{t('hrFix.pod.photo')}</span>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-sm text-[color:var(--muted)] hover:border-brand-500">
          <Camera size={20} />
          {photo ? t('hrFix.pod.replacePhoto') : t('hrFix.pod.takePhoto')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={pickPhoto}
            className="hidden"
          />
        </label>
        {photoPreview && (
          <img
            src={photoPreview}
            alt={t('hrFix.pod.previewAlt')}
            className="max-h-48 rounded-xl object-cover"
          />
        )}
      </div>

      {/* K2.8b: the seal answer is recorded now, not merely gated on. It used to live for
          exactly one button press — so a customer claiming a broken seal and a courier
          insisting it was intact argued with no evidence on either side. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[color:var(--border)] p-3">
        <input
          type="checkbox"
          checked={sealOk}
          onChange={(e) => setSealOk(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-brand-600"
        />
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <SealCheck size={16} weight="fill" className="text-brand-700" />
          {t('hrFix.pod.sealIntact')}
        </span>
      </label>

      <Field label={t('hrFix.pod.recipient')}>
        <Input
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder={t('hrFix.pod.recipientHint')}
          maxLength={120}
        />
      </Field>

      <div className="space-y-2">
        <span className="flex items-center gap-1 text-sm font-medium">
          <PencilLine size={16} /> Tanda tangan penerima
          <span className="text-xs font-normal text-[color:var(--muted)]">
            {t('hrFix.pod.optional')}
          </span>
        </span>
        {/* UU PDP notice: the delivery photo is always stored; the signature is optional
            and, when given, consents to being stored too. */}
        <p className="text-xs leading-relaxed text-[color:var(--muted)]">
          Foto bukti antar disimpan sesuai Kebijakan Privasi. Tanda tangan bersifat opsional; dengan
          menandatangani, penerima menyetujui tanda tangan disimpan sesuai{' '}
          <PrivacyLink className="underline hover:text-brand-600">Kebijakan Privasi</PrivacyLink>.
        </p>
        <SignaturePad canvasRef={canvasRef} />
      </div>

      <Field label={t('hrFix.pod.noteOpt')}>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('hrFix.pod.noteHint')}
          maxLength={255}
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting ? t('hrFix.pod.sending') : t('hrFix.pod.finish')}
      </Button>
    </Card>
  );
}
