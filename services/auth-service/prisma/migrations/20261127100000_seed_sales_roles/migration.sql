-- Seed the two custom roles for the prospect ("calon mitra") CRM, as the console would make them
-- (owner decision, 27 Nov 2026): Sales = prospectRead + prospectCrm; Sales Lead adds
-- prospectSettings (it receives the weekly Sales report). Scope GLOBAL: the CRM is head-office level.
-- Keys are customRoleKeyFor(name). The owner assigns people in /hq/access afterwards.
--
-- Idempotent and never overwrites: a role row that already exists (hand-made, active or archived,
-- any capabilities) is left exactly as it is, and ONLY a role row inserted here gets grants.
-- capability_overrides.roles is a FULL replacement list, so a capability with no override row starts
-- from its compiled default (the `defaults` list below, kept equal to CAPABILITIES by a unit test).
-- The matrix is polled from auth-service by every service, so no version marker needs bumping.
WITH new_roles AS (
    INSERT INTO "custom_roles" ("key", "name", "description", "scope", "createdBy", "createdAt", "updatedAt")
    VALUES
        ('C_sales', 'Sales', 'Prospect CRM: aggregates, full prospect data and drafting a depot.', 'GLOBAL', NULL, now(), now()),
        ('C_sales_lead', 'Sales Lead', 'Sales plus the prospect settings; receives the weekly Sales report.', 'GLOBAL', NULL, now(), now())
    ON CONFLICT ("key") DO NOTHING
    RETURNING "key"
),
wanted ("capability", "role_key") AS (
    VALUES
        ('prospectRead', 'C_sales'),
        ('prospectCrm', 'C_sales'),
        ('prospectRead', 'C_sales_lead'),
        ('prospectCrm', 'C_sales_lead'),
        ('prospectSettings', 'C_sales_lead')
),
added AS (
    SELECT w."capability", array_agg(w."role_key" ORDER BY w."role_key") AS "keys"
    FROM wanted w JOIN new_roles n ON n."key" = w."role_key"
    GROUP BY w."capability"
),
defaults ("capability", "roles") AS (
    VALUES
        ('prospectRead', ARRAY['MARKETING', 'DIREKTUR', 'HEAD_OFFICE', 'SUPER_ADMIN']),
        ('prospectCrm', ARRAY['MARKETING', 'SUPER_ADMIN']),
        ('prospectSettings', ARRAY['SUPER_ADMIN'])
)
INSERT INTO "capability_overrides" ("capability", "roles", "updatedAt")
SELECT a."capability", d."roles" || a."keys", now()
FROM added a JOIN defaults d ON d."capability" = a."capability"
ON CONFLICT ("capability") DO UPDATE
SET "roles" = "capability_overrides"."roles"
        || ARRAY(SELECT k FROM unnest(EXCLUDED."roles") k
                 WHERE k LIKE 'C\_%' AND k <> ALL ("capability_overrides"."roles")),
    "updatedAt" = now();
