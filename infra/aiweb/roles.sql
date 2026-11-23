-- HD-9: what the migration job needs from the AI web's database, as hydromart-ai's README ("What
-- HD-9 has to give the database") and its CI job `image` set it up:
--
--   ai_owner  owns database ai; the migration job runs as it.
--   ai_app    the app's role: row privileges through the owner's default privileges, owns
--             nothing, so it can neither get past row level security nor switch it off.
--   n8n       AI-5: owns database n8n, where n8n keeps its workflows and its encrypted
--             credentials and runs its own migrations (hydromart-ai's CI job `image` does the same).
--
-- None is a superuser or BYPASSRLS. scripts/aiweb-deploy.sh pipes this file to psql as the
-- superuser over the db container's local socket on EVERY deploy, before the migration, so it
-- is idempotent and puts back an owner attribute or password that drifted.
--
-- ai_app is only CREATED here, never given its password: infra/aiweb/app-role.sql does that
-- after a successful migration, right before the app is swapped. A release that fails before
-- then leaves the database holding the password the running app was started with.
--
-- The passwords come from the container's environment (\getenv), never from this file or a
-- command line.

-- A failing statement may carry a password; keep its text out of the server log.
SET log_min_error_statement = panic;

\getenv owner_password AIWEB_DB_OWNER_PASSWORD
\getenv n8n_password AIWEB_N8N_DB_PASSWORD
\getenv superuser_password POSTGRES_PASSWORD

-- The image reads POSTGRES_PASSWORD only when it first creates the cluster; kept in step here
-- so a changed AIWEB_POSTGRES_PASSWORD in .env is the password, not a stale note.
ALTER ROLE postgres PASSWORD :'superuser_password';

SELECT 'CREATE ROLE ai_owner' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_owner') \gexec
ALTER ROLE ai_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'owner_password';
-- NOLOGIN until app-role.sql gives it its password.
SELECT 'CREATE ROLE ai_app NOLOGIN NOSUPERUSER NOBYPASSRLS' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_app') \gexec
SELECT 'CREATE ROLE n8n' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n') \gexec
ALTER ROLE n8n LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'n8n_password';

SELECT 'CREATE DATABASE ai OWNER ai_owner' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai') \gexec
ALTER DATABASE ai OWNER TO ai_owner;
SELECT 'CREATE DATABASE n8n OWNER n8n' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n') \gexec
ALTER DATABASE n8n OWNER TO n8n;

-- Each role connects to its own database only. By default every role may connect to every
-- database (PUBLIC holds CONNECT and TEMPORARY), so n8n could open ai and read its catalog, and
-- the app could open n8n's. Granted to ai_app before PUBLIC loses it, so the running app never
-- sees a moment without it; the owners keep theirs as owners.
GRANT CONNECT, TEMPORARY ON DATABASE ai TO ai_app;
REVOKE ALL ON DATABASE ai FROM PUBLIC;
REVOKE ALL ON DATABASE n8n FROM PUBLIC;

\connect ai
-- Every table the owner's migrations create is open to the app for rows, and for nothing else.
ALTER DEFAULT PRIVILEGES FOR ROLE ai_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ai_app;
