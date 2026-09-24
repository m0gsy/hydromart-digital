import { purgeExecutorProvider } from '../../src/infrastructure/http/purge-executor.registry';
import { AdminConfigService } from '../../src/config/admin-config.service';
import { PurgeExecutor } from '../../src/application/ports/purge-executor.port';

type Factory = (config: AdminConfigService) => PurgeExecutor[];
const build = (urls: Record<string, string>, key = 'internal-key'): PurgeExecutor[] =>
  (purgeExecutorProvider as unknown as { useFactory: Factory }).useFactory({
    serviceUrl: (envKey: string) => urls[envKey] ?? '',
    internalServiceKey: key,
  } as unknown as AdminConfigService);

const ALL = {
  AUTH_SERVICE_URL: 'http://auth:3001',
  CRM_SERVICE_URL: 'http://crm:3012',
  DELIVERY_SERVICE_URL: 'http://delivery:3006',
  HR_SERVICE_URL: 'http://hr:3018',
  PAYMENT_SERVICE_URL: 'http://payment:3005',
  DEPOT_SERVICE_URL: 'http://depot:3007',
};

describe('purge executor registry', () => {
  it('has an executor for every dataset the privacy policy promises to delete', () => {
    const datasets = build(ALL).map((e) => e.dataset);

    // The two below had a policy row and no executor, so the sweep reported them UNENFORCED
    // while the public text said "dihapus" (CA-3-07, CA-3-53).
    expect(datasets).toEqual(
      expect.arrayContaining([
        'audit_logs',
        'notifications_messages',
        'proof_of_delivery',
        'payment_proof',
        'franchise_applications_rejected',
        'hr_employee_records',
        'hr_attendance_photos',
        'hr_audit_logs',
        'hr_face_embeddings',
      ]),
    );
  });

  it('sends payment_proof to payment-service and rejected applications to depot-service', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ purged: 2, deleted: 2 }), { status: 200 });
    });
    try {
      const executors = build(ALL);
      const cutoff = new Date('2025-09-25T00:00:00.000Z');
      for (const dataset of ['payment_proof', 'franchise_applications_rejected']) {
        const executor = executors.find((e) => e.dataset === dataset);
        await expect(executor?.purge(cutoff)).resolves.toBe(2);
      }
    } finally {
      fetchSpy.mockRestore();
    }

    expect(calls).toEqual([
      {
        url: 'http://payment:3005/api/v1/payments/internal/purge-proofs',
        body: JSON.stringify({ cutoff: '2025-09-25T00:00:00.000Z' }),
      },
      {
        url: 'http://depot:3007/api/v1/franchise-applications/internal/purge-rejected',
        body: JSON.stringify({ cutoff: '2025-09-25T00:00:00.000Z' }),
      },
    ]);
  });

  it('drops a dataset whose owner this environment cannot reach, so it reads UNENFORCED', () => {
    const { PAYMENT_SERVICE_URL: _payment, ...withoutPayment } = ALL;

    const datasets = build(withoutPayment).map((e) => e.dataset);

    expect(datasets).not.toContain('payment_proof');
    expect(datasets).toContain('franchise_applications_rejected');
  });

  it('drops everything when the internal key is missing', () => {
    expect(build(ALL, '')).toEqual([]);
  });
});
