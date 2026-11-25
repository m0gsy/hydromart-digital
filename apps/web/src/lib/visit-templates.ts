// HD-15B — what depot-service answers on /visit-templates (mirrors VisitTemplateResponseDto).

export interface VisitTemplateItem {
  id: string;
  position: number;
  text: string;
  /** hr-service Sop.id, or null. */
  sopId: string | null;
}

export interface VisitTemplate {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  items: VisitTemplateItem[];
}

/** What the form sends: the order of `items` is the checklist order. */
export interface VisitTemplateBody {
  name: string;
  items: { text: string; sopId?: string }[];
}

export const MAX_TEMPLATE_ITEMS = 60;
