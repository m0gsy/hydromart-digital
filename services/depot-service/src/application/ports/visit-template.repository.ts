import { VisitTemplate, VisitTemplateItemInput } from '../../domain/visit-template';

export interface VisitTemplateWrite {
  name: string;
  items: VisitTemplateItemInput[];
}

export interface VisitTemplateRepository {
  /** Newest first. `activeOnly` hides retired templates (what a conductor sees). */
  list(activeOnly: boolean): Promise<VisitTemplate[]>;
  findById(id: string): Promise<VisitTemplate | null>;
  create(data: VisitTemplateWrite & { createdBy: string }): Promise<VisitTemplate>;
  /**
   * Replace name, active flag and the WHOLE item set in one transaction, or null when the
   * template does not exist. Item ids are new on every replace: a visit copies text, never ids.
   * The write only lands when the stored `updatedAt` still equals `seenUpdatedAt`, checked INSIDE
   * the transaction; otherwise it throws StaleWriteError.
   */
  replace(
    id: string,
    data: VisitTemplateWrite & { active: boolean },
    seenUpdatedAt: string,
  ): Promise<VisitTemplate | null>;
}
