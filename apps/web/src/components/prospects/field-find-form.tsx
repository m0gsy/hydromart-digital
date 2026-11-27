'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PinField } from '@/components/prospects/pin-field';
import { saveError } from '@/components/prospects/save-error';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { labelKey, PROSPECT_CATEGORIES } from '@/lib/prospect-labels';
import type { Pin } from '@/lib/prospect-pin';
import type { ProspectDetail } from '@/lib/types';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

/** A business found in the field. The server forces source FIELD and decides the owner depot; the result card says which. */
export function FieldFindForm() {
  const { t } = useT();
  const { depots } = useDepot();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState<Pin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<ProspectDetail | null>(null);

  async function save() {
    if (!name.trim() || !category) return setError(t('opsFix.prospectsField.field.nameMissing'));
    if (!pin) return setError(t('opsFix.prospectsField.field.pinMissing'));
    setBusy(true);
    setError(null);
    try {
      const optional = { phone, contactName: contact, address, note };
      setMade(
        await api.post<ProspectDetail>(
          endpoints.prospects.create,
          {
            name: name.trim(),
            category,
            latitude: pin.lat,
            longitude: pin.lng,
            ...Object.fromEntries(
              Object.entries(optional)
                .filter(([, v]) => v.trim())
                .map(([k, v]) => [k, v.trim()]),
            ),
          },
          true,
        ),
      );
    } catch (e) {
      // 409 carries the refusal (duplicate, do-not-contact, already a customer); 404 = the pin is not in your depot's area.
      setError(e instanceof ApiError && e.status === 404 ? t('opsFix.prospectsField.field.outOfArea') : saveError(e, t).message);
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setMade(null);
    setName('');
    setCategory('');
    setPhone('');
    setContact('');
    setAddress('');
    setNote('');
    setPin(null);
  }

  if (made) {
    const depot = depots.find((d) => d.id === made.ownerDepotId);
    return (
      <Card className="flex flex-col gap-3 p-4" elevated={false}>
        <h2 className="text-base font-semibold">{t('opsFix.prospectsField.field.saved')}</h2>
        <p className="text-sm">{made.name}</p>
        <p className="text-sm" role="status">
          {made.ownerDepotId
            ? t('opsFix.prospectsField.field.ownerDepot', {
                depot: depot ? `${depot.code} - ${depot.name}` : t('opsFix.prospectsField.field.ownerOther'),
              })
            : t('opsFix.prospectsField.field.ownerNone')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/prospects/detail?id=${made.id}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white"
          >
            {t('opsFix.prospectsField.field.open')}
          </Link>
          <Button variant="secondary" onClick={again}>
            {t('opsFix.prospectsField.field.addAnother')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('opsFix.prospectsField.field.name')} htmlFor="field-name">
        <Input id="field-name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('opsFix.prospectsField.field.category')} htmlFor="field-category">
        <select id="field-category" className={SELECT} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('opsFix.prospectsField.field.pickCategory')}</option>
          {PROSPECT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(labelKey('category', c))}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('opsFix.prospectsField.field.phone')} htmlFor="field-phone">
        <Input id="field-phone" type="tel" inputMode="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label={t('opsFix.prospectsField.field.contact')} htmlFor="field-contact">
        <Input id="field-contact" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} />
      </Field>
      <Field label={t('opsFix.prospectsField.field.address')} htmlFor="field-address">
        <Input id="field-address" maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label={t('opsFix.prospectsField.field.note')} htmlFor="field-note">
        <Input id="field-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <h2 className="text-sm font-semibold">{t('opsFix.prospectsField.pin.title')}</h2>
      <PinField pin={pin} onPin={setPin} />
      <FormError message={error} />
      <Button className="w-full" loading={busy} onClick={save}>
        {t('opsFix.prospectsField.field.save')}
      </Button>
    </div>
  );
}
