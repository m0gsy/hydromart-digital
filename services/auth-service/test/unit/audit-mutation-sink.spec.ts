import { AuthAuditMutationSink } from '../../src/infrastructure/audit-mutation.sink';
import { AuditService } from '../../src/application/services/audit.service';

/**
 * CA-2-67: who changed the RBAC matrix, and who granted somebody a role, reached no trail
 * at all — the only actions ever recorded were login, OTP and token events.
 *
 * This sink writes to the table directly rather than posting to this service's own ingest,
 * so what these assert is the mapping onto the row: the actor lands in the column the
 * console filters on, and the target survives into the metadata.
 */
describe('AuthAuditMutationSink (CA-2-67)', () => {
  const make = () => {
    const entries: unknown[] = [];
    const audit = { record: jest.fn(async (e: unknown) => void entries.push(e)) };
    return { entries, sink: new AuthAuditMutationSink(audit as unknown as AuditService) };
  };

  it('writes a role change against the acting account', async () => {
    const { entries, sink } = make();
    await sink.record({
      action: 'access.matrix.changed',
      actorId: 'u-7',
      target: 'settingsGlobal',
      metadata: { params: {} },
    });

    expect(entries).toEqual([
      {
        // Accounts and staff share one table, so the trail's actor column is `customerId`.
        customerId: 'u-7',
        action: 'auth.access.matrix.changed',
        success: true,
        ipAddress: null,
        userAgent: null,
        metadata: { params: {}, target: 'settingsGlobal' },
      },
    ]);
  });

  it('keeps a refused change, and a system actor, as they are', async () => {
    const { entries, sink } = make();
    await sink.record({ action: 'staff.invite.created', success: false });

    expect(entries[0]).toMatchObject({
      customerId: null,
      action: 'auth.staff.invite.created',
      success: false,
      metadata: {},
    });
  });
});
