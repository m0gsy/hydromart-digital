'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Button, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Customer } from '@/lib/types';

// Max avatar upload — mirrors the auth-service limit (rejects client-side first).
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function EditProfileInner() {
  const { t, locale } = useT();
  const { customer, session, signIn } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(customer?.fullName ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  /*
   * H16. The birthday reward is built end to end on the server — a `birthdate` column, a
   * PATCH that sets it, a `lastBirthdayRewardYear` guard, configurable points and a daily
   * sweep that grants them — and it could never once fire, because no screen had ever
   * asked anybody for a date of birth. Production on 22 Aug 2026: 4 profiles, 0 with one.
   *
   * It lives here rather than at sign-up: this is the screen that already owns name, email
   * and photo, and a date of birth is personal data nobody should have to hand over to
   * make an account. Optional, and clearable — the deletion page has promised "Tanggal
   * lahir dihapus" since before the field existed to delete.
   */
  const profile = useAsync<{ birthdate: string | null } | null>(
    () => (customer ? api.get(endpoints.profile.me, true) : Promise.resolve(null)),
    [customer?.id],
  );
  const [birthdate, setBirthdate] = useState<string | null>(null);
  const loaded = profile.data?.birthdate ?? null;
  useEffect(() => setBirthdate(loaded), [loaded]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!customer || !session) return <Skeleton className="h-96 w-full rounded-[24px]" />;

  // ponytail: two photo labels are locale-ternary chrome (like /register) — promote
  // to dictionary keys if this screen grows.
  const photoHint = locale === 'en' ? 'Add a photo (optional)' : 'Tambahkan foto (opsional)';
  const changePhoto = locale === 'en' ? 'Change photo' : 'Ganti foto';
  const initial = (customer.fullName ?? customer.phone ?? '?').charAt(0).toUpperCase();

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file || !session) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setError(locale === 'en' ? 'Photo exceeds 5MB.' : 'Foto melebihi 5MB.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const updated = await uploadFile<Customer>(endpoints.auth.uploadAvatar, file);
      signIn({ ...session, customer: updated });
      toast(t('account.profileCard.saved'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('account.profileCard.saveError'));
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<Customer>(
        endpoints.auth.updateProfile,
        { fullName: name.trim(), email: email.trim() || undefined },
        true,
      );
      /*
       * Two writes, two services: the identity fields live in auth-service, the birthdate
       * in customer-service. Sent only when it actually moved, so an untouched form still
       * costs one request. An empty field means "remove it" and must be `null`, not '' —
       * the DTO validates a date string and would refuse the empty one.
       */
      if ((birthdate || null) !== loaded) {
        await api.patch(endpoints.profile.me, { birthdate: birthdate || null }, true);
        profile.reload();
      }
      signIn({ ...session, customer: updated });
      toast(t('account.profileCard.saved'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('account.profileCard.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[430px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          href="/account"
          aria-label={t('account.profileCard.title')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[16px] font-extrabold tracking-tight">{t('account.profileCard.edit')}</h1>
      </div>

      {/* Avatar picker */}
      <div className="flex flex-col items-center gap-2">
        <div className="relative">
          {customer.avatarUrl ? (
            <RemoteImage
              src={customer.avatarUrl}
              alt=""
              width={88}
              height={88}
              className="h-[88px] w-[88px] rounded-full object-cover"
            />
          ) : (
            <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[color:var(--text)] text-[32px] font-extrabold text-[color:var(--surface)]">
              {initial}
            </span>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={changePhoto}
            className="absolute bottom-0 right-0 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-[color:var(--surface-muted)] transition-colors hover:bg-brand-700"
          >
            <Camera size={15} weight="fill" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPickFile}
            className="hidden"
          />
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-[12.5px] font-bold text-brand-700 hover:text-brand-800 disabled:text-muted"
        >
          {uploading ? t('account.profileCard.save') + '…' : changePhoto}
        </button>
        <p className="text-[13px] text-muted">{photoHint}</p>
      </div>

      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label={t('account.profileCard.name')} htmlFor="edit-name">
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field
          label={`${t('account.profileCard.email')} ${t('account.profileCard.emailOptional')}`}
          htmlFor="edit-email"
          error={error ?? undefined}
        >
          <Input
            id="edit-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder={t('hrFix.accountEdit.emailHint')}
          />
        </Field>
        <Field label={t('account.profileCard.birthdate')} htmlFor="edit-birthdate" hint={t('account.profileCard.birthdateHint')}>
          <Input
            id="edit-birthdate"
            type="date"
            value={birthdate ?? ''}
            onChange={(e) => setBirthdate(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={saving} className="h-[52px] rounded-[14px] text-[15px] font-extrabold">
          {t('account.profileCard.save')}
        </Button>
      </form>
    </div>
  );
}

export default function EditProfilePage() {
  return (
    <RequireAuth>
      <EditProfileInner />
    </RequireAuth>
  );
}
