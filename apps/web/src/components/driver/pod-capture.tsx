'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useConfirm } from '@/components/confirm';
import { useDiscardGuard } from '@/lib/use-discard-guard';
import { useT } from '@/lib/locale-context';
import { Camera, Eraser, PencilLine, SealCheck } from '@phosphor-icons/react';

import { PrivacyLink } from '@/components/privacy-sheet';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
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
        className="inline-flex items-center gap-1 text-sm text-[color:var(--text-muted)] hover:text-brand-600"
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
  /** CA-4-17: true when the proof went to the offline queue rather than to the server. */
  onDone: (queued: boolean) => void;
  /**
   * CA-4-34: the way out. This form had none — no cancel, no back — so the only exit was
   * the system back button, which left the page and took the photo, the typed recipient
   * name and the drawn signature with it, silently.
   */
  onCancel: () => void;
}

/**
 * Proof-of-Delivery capture: a delivery photo (native camera) + a recipient
 * signature (canvas). On submit it uploads both to the storage endpoint (two
 * calls) and completes the delivery with the returned URLs + GPS position.
 */
export function PodCapture({ deliveryId, orderNumber, onDone, onCancel }: Props) {
  const { t } = useT();
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState('');
  /*
   * CA-4-35: the seal answer, not a permission to continue.
   *
   * This was a checkbox that had to be TICKED before the handover could be submitted, so a
   * broken seal could not be recorded at all — the courier's only options were to lie or to
   * not deliver. Which means every "seal intact" already in the database was collected
   * under a rule that refused the other answer, and the field K2.8b added to settle
   * disputes could only ever say one thing.
   *
   * Null until answered: "never asked" is not "yes", which is the rule K2.8b wrote and this
   * screen was quietly breaking.
   */
  const [sealOk, setSealOk] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { confirm } = useConfirm();

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
    if (sealOk === null) return setError(t('hrFix.pod.sealFirst'));
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
      const outcome = await runOrQueue({
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
      /*
       * CA-4-17: the success screen has to know this was QUEUED.
       *
       * It reads the delivery back to draw the proof — which, offline, is exactly the
       * request that cannot succeed. So a handover that queued correctly sent the courier
       * to a screen headed "Selesai" that rendered an error, on the one path where being
       * offline is the expected case rather than a fault.
       */
      onDone(outcome.outcome === 'queued');
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

  /*
   * CA-4-34 — "dirty" is anything the courier cannot get back by tapping again.
   *
   * The signature lives on a canvas rather than in state, so it is read directly; a blank
   * canvas is not work. The seal checkbox and the note are one tap and a short line, but
   * they are included because the guard's whole job is to make the discard a decision
   * rather than an accident.
   */
  const signed = () => {
    const canvas = canvasRef.current;
    return !!canvas && !isCanvasBlank(canvas);
  };
  // `sealOk` is tri-state since the seal question gained an "unanswered" value: null is
  // nothing to lose, false ("segel rusak") is an answer somebody gave.
  const dirty =
    !!photo || recipientName.trim() !== '' || note.trim() !== '' || sealOk !== null;

  const confirmDiscard = useCallback(async () => {
    if (!dirty && !signed()) {
      onCancel();
      return;
    }
    /*
     * The app's own dialog, not `window.confirm`. Android's WebChromeClient returns from
     * `confirm()` without showing anything unless the host implements `onJsConfirm`, so in
     * the APK it would answer false and the courier would be trapped in a form with no exit
     * — the very defect this fixes. `test/no-native-dialogs.test.ts` is what keeps it out.
     */
    const ok = await confirm({
      title: t('hrFix.pod.discardTitle'),
      message: t('hrFix.pod.discardConfirm'),
      tone: 'danger',
    });
    if (ok) onCancel();
  }, [confirm, dirty, onCancel, t]);

  useDiscardGuard(dirty, confirmDiscard);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">{t('hrFix.pod.heading', { order: orderNumber })}</h3>
        {/* The exit control this form never had. The back gesture is caught too — see
            `useDiscardGuard` — but a visible way out is the one a courier can find. */}
        <button
          type="button"
          onClick={confirmDiscard}
          className="min-h-11 shrink-0 text-[13px] font-bold text-[color:var(--text-muted)]"
        >
          {t('hrFix.pod.cancel')}
        </button>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">{t('hrFix.pod.photo')}</span>
        {/* `sr-only`, not `hidden`: display:none takes the input out of the tab order, and
            the label around it is not focusable, so proof-of-delivery could only be
            photographed by tapping. Same defect, same fix as components/csv-import.tsx. */}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-sm text-[color:var(--text-muted)] hover:border-brand-500 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600">
          <Camera size={20} />
          {photo ? t('hrFix.pod.replacePhoto') : t('hrFix.pod.takePhoto')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={pickPhoto}
            className="sr-only"
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

      {/* K2.8b: the seal answer is recorded, not merely gated on — a customer claiming a
          broken seal and a courier insisting it was intact used to argue with no evidence
          on either side. CA-4-35: and BOTH answers submit. A tick-box that had to be
          ticked meant a broken seal could not be recorded at all. */}
      <fieldset className="rounded-xl border border-[color:var(--border)] p-3">
        <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
          <SealCheck size={16} weight="fill" className="text-brand-700" />
          {t('hrFix.pod.sealQuestion')}
        </legend>
        <div className="mt-2 flex gap-2">
          {([true, false] as const).map((answer) => (
            <button
              key={String(answer)}
              type="button"
              onClick={() => setSealOk(answer)}
              aria-pressed={sealOk === answer}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${
                sealOk === answer
                  ? answer
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-[color:var(--danger)] bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
                  : 'border-[color:var(--border)]'
              }`}
            >
              {t(answer ? 'hrFix.pod.sealIntact' : 'hrFix.pod.sealBroken')}
            </button>
          ))}
        </div>
      </fieldset>

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
          <span className="text-xs font-normal text-[color:var(--text-muted)]">
            {t('hrFix.pod.optional')}
          </span>
        </span>
        {/* UU PDP notice: the delivery photo is always stored; the signature is optional
            and, when given, consents to being stored too. */}
        <p className="text-xs leading-relaxed text-[color:var(--text-muted)]">
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

      <FormError message={error} />

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting ? t('hrFix.pod.sending') : t('hrFix.pod.finish')}
      </Button>
    </Card>
  );
}
