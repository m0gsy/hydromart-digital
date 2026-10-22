// Strings for the HQ design-fidelity batch (matrix bulk-toggles + rail grouping).
// Kept out of hq.ts so parallel agents don't collide on one fragment.
export const hqFix = {
  // DEFECT-01 — see the Indonesian side.
  customers: {
    historyUnavailable: 'Order history could not be read right now — this is NOT a zero.',
    loyaltyUnavailable: 'Loyalty data could not be read right now — not "no account".',
    retry: 'Try again',
  },
  // CA-2-28 / CA-2-25 — see the Indonesian side.
  audit: {
    tooLarge:
      'The audit trail is too large to export in full. Narrow the range or the filter first — a partial file is worse than none.',
  },
  reportsExport: {
    depotsIncomplete:
      'The per-depot revenue report is incomplete: some depots fell outside its source report, so the figures would be wrong. The export is held back until the source is whole.',
  },
  recon: {
    schemeUnreadable: "Commission (scheme unreadable)",
    schemeMissing: "Commission (no scheme yet)",
    // CA-2-08 / CA-2-09 — see the Indonesian side. Neither row is an addend.
    shippingIncluded: 'Shipping billed (already inside total sales)',
    commissionBase: 'Commission base (goods before discount)',
  },
  roles: {
    title: 'Custom roles',
    intro:
      'Create roles beyond the 13 built-in ones, then set their capabilities in the matrix. A custom role does not open the courier app, the operator/manager consoles, attendance or payroll rules - those are tied to built-in roles.',
    name: 'Role name',
    description: 'Description',
    scope: 'Scope',
    scopeLOCKED: 'One depot',
    scopeRESOLVED: 'Directly assigned depots',
    scopeGLOBAL: 'Whole network',
    scopeHint:
      'One depot: locked to the depot of the account. Assigned depots: only depots given through the hierarchy. Whole network: sees every depot.',
    create: 'Create role',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    archive: 'Archive',
    archived: 'archived',
    archiveConfirm: 'Archive this role? Every capability is revoked. Not possible while an account still holds it.',
    empty: 'No custom roles yet.',
    saved: 'Role saved.',
    builtIn: {
      title: 'Built-in roles',
      intro:
        'Change the name, description and depot reach of a built-in role, or switch off one that is unused. Each role capabilities are set in the matrix below.',
      disabled: 'off',
      disable: 'Switch off',
      enable: 'Switch on',
      copy: 'Copy into a new role',
      reset: 'Back to built-in',
      scopeKept: 'Fixed scope',
      confirmDisable: 'Switch this role off? Every capability is revoked and it cannot be given to an account. Not possible while an account still holds it.',
      copyFrom: 'Copy from',
      copyNone: 'Start empty',
      widen: 'Wider scope: accounts with this role will see more depots.',
    },
    forbidden: 'A custom role may not hold this',
    loadFailed: 'The matrix could not be read from the server. This screen shows what the app was built with, not what is enforced - reload before changing anything.',
  },
  depotRules: {
    title: 'Per-depot capabilities',
    intro:
      'An exception to the global matrix for one role at one depot, only for depot-limited roles. It applies to requests that name that depot (a one-depot role: always its own depot). Deny wins over the global list; grant only applies at that depot.',
    capability: 'Capability',
    role: 'Role',
    depot: 'Depot',
    effect: 'Effect',
    grant: 'Grant',
    deny: 'Deny',
    add: 'Add exception',
    remove: 'Remove',
    empty: 'No per-depot exceptions yet.',
    pickDepot: 'Pick a depot',
    unknownDepot: 'unknown depot',
    depotsIncomplete: 'The depot list is incomplete, so depot names below may be blank. Depot ids are shown as they are.',
  },
  toggleCol: 'Grant/clear every capability for this role',
  roleDetail: 'See every capability this role holds',
  roleDetailShort: 'detail',
  toggleRow: 'Grant/clear this capability for all roles',
  surfaces: 'menus',
};
