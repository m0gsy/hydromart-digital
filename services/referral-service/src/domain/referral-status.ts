// Referral lifecycle (PRD Module 12 FR-092). A referral is PENDING once a code is
// redeemed and QUALIFIED once the referee's first order qualifies (rewards granted then).

export enum ReferralStatus {
  PENDING = 'PENDING',
  QUALIFIED = 'QUALIFIED',
}
