// B2B prospects (customer-service, gateway segment `b2b-prospects`).
const BASE = '/b2b-prospects/api/v1/b2b-prospects';

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
    list: (q: ProspectQuery = {}) => `${BASE}${qs({ ...q })}`,
    mine: (q: Omit<ProspectQuery, 'scope' | 'depotId' | 'assigned'> = {}) => `${BASE}/mine${qs({ ...q })}`,
    coverage: (depotId?: string) => `${BASE}/coverage${qs({ depotId })}`,
    assignees: (depotId: string) => `${BASE}/assignees?depotId=${depotId}`,
    detail: (id: string) => `${BASE}/${id}`,
    status: (id: string) => `${BASE}/${id}/status`,
    assign: (id: string) => `${BASE}/${id}/assign`,
    ownerDepot: (id: string) => `${BASE}/${id}/owner-depot`,
    convert: (id: string) => `${BASE}/${id}/convert`,
    doNotContact: (id: string) => `${BASE}/${id}/do-not-contact`,
  },
} as const;
