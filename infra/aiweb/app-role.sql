-- HD-9: ai_app, the AI web app's own role, given its attributes and the password .env holds
-- (AIWEB_DB_APP_PASSWORD). scripts/aiweb-deploy.sh pipes this file to psql as the superuser over
-- the db container's local socket only after the migration succeeded, right before it swaps the
-- app. Until a release gets that far, the database keeps the password the running app was
-- started with: a failed migration, or anything else before the swap, never locks it out, even
-- after the database container was recreated with a new password in its environment.
--
-- Row privileges only (roles.sql's default privileges), never a superuser, BYPASSRLS or owner:
-- /api/health answers 503 for any of those. The password comes from the container's environment
-- (\getenv), never from this file or a command line.

-- A failing statement carries the password; keep its text out of the server log.
SET log_min_error_statement = panic;

\getenv app_password AIWEB_DB_APP_PASSWORD

ALTER ROLE ai_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
