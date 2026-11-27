// B2B prospects (customer-service, gateway segment `b2b-prospects`). Full path literals on purpose:
// scripts/check-endpoint-contracts.mjs and check-route-parity.mjs read them to prove every
// builder has a controller route and every route has a caller.

function qs(q: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface ProspectQuery {
  scope?: 'work' | 'map';
  depotId?: string;
  status?: string;
  category?: string;
  kecamatanCode?: string;
  assigned?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export const prospect = {
  prospects: {
    list: (q: ProspectQuery = {}) => `/b2b-prospects/api/v1/b2b-prospects${qs({ ...q })}`,
    mine: (q: Omit<ProspectQuery, 'scope' | 'depotId' | 'assigned'> = {}) =>
      `/b2b-prospects/api/v1/b2b-prospects/mine${qs({ ...q })}`,
    coverage: (depotId?: string) => `/b2b-prospects/api/v1/b2b-prospects/coverage${qs({ depotId })}`,
    create: '/b2b-prospects/api/v1/b2b-prospects',
    suppress: '/b2b-prospects/api/v1/b2b-prospects/do-not-contact',
    import: '/b2b-prospects/api/v1/b2b-prospects/import',
    export: '/b2b-prospects/api/v1/b2b-prospects/export',
    recomputeOwners: '/b2b-prospects/api/v1/b2b-prospects/recompute-owners',
    assignees: (depotId: string) => `/b2b-prospects/api/v1/b2b-prospects/assignees?depotId=${depotId}`,
    detail: (id: string) => `/b2b-prospects/api/v1/b2b-prospects/${id}`,
    status: (id: string) => `/b2b-prospects/api/v1/b2b-prospects/${id}/status`,
    assign: (id: string) => `/b2b-prospects/api/v1/b2b-prospects/${id}/assign`,
    ownerDepot: (id: string) => `/b2b-prospects/api/v1/b2b-prospects/${id}/owner-depot`,
    convert: (id: string) => `/b2b-prospects/api/v1/b2b-prospects/${id}/convert`,
    visit: (id: string) => `/b2b-prospects/api/v1/b2b-prospects/${id}/visits`,
    doNotContact: (id: string) => `/b2b-prospects/api/v1/b2b-prospects/${id}/do-not-contact`,
  },
} as const;
