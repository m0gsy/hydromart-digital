'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { FaceCapture } from '@/components/hr/face-capture';
import { useConfirm } from '@/components/confirm';
import { useToast } from '@/components/toast';
import { Button, Card, SectionHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';

export default function MeEnrollPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [frames, setFrames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // HR-3: biometric data needs explicit consent. Unticked is not consent, so the button
  // stays disabled rather than sending frames the server will refuse.
  const [consent, setConsent] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(endpoints.hr.enrollFaceMe, { images: frames, consent: true }, true);
      toast(t('hrFix.enroll.enrolled'));
      setDone(true);
      setFrames([]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.enroll.enrollFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    const ok = await confirm({
      title: t('hrFix.enroll.withdraw'),
      message: t('hrFix.enroll.withdrawConfirm'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del(endpoints.hr.faceDataMe, true);
      toast(t('hrFix.enroll.withdrawn'));
      setDone(false);
      setConsent(false);
      setFrames([]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.enroll.enrollFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <SectionHeader title={t('hrFix.enroll.title')} subtitle={t('hrFix.enroll.subtitle')} />
      <Card className="space-y-3 p-5">
        <FaceCapture
          onCapture={(f) => setFrames((p) => [...p, f].slice(0, 3))}
          disabled={frames.length >= 3}
        />
        <label className="flex items-start gap-2 rounded-xl border border-app p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            <span className="block font-medium">{t('hrFix.enroll.consentTitle')}</span>
            <span className="mt-0.5 block text-xs text-muted">{t('hrFix.enroll.consentText')}</span>
          </span>
        </label>
        {frames.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm">{frames.length} foto siap</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setFrames([])}>
                {t('hrFix.enroll.reset')}
              </Button>
              <Button onClick={submit} loading={busy} disabled={!consent}>
                {t('hrFix.enroll.save')}
              </Button>
            </div>
          </div>
        )}
      </Card>
      {done && <Card className="p-4 text-center text-[color:var(--success)]">{t('hrFix.enroll.done')}</Card>}
      {/* HR-3: consent that cannot be taken back is not consent. */}
      <Card className="p-5">
        <Button variant="ghost" onClick={withdraw} loading={busy}>
          {t('hrFix.enroll.withdraw')}
        </Button>
      </Card>
    </div>
  );
}
