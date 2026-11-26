// HD-15B: the checklist head office writes for supervisor visits. Mirrors the Prisma models; the
// domain never imports the generated client.

export interface VisitTemplateItem {
  id: string;
  position: number;
  text: string;
  /** hr-service Sop.id, or null. A bare id: depot-service never owns the SOP. */
  sopId: string | null;
}

export interface VisitTemplate {
  id: string;
  name: string;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: VisitTemplateItem[];
}

/** What a caller writes: the order of `items` is the checklist order. */
export interface VisitTemplateItemInput {
  text: string;
  sopId?: string | null;
}

/** The SOP version in force for a depot today, as hr-service reports it. */
export interface SopInForce {
  sopId: string;
  versionId: string;
  versionNo: number;
  title: string;
  /** A WIB day, YYYY-MM-DD. */
  effectiveFrom: string;
}

/** A template item as a conductor sees it: with the SOP in force when a depot was asked about. */
export interface VisitTemplateItemView extends VisitTemplateItem {
  sopInForce: SopInForce | null;
}
