import { assertNoPersonalData } from './masking';
import { ResolvedPeriod } from './period';

/**
 * HD-6: ok = a real number (0 included); belum_ada = nothing can be said (null, never 0);
 * ditahan = held back on purpose (masking, or a decision still open).
 */
export const ANSWER_STATUSES = ['ok', 'belum_ada', 'ditahan'] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export interface AnswerScope {
  depotIds: string[];
  legalEntityIds: string[];
}

export interface AnswerEnvelope<V = unknown> {
  metricId: string;
  period: ResolvedPeriod;
  scope: AnswerScope;
  value: V | null;
  status: AnswerStatus;
  unit: string;
  /** When the answer was read, UTC. */
  asOf: string;
  /** Why it is not `ok`, in words the AI web may quote. */
  reason?: string;
}

interface Base {
  metricId: string;
  period: ResolvedPeriod;
  scope: AnswerScope;
  unit: string;
  asOf: Date;
}

const build = <V>(b: Base, status: AnswerStatus, value: V | null, reason?: string): AnswerEnvelope<V> => {
  const envelope: AnswerEnvelope<V> = {
    metricId: b.metricId,
    period: b.period,
    scope: b.scope,
    value,
    status,
    unit: b.unit,
    asOf: b.asOf.toISOString(),
    ...(reason ? { reason } : {}),
  };
  assertNoPersonalData(envelope);
  return envelope;
};

/** A real value. Null is refused here: "no number" is `belumAda`, never an `ok` null or a 0. */
export function ok<V>(base: Base, value: V): AnswerEnvelope<V> {
  if (value === null || value === undefined) throw new Error(`${base.metricId}: ok needs a value`);
  return build(base, 'ok', value);
}

export const belumAda = (base: Base, reason: string): AnswerEnvelope<never> => build<never>(base, 'belum_ada', null, reason);

export const ditahan = (base: Base, reason: string): AnswerEnvelope<never> => build<never>(base, 'ditahan', null, reason);
