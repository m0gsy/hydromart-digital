'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Button, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
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
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[16px] font-extrabold tracking-tight">{t('account.profileCard.edit')}</h1>
      </div>

      {/* Avatar picker */}
      <div className="flex flex-col items-center gap-2">
        <div className="relative">
          {customer.avatarUrl ? (
            <img
              src={customer.avatarUrl}
              alt=""
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
            placeholder="nama@email.com"
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
