-- HD-9: the AI web's two database roles, exactly as hydromart-ai's README ("What HD-9 has to
-- give the database") and its CI job `image` set them up:
--
--   ai_owner  owns database ai; the migration job runs as it.
--   ai_app    the app's role: row privileges through the owner's default privileges, owns
--             nothing, so it can neither get past row level security nor switch it off.
--
-- Neither is a superuser or BYPASSRLS. scripts/aiweb-deploy.sh pipes this file to psql as the
-- superuser over the db container's local socket on EVERY deploy, so it is idempotent and puts
-- back a role, an attribute or a password that drifted. The passwords come from the container's
-- environment (\getenv), never from this file or a command line.

-- A failing statement may carry a password; keep its text out of the server log.
SET log_min_error_statement = panic;

\getenv owner_password AIWEB_DB_OWNER_PASSWORD
\getenv app_password AIWEB_DB_APP_PASSWORD
\getenv superuser_password POSTGRES_PASSWORD

-- The image reads POSTGRES_PASSWORD only when it first creates the cluster; kept in step here
-- so a changed AIWEB_POSTGRES_PASSWORD in .env is the password, not a stale note.
ALTER ROLE postgres PASSWORD :'superuser_password';

SELECT 'CREATE ROLE ai_owner' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_owner') \gexec
SELECT 'CREATE ROLE ai_app' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_app') \gexec
ALTER ROLE ai_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'owner_password';
ALTER ROLE ai_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

SELECT 'CREATE DATABASE ai OWNER ai_owner' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai') \gexec
ALTER DATABASE ai OWNER TO ai_owner;

\connect ai
-- Every table the owner's migrations create is open to the app for rows, and for nothing else.
ALTER DEFAULT PRIVILEGES FOR ROLE ai_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ai_app;
