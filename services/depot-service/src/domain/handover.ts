// Shift handover checklist (design 14d). A signed record passing a depot from one shift to
// the next, carrying a checklist of items in mixed states. Mirrors the Prisma model;
// the domain never imports the generated client.

export enum HandoverItemState {
  DONE = 'DONE',
  PARTIAL = 'PARTIAL',
  PENDING = 'PENDING',
}

/** One checklist line handed over between shifts. */
export interface HandoverItem {
  title: string;
  subtext: string;
  state: HandoverItemState;
}

export interface ShiftHandover {
  id: string;
  depotId: string;
  fromShift: string;
  toShift: string;
  fromStaff: string;
  toStaff: string;
  items: HandoverItem[];
  note: string | null;
  /** Null until the handover is signed. */
  signedAt: Date | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
