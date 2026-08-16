import { CAPABILITIES, STAFF_IMPORT_ROLES, can } from './index';

describe('CAPABILITIES', () => {
  it('grants a capability only to its listed roles', () => {
    expect(can('inventoryWrite', 'KEPALA_DEPOT')).toBe(true);
    expect(can('inventoryWrite', 'HEAD_OFFICE')).toBe(false); // read-only, not write
    expect(can('payout', 'FRANCHISE_OWNER')).toBe(true);
    // SUPER_ADMIN is a superuser: holds every capability even when not listed.
    expect(can('payout', 'SUPER_ADMIN')).toBe(true);
    expect(can('courierPayout', 'SUPER_ADMIN')).toBe(true);
  });

  it('rejects null / empty / customer roles', () => {
    expect(can('orderQueue', null)).toBe(false);
    expect(can('orderQueue', undefined)).toBe(false);
    expect(can('orderQueue', '')).toBe(false);
    expect(can('orderQueue', 'CUSTOMER')).toBe(false);
  });

  it('read capability is a superset of its write sibling', () => {
    for (const w of CAPABILITIES.inventoryWrite) {
      expect(CAPABILITIES.inventoryRead).toContain(w);
    }
    for (const w of CAPABILITIES.resellerAdmin) {
      expect(CAPABILITIES.resellerView).toContain(w);
    }
    for (const w of CAPABILITIES.depotCrmWrite) {
      expect(CAPABILITIES.depotCrm).toContain(w);
    }
  });

  it('lets HR read the customer & reseller directories but not write them', () => {
    expect(can('depotCrm', 'HR')).toBe(true);
    expect(can('resellerView', 'HR')).toBe(true);
    expect(can('resellerAdmin', 'HR')).toBe(false);
    expect(can('depotCrmWrite', 'HR')).toBe(false);
    // HR must never gain the staff directory: inviteStaff takes an arbitrary role.
    expect(can('staffAdmin', 'HR')).toBe(false);
  });

  it('lets every role that can open the HQ catalogue also save it', () => {
    // The HQ console admits HEAD_OFFICE, DIREKTUR and SUPER_ADMIN; MANAGER is kept out of
    // it on purpose. Before HEAD_OFFICE was added, the only role that could both open
    // /hq/catalog and write the catalogue was SUPER_ADMIN, so the form 403'd for the very
    // role it was built for. Pinned so a future trim cannot silently reopen that gap.
    expect(can('catalogWrite', 'HEAD_OFFICE')).toBe(true);
    expect(can('catalogWrite', 'MANAGER')).toBe(true);
    // Oversight roles read the catalogue, they do not write it.
    expect(can('catalogWrite', 'DIREKTUR')).toBe(false);
    expect(can('catalogWrite', 'KEPALA_DEPOT')).toBe(false);
    expect(can('catalogWrite', 'CUSTOMER')).toBe(false);
  });

  it('never lets a bulk employee import provision an office/superuser account', () => {
    expect(STAFF_IMPORT_ROLES).not.toContain('HEAD_OFFICE');
    expect(STAFF_IMPORT_ROLES).not.toContain('SUPER_ADMIN');
    expect(STAFF_IMPORT_ROLES).not.toContain('CUSTOMER');
    expect(STAFF_IMPORT_ROLES).toContain('KEPALA_DEPOT');
  });

  /*
   * Measured, not assumed. A browser pass signed in as a REAL head-office account — the
   * first time one existed — found 28 of the 63 HQ routes answering 403, and the single
   * biggest cause was the depot LIST being gated by the depot WRITE capability. The console
   * admits HEAD_OFFICE and DIREKTUR, neither holds `depotAdmin`, and sixteen pages read
   * that list: a network console that could not enumerate its own network.
   *
   * The rule pinned here is narrow and checkable: reading the directory is
   * `depotDirectory`, changing it is `depotAdmin`, and the read is at least as wide as the
   * write.
   */
  it('lets every role that can open the HQ console read the depot directory', () => {
    for (const role of ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN']) {
      expect(can('depotDirectory', role)).toBe(true);
    }
    // ...while changing a depot stays with the roles that run one.
    expect(can('depotAdmin', 'HEAD_OFFICE')).toBe(false);
    expect(can('depotAdmin', 'DIREKTUR')).toBe(false);
    for (const w of CAPABILITIES.depotAdmin) {
      expect(CAPABILITIES.depotDirectory).toContain(w);
    }
  });

  /*
   * Same shape one service over: head office WATCHES the franchise payout queue, finance
   * RELEASES money out of it. `hqPayoutRead` exists for exactly that split, and the
   * per-owner route already carried it — while the network-wide list beside it inherited
   * the release capability and refused head office the same figures.
   */
  it('lets head office read the payout queue without being able to release it', () => {
    expect(can('hqPayoutRead', 'HEAD_OFFICE')).toBe(true);
    expect(can('hqPayoutRead', 'DIREKTUR')).toBe(true);
    expect(can('hqPayout', 'HEAD_OFFICE')).toBe(false);
    for (const w of CAPABILITIES.hqPayout) {
      expect(CAPABILITIES.hqPayoutRead).toContain(w);
    }
  });

  /*
   * The same read/write split, applied to the last three money surfaces the HQ console
   * showed to nobody: FINANCE holds these and FINANCE cannot open /hq at all, so the
   * refund queue, the settlement aggregates and the agreed commission percentages were
   * readable by SUPER_ADMIN alone. Reading is now open to the roles that run the network;
   * approving a refund, applying a scheme and settling a payment are untouched.
   */
  it.each([
    ['refundQueueRead', 'refundQueue'],
    ['commissionRead', 'commissionRuns'],
  ] as const)('%s is a superset of its write sibling %s', (read, write) => {
    expect(can(read, 'HEAD_OFFICE')).toBe(true);
    expect(can(read, 'DIREKTUR')).toBe(true);
    expect(can(write, 'HEAD_OFFICE')).toBe(false);
    for (const w of CAPABILITIES[write]) {
      expect(CAPABILITIES[read]).toContain(w);
    }
  });

  it('lets the network read settlement aggregates without settling anything', () => {
    expect(can('settlementRead', 'HEAD_OFFICE')).toBe(true);
    expect(can('settlementRead', 'DIREKTUR')).toBe(true);
    // Settling an individual payment is a depot/finance action and stays that way.
    expect(can('paymentSettle', 'HEAD_OFFICE')).toBe(false);
    expect(can('paymentSettle', 'DIREKTUR')).toBe(false);
  });
});
