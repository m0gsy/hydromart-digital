'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { FaceCapture } from '@/components/hr/face-capture';
import { useToast } from '@/components/toast';
import { Button, Card, SectionHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';

export default function MeEnrollPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [frames, setFrames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(endpoints.hr.enrollFaceMe, { images: frames }, true);
      toast(t('hrFix.enroll.enrolled'));
      setDone(true);
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
        {frames.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm">{frames.length} foto siap</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setFrames([])}>
                {t('hrFix.enroll.reset')}
              </Button>
              <Button onClick={submit} loading={busy}>
                {t('hrFix.enroll.save')}
              </Button>
            </div>
          </div>
        )}
      </Card>
      {done && <Card className="p-4 text-center text-green-700">{t('hrFix.enroll.done')}</Card>}
    </div>
  );
}
