import type { PromoRule, PromoRuleKind } from './types';

/** What the promo-rule list filters by. Everything optional: the empty filter shows all. */
export interface RuleFilter {
  /** Matched against the rule's name, case-insensitively. */
  text: string;
  kind: PromoRuleKind | '';
  status: 'all' | 'active' | 'inactive';
}

export const EMPTY_RULE_FILTER: RuleFilter = { text: '', kind: '', status: 'all' };

export const isFiltering = (f: RuleFilter): boolean => f.text.trim() !== '' || f.kind !== '' || f.status !== 'all';

export function filterRules(rules: PromoRule[], f: RuleFilter): PromoRule[] {
  const text = f.text.trim().toLowerCase();
  return rules.filter(
    (r) =>
      (text === '' || r.name.toLowerCase().includes(text)) &&
      (f.kind === '' || r.kind === f.kind) &&
      (f.status === 'all' || (f.status === 'active') === r.active),
  );
}

/**
 * A copy of a rule to start a NEW one from: same settings, a name that says it is a copy, and
 * active again (an inactive original is a rule somebody switched off, not a template for one).
 * The id and timestamps are not carried, so saving it creates a rule rather than patching one.
 */
export function duplicateRule(rule: PromoRule, copySuffix: string): PromoRule {
  return { ...rule, name: `${rule.name} ${copySuffix}`.trim(), active: true };
}
