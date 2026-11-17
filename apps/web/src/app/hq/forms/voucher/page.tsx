'use client';

import { useRouter } from 'next/navigation';
import { Ticket } from '@phosphor-icons/react';

import { Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { VoucherForm } from '@/components/voucher-form';
import { useT } from '@/lib/locale-context';

/**
 * Design 21b — a new voucher, head office's side. The form is the shared one
 * (components/voucher-form.tsx): head office may make a network code or one for a single
 * depot, public or for the customers it is given to, and keep it as a draft.
 */
export default function HqVoucherFormPage() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Ticket size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('hq.forms.voucher.title')}</h1>
      </div>
      <Card className="p-5">
        <VoucherForm
          voucher={null}
          allowDraft
          onDone={({ active }) => {
            toast(
              t(active ? 'hq.forms.voucher.published' : 'hq.forms.voucher.draftSaved'),
              active ? 'success' : 'info',
            );
            // The list shows drafts too now, so the one just saved is there to find.
            router.push('/hq/vouchers');
          }}
        />
      </Card>
    </div>
  );
}
