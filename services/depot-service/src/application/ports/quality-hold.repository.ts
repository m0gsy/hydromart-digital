import {
  LabTest,
  LabTestKind,
  LabTestResult,
  Permit,
  QualityHold,
  QualityHoldReason,
} from '../../domain/quality-hold';

export interface StartHoldData {
  depotId: string;
  reasonCode: QualityHoldReason;
  note: string | null;
  startedBy: string;
  at: Date;
}

export interface EndHoldData {
  depotId: string;
  endedBy: string;
  endRetestId: string;
  at: Date;
}

export interface NewLabTest {
  depotId: string;
  kind: LabTestKind;
  takenOn: string;
  resultOn: string;
  result: LabTestResult;
  labName: string;
  reportNo: string;
  recordedBy: string;
}

export interface NewPermit {
  depotId: string;
  kind: string;
  number: string;
  validUntil: string;
  recordedBy: string;
}

/** What the due sweep needs: every ACTIVE depot with its tests' days and its permits. */
export interface ComplianceSource {
  depots: Array<{ id: string; name: string; createdAt: Date }>;
  tests: Array<{ depotId: string; kind: LabTestKind; takenOn: string }>;
  permits: Permit[];
}

export interface QualityHoldRepository {
  /**
   * Opens a hold and writes its `depot.quality_hold_changed` row in ONE transaction. Null when
   * the depot already has an ACTIVE hold (the partial unique index, not a pre-read, decides).
   */
  start(data: StartHoldData): Promise<QualityHold | null>;
  /**
   * Closes the depot's ACTIVE hold and writes the ENDED event in one transaction. Null when there
   * is none (someone ended it first).
   */
  end(data: EndHoldData): Promise<QualityHold | null>;
  findActive(depotId: string): Promise<QualityHold | null>;
  /** Newest first. */
  history(depotId: string): Promise<QualityHold[]>;
  addLabTest(data: NewLabTest): Promise<LabTest>;
  findLabTest(id: string): Promise<LabTest | null>;
  /** Newest test day first. */
  listLabTests(depotId: string): Promise<LabTest[]>;
  addPermit(data: NewPermit): Promise<Permit>;
  /** Latest validity first. */
  listPermits(depotId: string): Promise<Permit[]>;
  complianceSource(): Promise<ComplianceSource>;
}
