'use client';

import { useState } from 'react';
import { CrosshairSimple } from '@phosphor-icons/react';

import { PrivacyLink } from '@/components/privacy-sheet';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { currentPosition } from '@/lib/geo';
import { toIndonesianE164 } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { franchise as franchiseID } from '@/lib/dictionaries/id/franchise';
import { franchise as franchiseEN } from '@/lib/dictionaries/en/franchise';

interface Receipt {
  id: string;
  proposedCode: string;
  proposedName: string;
  submittedAt: string;
}

const EMPTY = {
  applicantName: '',
  applicantPhone: '',
  proposedCode: '',
  proposedName: '',
  city: '',
  province: '',
  lat: '',
  lng: '',
  investmentAmount: '',
  projectedMonthlyRevenue: '',
};

/**
 * Public franchise application (design 5a). The only unauthenticated write in
 * depot-service; the approvals queue that reads these rows lives at /hq/applications.
 * The response is a receipt, not the record, so there is nothing here to poll.
 */
export default function FranchiseApplicationPage() {
  const { locale } = useT();
  const copy = locale === 'en' ? franchiseEN : franchiseID;

  const [form, setForm] = useState({ ...EMPTY });
  /*
   * CA-3-53. This form collected a name, a WhatsApp number and a GPS pin from a member of
   * the public with no consent asked, no policy linked and no retention stated. Never
   * pre-ticked, and kept OUT of `EMPTY` on purpose so "kirim pengajuan lain" starts the
   * next applicant from an unticked box rather than inheriting the previous person's act.
   * The server refuses a submission without it too (`SubmitFranchiseApplicationDto`) — a
   * checkbox the client alone enforces is a checkbox curl skips.
   */
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // No map anywhere in the app any more, so the pin comes from the browser or from the
  // two number fields. Geolocation only fills them in — the applicant can still correct
  // it, which matters because people apply from home, not from the proposed site.
  async function locate() {
    setLocating(true);
    setError(null);
    try {
      const pos = await currentPosition();
      setForm((f) => ({
        ...f,
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
      }));
    } catch {
      setError(copy.locationDenied);
    } finally {
      setLocating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const phone = toIndonesianE164(form.applicantPhone);
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const investmentAmount = Number(form.investmentAmount);
    const projectedMonthlyRevenue = Number(form.projectedMonthlyRevenue);

    if (!form.applicantName.trim()) return setError(copy.needName);
    if (!/^\+628\d{7,11}$/.test(phone)) return setError(copy.needPhone);
    if (!form.proposedCode.trim()) return setError(copy.needCode);
    if (!form.proposedName.trim()) return setError(copy.needDepotName);
    if (!form.city.trim()) return setError(copy.needCity);
    if (!form.province.trim()) return setError(copy.needProvince);
    if (!form.lat || !form.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return setError(copy.needLocation);
    }
    if (!consent) return setError(copy.needConsent);
    if (
      !Number.isFinite(investmentAmount) ||
      investmentAmount < 0 ||
      !Number.isFinite(projectedMonthlyRevenue) ||
      projectedMonthlyRevenue < 0
    ) {
      return setError(copy.needMoney);
    }

    setBusy(true);
    setError(null);
    try {
      const sent = await api.post<Receipt>(endpoints.franchiseApps.submit, {
        applicantName: form.applicantName.trim(),
        applicantPhone: phone,
        proposedCode: form.proposedCode.trim().toUpperCase(),
        proposedName: form.proposedName.trim(),
        city: form.city.trim(),
        province: form.province.trim(),
        lat,
        lng,
        investmentAmount,
        projectedMonthlyRevenue,
        privacyConsent: true,
      });
      setReceipt(sent);
      setForm({ ...EMPTY });
      setConsent(false);
    } catch (err) {
      // A taken depot code and the 3/hour throttle both come back with a real message;
      // only an unrecognized failure falls through to the generic line.
      setError(err instanceof ApiError ? err.message : copy.submitError);
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.sentTitle}</h1>
        <p className="mt-3 text-[14px] leading-relaxed">{copy.sentBody}</p>
        <Card className="mt-5 flex flex-col gap-2 p-5 text-[13.5px]">
          <div className="flex justify-between gap-4">
            <span className="text-muted">{copy.sentReceipt}</span>
            <span className="font-mono font-semibold">{receipt.id}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">{copy.sentCode}</span>
            <span className="font-semibold">{receipt.proposedCode}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">{copy.sentAt}</span>
            <span className="font-semibold">
              {new Date(receipt.submittedAt).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID')}
            </span>
          </div>
        </Card>
        <Button className="mt-5" variant="secondary" onClick={() => setReceipt(null)}>
          {copy.sentAnother}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.title}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">{copy.intro}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-6" noValidate>
        <section className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold">{copy.applicant}</h2>
          <Field label={copy.applicantName} htmlFor="fa-name">
            <Input id="fa-name" value={form.applicantName} onChange={set('applicantName')} />
          </Field>
          <Field label={copy.applicantPhone} htmlFor="fa-phone" hint={copy.phoneHint}>
            <Input
              id="fa-phone"
              inputMode="tel"
              value={form.applicantPhone}
              onChange={set('applicantPhone')}
              placeholder="081234567890"
            />
          </Field>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold">{copy.depot}</h2>
          <Field label={copy.proposedCode} htmlFor="fa-code" hint={copy.codeHint}>
            <Input
              id="fa-code"
              value={form.proposedCode}
              onChange={set('proposedCode')}
              placeholder="BDG-02"
            />
          </Field>
          <Field label={copy.proposedName} htmlFor="fa-depot-name">
            <Input id="fa-depot-name" value={form.proposedName} onChange={set('proposedName')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.city} htmlFor="fa-city">
              <Input id="fa-city" value={form.city} onChange={set('city')} />
            </Field>
            <Field label={copy.province} htmlFor="fa-province">
              <Input id="fa-province" value={form.province} onChange={set('province')} />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold">{copy.location}</h2>
          <p className="text-[12.5px] leading-relaxed text-muted">{copy.locationHint}</p>
          <Button type="button" variant="secondary" onClick={locate} loading={locating}>
            <CrosshairSimple size={16} weight="bold" className="mr-1.5 inline" />
            {locating ? copy.locating : copy.useMyLocation}
          </Button>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.lat} htmlFor="fa-lat">
              <Input
                id="fa-lat"
                inputMode="decimal"
                value={form.lat}
                onChange={set('lat')}
                placeholder="-6.914744"
              />
            </Field>
            <Field label={copy.lng} htmlFor="fa-lng">
              <Input
                id="fa-lng"
                inputMode="decimal"
                value={form.lng}
                onChange={set('lng')}
                placeholder="107.609810"
              />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[15px] font-extrabold">{copy.money}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.investmentAmount} htmlFor="fa-investment">
              <Input
                id="fa-investment"
                inputMode="numeric"
                value={form.investmentAmount}
                onChange={set('investmentAmount')}
                placeholder="150000000"
              />
            </Field>
            <Field label={copy.projectedMonthlyRevenue} htmlFor="fa-revenue">
              <Input
                id="fa-revenue"
                inputMode="numeric"
                value={form.projectedMonthlyRevenue}
                onChange={set('projectedMonthlyRevenue')}
                placeholder="45000000"
              />
            </Field>
          </div>
        </section>

        <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
            /* The visible sentence names the policy through a nested button, and a nested
               control does not contribute to the label its checkbox is computed from — so a
               screen reader would announce a consent with the thing consented to missing.
               Same reason as the register form's box. */
            aria-label={`${copy.consentPre}${copy.consentPrivacy}${copy.consentPost}`}
          />
          <span>
            {copy.consentPre}
            <PrivacyLink>{copy.consentPrivacy}</PrivacyLink>
            {copy.consentPost}
          </span>
        </label>

        <FormError message={error} />
        <Button type="submit" loading={busy}>
          {copy.submit}
        </Button>
      </form>
    </div>
  );
}
