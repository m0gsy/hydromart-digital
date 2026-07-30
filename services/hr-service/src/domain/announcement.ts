import { AnnouncementDimension } from '../../prisma/generated/client';

/** The only employee fields an audience rule can look at. */
export interface AudienceEmployee {
  id: string;
  depotId: string;
  departmentId: string | null;
  position: string;
}

export interface AudienceTarget {
  dimension: AnnouncementDimension;
  value: string | null;
}

/**
 * Does one rule cover this person? COMPANY covers everyone; the rest compare one field.
 * A rule whose value is missing covers nobody — an empty DEPOT target is a mistake, not
 * "all depots", and silently promoting it to everyone is how a payroll notice reaches the
 * whole network.
 */
export function targetCovers(target: AudienceTarget, employee: AudienceEmployee): boolean {
  switch (target.dimension) {
    case 'COMPANY':
      return true;
    case 'DEPOT':
      return !!target.value && employee.depotId === target.value;
    case 'DEPARTMENT':
      return !!target.value && employee.departmentId === target.value;
    case 'POSITION':
      // Jabatan is free text typed by HR, so compare case-insensitively and trimmed.
      return (
        !!target.value &&
        employee.position.trim().toLowerCase() === target.value.trim().toLowerCase()
      );
    case 'EMPLOYEE':
      return !!target.value && employee.id === target.value;
    default:
      return false;
  }
}

/** Any rule covering them is enough — the rules OR together. */
export function audienceMatches(
  targets: readonly AudienceTarget[],
  employee: AudienceEmployee,
): boolean {
  return targets.some((t) => targetCovers(t, employee));
}

/**
 * Targets -> the people they reach, each exactly once and in the candidate order given.
 *
 * The dedup is the reason this exists: "depot JKT-01" and "departemen Gudang" overlap by
 * design, and a person in both must get ONE notification, not two.
 */
export function resolveAudience<T extends AudienceEmployee>(
  targets: readonly AudienceTarget[],
  candidates: readonly T[],
): T[] {
  if (targets.length === 0) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const employee of candidates) {
    if (seen.has(employee.id)) continue;
    if (!audienceMatches(targets, employee)) continue;
    seen.add(employee.id);
    out.push(employee);
  }
  return out;
}

/** Announcements the sweep should release: scheduled, due, and not published yet. */
export function isDueForPublish(
  announcement: { scheduledAt: Date | null; publishedAt: Date | null },
  now: Date,
): boolean {
  if (announcement.publishedAt) return false;
  return !!announcement.scheduledAt && announcement.scheduledAt.getTime() <= now.getTime();
}
