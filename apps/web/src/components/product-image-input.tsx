'use client';

import { useId, useRef, useState } from 'react';
import { ImageSquare, Trash, UploadSimple } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { Button } from '@/components/ui';
import { ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { mediaUrl } from '@/lib/format';
import { useT } from '@/lib/locale-context';

/**
 * One product photo slot: preview, pick, replace, clear.
 *
 * Replaces the raw-URL text boxes the product forms used to carry. `POST
 * /products/api/v1/products/images` had been built, tested and wired into the endpoint
 * table months earlier and never called once, so the only way to give a product a photo
 * was to host the file somewhere else and paste a link — which is why production
 * products have no photos at all.
 *
 * Unlike the QRIS uploader this is modelled on, the product endpoint takes a bare file
 * and hands back a URL: it needs no saved entity, so this works while ADDING a product,
 * not only while editing one.
 *
 * The server sniffs magic bytes and caps the body at 5 MB. The check here is the same
 * limit stated twice on purpose — it turns a 10 MB round trip into an instant message,
 * and the server stays the authority.
 *
 * ponytail: uploading and then abandoning the form leaves an orphaned object in the
 * bucket; nothing collects it. Accepted — the cost is one small file, and a periodic
 * sweep is the fix if it ever stops being.
 */
const MAX_BYTES = 5 * 1024 * 1024;

export function ProductImageInput({
  value,
  onChange,
  onRemove,
  ariaLabel,
  compact = false,
}: {
  value: string;
  onChange: (url: string) => void;
  /** Rendered as a delete control when given — the gallery slots use it. */
  onRemove?: () => void;
  ariaLabel?: string;
  /** Gallery slots sit in a row and use a smaller preview. */
  compact?: boolean;
}) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared before the await so picking the SAME file twice still fires a change event.
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(t('dashC.productsManage.imageTooLarge'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { url } = await uploadFile<{ url: string }>(endpoints.products.uploadImage, file);
      onChange(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashC.productsManage.imageUploadError'));
    } finally {
      setBusy(false);
    }
  }

  const box = compact ? 'h-16 w-16' : 'h-28 w-28';

  return (
    <div className="flex items-start gap-3">
      {value ? (
        <RemoteImage
          src={mediaUrl(value)}
          alt={ariaLabel ?? t('dashC.productsManage.imageAlt')}
          className={`${box} shrink-0 rounded-lg border border-app object-contain`}
          fallback={
            <div
              className={`${box} flex shrink-0 items-center justify-center rounded-lg border border-dashed border-app text-muted`}
            >
              <ImageSquare size={compact ? 18 : 24} />
            </div>
          }
        />
      ) : (
        <div
          className={`${box} flex shrink-0 items-center justify-center rounded-lg border border-dashed border-app text-muted`}
        >
          <ImageSquare size={compact ? 18 : 24} />
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={onPick}
          aria-label={ariaLabel ?? t('dashC.productsManage.imagePick')}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>
            <UploadSimple size={16} className="mr-1.5" />
            {value ? t('dashC.productsManage.imageReplace') : t('dashC.productsManage.imageUpload')}
          </Button>
          {onRemove && (
            <Button variant="ghost" onClick={onRemove} aria-label={t('dashC.productsManage.imageRemove')}>
              <Trash size={16} />
            </Button>
          )}
        </div>
        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
