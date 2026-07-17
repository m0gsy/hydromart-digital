'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Camera, Warning } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { compressImage } from '@/lib/image';
import type { CourierIncidentCategory, CourierIncidentSeverity } from '@/lib/types';

const CATEGORIES: { value: CourierIncidentCategory; label: string }[] = [
  { value: 'ACCIDENT', label: 'Kecelakaan' },
  { value: 'VEHICLE_BREAKDOWN', label: 'Kendaraan mogok' },
  { value: 'THEFT_OR_THREAT', label: 'Pencurian / ancaman' },
  { value: 'CUSTOMER_DISPUTE', label: 'Sengketa pelanggan' },
  { value: 'PRODUCT_DAMAGE', label: 'Barang rusak' },
  { value: 'OTHER', label: 'Lainnya' },
];

const SEVERITIES: { value: CourierIncidentSeverity; label: string }[] = [
  { value: 'LOW', label: 'Ringan' },
  { value: 'MEDIUM', label: 'Sedang' },
  { value: 'HIGH', label: 'Darurat' },
];

function NewIncident() {
  const router = useRouter();
  const [category, setCategory] = useState<CourierIncidentCategory | ''>('');
  const [severity, setSeverity] = useState<CourierIncidentSeverity>('MEDIUM');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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

  const submit = async () => {
    if (!category || description.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      let photoUrl: string | undefined;
      if (photo) {
        const blob = await compressImage(photo);
        const res = await uploadFile(
          endpoints.deliveries.driver.upload,
          new File([blob], 'incident.jpg', { type: blob.type || 'image/jpeg' }),
        );
        photoUrl = res.url;
      }
      await api.post(
        endpoints.deliveries.incidents.create,
        { category, severity, description: description.trim(), photoUrl },
        true,
      );
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengirim laporan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4 px-4 py-10 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-600/10 text-brand-600">
          <Warning size={28} weight="fill" />
        </div>
        <div className="text-base font-extrabold">Laporan terkirim</div>
        <p className="text-sm text-black/60">
          {severity === 'HIGH'
            ? 'Insiden darurat diteruskan ke tim operasional. Tetap di tempat aman.'
            : 'Terima kasih. Laporanmu sudah dicatat.'}
        </p>
        <Button className="w-full" onClick={() => router.replace('/driver')}>
          Kembali ke tugas
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-extrabold">Lapor insiden</div>
      </header>

      <Card className="space-y-4 p-4">
        <Field label="Jenis insiden">
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`rounded-xl px-3 py-2.5 text-left text-sm font-bold ${c.value === category ? 'bg-brand-600 text-white' : 'bg-black/5'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Tingkat">
          <div className="flex gap-2">
            {SEVERITIES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSeverity(s.value)}
                className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-bold ${
                  s.value === severity
                    ? s.value === 'HIGH'
                      ? 'bg-red-600 text-white'
                      : 'bg-brand-600 text-white'
                    : 'bg-black/5'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Kronologi" htmlFor="description">
          <Input
            id="description"
            placeholder="Jelaskan singkat apa yang terjadi"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="Foto bukti (opsional)">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--border)] px-4 py-5 text-sm font-bold text-[color:var(--muted)]">
            <Camera size={19} />
            {photo ? 'Ganti foto' : 'Ambil foto'}
            <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} className="hidden" />
          </label>
          {photoPreview && (
            <img src={photoPreview} alt="Pratinjau foto insiden" className="mt-2 max-h-44 rounded-xl object-cover" />
          )}
        </Field>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        loading={busy}
        disabled={!category || description.trim().length < 3}
        className="flex w-full items-center justify-center gap-2"
        onClick={submit}
      >
        <Warning size={19} weight="fill" />
        Kirim laporan
      </Button>
    </div>
  );
}

export default function NewIncidentPage() {
  return (
    <DriverShell nav={false}>
      <NewIncident />
    </DriverShell>
  );
}
