'use client';

import { useState } from 'react';

import { RemoteImage } from '@/components/remote-image';
import { useToast } from '@/components/toast';
import { ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { mediaUrl } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { Reseller } from '@/lib/reseller';

// SOP §7: the agen's registration photo. Thumbnail doubles as the picker — the row has
// no space for a separate button, and there is only ever one photo.
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export function ResellerPhoto({ reseller: r, onChanged }: { reseller: Reseller; onChanged: () => void }) {
  const { t } = useT();
  const { toast: notify } = useToast();
  const [busy, setBusy] = useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) {
      notify(t('hrFix.resellers.photoTooBig'), 'error');
      return;
    }
    setBusy(true);
    try {
      await uploadFile(endpoints.resellers.uploadPhoto(r.customerId), file);
      notify(t('hrFix.resellers.photoSaved'));
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('hrFix.resellers.photoFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      className={`relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-app bg-[color:var(--surface-muted)] text-[10px] font-semibold text-muted ${
        busy ? 'opacity-60' : ''
      }`}
      title={r.photoUrl ? t('hrFix.resellers.replacePhoto') : t('hrFix.resellers.uploadPhoto')}
    >
      <RemoteImage
        src={mediaUrl(r.photoUrl)}
        alt="Foto agen"
        width={48}
        height={48}
        className="h-full w-full object-cover"
        fallback={<span>{t('hrFix.resellers.photo')}</span>}
      />
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={busy}
        onChange={pick}
        aria-label={`Foto agen ${r.customerId}`}
      />
    </label>
  );
}
