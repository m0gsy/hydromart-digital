'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, X } from '@phosphor-icons/react';

import { Badge, Button, Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { APPLICATION_QUEUE_STUB, StubBadge } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 5b — application detail: completeness checklist + reject / approve-and-provision.
// STUB data; the "Setujui & provision" action is a REAL handoff — it navigates to the
// depot onboard form (/hq/depots?onboard=1, design 3b) which auto-opens the form.
export default function HqApplicationDetailPage() {
  const param = useParams();
  const id = (Array.isArray(param.id) ? param.id[0] : param.id) ?? '';
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const app = APPLICATION_QUEUE_STUB.find((a) => a.id === id);

  if (!app) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/hq/applications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
          <ArrowLeft size={16} weight="bold" /> {t('hq.applications.detail.back')}
        </Link>
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.applications.detail.notFound')}</p>
        </Card>
      </div>
    );
  }

  const applicantName = app.applicant;
  const docs: { key: keyof typeof app.docs; done: boolean }[] = (
    ['ktp', 'npwp', 'location', 'deposit', 'agreement'] as const
  ).map((k) => ({ key: k, done: app.docs[k] }));
  const complete = docs.every((d) => d.done);

  function reject() {
    toast(t('hq.applications.detail.rejected', { name: applicantName }), 'info');
    router.push('/hq/applications');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/hq/applications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
          <ArrowLeft size={16} weight="bold" /> {t('hq.applications.detail.back')}
        </Link>
        <StubBadge />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{app.applicant}</h1>
        <Badge tone="brand">{t(`hq.applications.stage.${app.stage}`)}</Badge>
        <Badge tone={app.ageDays >= 5 ? 'danger' : 'neutral'}>{t('hq.applications.age', { n: app.ageDays })}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.applications.proposed')}</p>
            <p className="mt-1 font-semibold">{app.proposedName}</p>
            <p className="text-sm text-muted">{app.city}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.applications.detail.contact')}</p>
            <p className="mt-1 text-sm">{app.phone}</p>
            <p className="text-sm text-muted">{app.email}</p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-extrabold">{t('hq.applications.detail.docsTitle')}</p>
              <Badge tone={complete ? 'success' : 'warning'}>
                {complete ? t('hq.applications.detail.complete') : t('hq.applications.detail.incomplete')}
              </Badge>
            </div>
            <ul className="flex flex-col gap-2">
              {docs.map((d) => (
                <li key={d.key} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={
                      'flex h-5 w-5 items-center justify-center rounded-full ' +
                      (d.done ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]' : 'bg-[color:var(--surface-soft)] text-muted')
                    }
                  >
                    {d.done ? <Check size={13} weight="bold" /> : <X size={13} weight="bold" />}
                  </span>
                  <span className={d.done ? '' : 'text-muted'}>{t(`hq.applications.detail.doc.${d.key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="flex h-fit flex-col gap-3 p-5">
          <Button
            className="w-full"
            onClick={() => router.push('/hq/depots?onboard=1')}
          >
            {t('hq.applications.detail.provision')}
          </Button>
          <p className="text-xs text-muted">{t('hq.applications.detail.provisionHint')}</p>
          <Button variant="danger" className="w-full" onClick={reject}>
            {t('hq.applications.detail.reject')}
          </Button>
        </Card>
      </div>
    </div>
  );
}
