'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Eraser, PencilLine, SealCheck } from '@phosphor-icons/react';

import { Button, Card, Field, Input } from '@/components/ui';
import { ApiError, api, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { currentPosition } from '@/lib/geo';
import { compressImage } from '@/lib/image';

/** Signature pad: freehand pointer drawing on a canvas, exportable as a PNG blob. */
function SignaturePad({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
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
        <Eraser size={16} /> Hapus tanda tangan
      </button>
    </div>
  );
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
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
    if (!photo) return setError('Ambil foto bukti pengantaran dulu.');
    if (!sealOk) return setError('Konfirmasi cek segel galon dulu.');
    if (!recipientName.trim()) return setError('Isi nama penerima.');

    setSubmitting(true);
    try {
      const position = await currentPosition();

      // Photo (downscaled) is mandatory. Signature is optional: upload it only if the
      // recipient actually drew one, otherwise complete without it.
      const photoBlob = await compressImage(photo);
      const { url: photoUrl } = await uploadFile(
        endpoints.deliveries.driver.upload,
        new File([photoBlob], 'photo.jpg', { type: photoBlob.type || 'image/jpeg' }),
      );

      let signatureUrl: string | undefined;
      if (canvas && !isCanvasBlank(canvas)) {
        const signatureBlob = await canvasToBlob(canvas);
        if (signatureBlob) {
          ({ url: signatureUrl } = await uploadFile(
            endpoints.deliveries.driver.upload,
            new File([signatureBlob], 'signature.png', { type: 'image/png' }),
          ));
        }
      }

      await api.post(
        endpoints.deliveries.driver.complete(deliveryId),
        {
          photoUrl,
          signatureUrl,
          recipientName: recipientName.trim(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          note: note.trim() || undefined,
        },
        true,
      );
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Gagal menyelesaikan pengantaran.');
    } finally {
      setSubmitting(false);
    }
  }, [photo, sealOk, recipientName, note, deliveryId, onDone]);

  return (
    <Card className="space-y-4 p-5">
      <h3 className="font-semibold">Bukti pengantaran · {orderNumber}</h3>

      <div className="space-y-2">
        <span className="text-sm font-medium">Foto pengantaran</span>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-sm text-[color:var(--muted)] hover:border-brand-500">
          <Camera size={20} />
          {photo ? 'Ganti foto' : 'Ambil foto'}
          <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} className="hidden" />
        </label>
        {photoPreview && (
          <img src={photoPreview} alt="Pratinjau foto pengantaran" className="max-h-48 rounded-xl object-cover" />
        )}
      </div>

      {/* Seal-check gate (spec): courier must confirm the gallon seal is intact before
          closing the delivery. ponytail: client-side gate only — ProofOfDeliveryDto has no
          seal field yet, so it isn't persisted; add `sealIntact` to the proof DTO to record it. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[color:var(--border)] p-3">
        <input
          type="checkbox"
          checked={sealOk}
          onChange={(e) => setSealOk(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-brand-600"
        />
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <SealCheck size={16} weight="fill" className="text-brand-700" />
          Segel galon utuh & tidak bocor
        </span>
      </label>

      <Field label="Nama penerima">
        <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="cth. Budi Santoso" maxLength={120} />
      </Field>

      <div className="space-y-2">
        <span className="flex items-center gap-1 text-sm font-medium">
          <PencilLine size={16} /> Tanda tangan penerima
          <span className="text-xs font-normal text-[color:var(--muted)]">(opsional)</span>
        </span>
        {/* UU PDP notice: the delivery photo is always stored; the signature is optional
            and, when given, consents to being stored too. */}
        <p className="text-xs leading-relaxed text-[color:var(--muted)]">
          Foto bukti antar disimpan sesuai Kebijakan Privasi. Tanda tangan bersifat opsional; dengan menandatangani, penerima menyetujui tanda tangan disimpan sesuai{' '}
          <a href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-600">
            Kebijakan Privasi
          </a>
          .
        </p>
        <SignaturePad canvasRef={canvasRef} />
      </div>

      <Field label="Catatan (opsional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="cth. Diterima langsung oleh pelanggan" maxLength={255} />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting ? 'Mengirim…' : 'Selesaikan pengantaran'}
      </Button>
    </Card>
  );
}
