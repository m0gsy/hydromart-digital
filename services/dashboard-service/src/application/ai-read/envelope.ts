import { InternalServerErrorException, Logger } from '@nestjs/common';

import { PersonalDataError, assertNoPersonalData } from './masking';
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
  /** What the number is, where its name alone would mislead (e.g. a payroll that is base pay and allowances only). */
  label?: string;
}

interface Base {
  metricId: string;
  period: ResolvedPeriod;
  scope: AnswerScope;
  unit: string;
  asOf: Date;
  label?: string;
}

const logger = new Logger('AiReadEnvelope');

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
    ...(b.label ? { label: b.label } : {}),
  };
  try {
    assertNoPersonalData(envelope);
  } catch (error) {
    if (!(error instanceof PersonalDataError)) throw error;
    // The rule and the metric only: the offending key or value is never logged or sent.
    logger.error(`${b.metricId}: answer held back, it carried personal data (${error.rule})`);
    throw new InternalServerErrorException('Jawaban ini tidak bisa dikirim.');
  }
  return envelope;
};

/** A real value. Null is refused here: "no number" is `belumAda`, never an `ok` null or a 0. */
export function ok<V>(base: Base, value: V): AnswerEnvelope<V> {
  if (value === null || value === undefined) throw new Error(`${base.metricId}: ok needs a value`);
  return build(base, 'ok', value);
}

export const belumAda = (base: Base, reason: string): AnswerEnvelope<never> => build<never>(base, 'belum_ada', null, reason);

export const ditahan = (base: Base, reason: string): AnswerEnvelope<never> => build<never>(base, 'ditahan', null, reason);
