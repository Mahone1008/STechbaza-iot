-- Run as the migration/DB owner after upgrading the schema. Passwords must be
-- passed using psql variables customer_password/staff_password (never checked in).
SELECT format('CREATE ROLE kerumo_customer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'customer_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='kerumo_customer') \gexec
SELECT format('CREATE ROLE kerumo_staff LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'staff_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='kerumo_staff') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kerumo_customer, kerumo_staff;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kerumo_customer, kerumo_staff;
REVOKE ALL ON alembic_version FROM kerumo_customer, kerumo_staff;
REVOKE UPDATE, DELETE ON platform_audit, factory_audit FROM kerumo_customer, kerumo_staff;
REVOKE SELECT ON platform_audit FROM kerumo_customer;
REVOKE INSERT ON factory_controllers FROM kerumo_customer;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_users ON users;
CREATE POLICY customer_users ON users TO kerumo_customer USING (platform_role='user') WITH CHECK (platform_role='user');
DROP POLICY IF EXISTS staff_users ON users;
CREATE POLICY staff_users ON users TO kerumo_staff USING (true) WITH CHECK (true);

ALTER TABLE account_security ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_security ON account_security;
CREATE POLICY customer_security ON account_security TO kerumo_customer USING (EXISTS (SELECT 1 FROM users WHERE id=user_id AND platform_role='user')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id=user_id AND platform_role='user'));
DROP POLICY IF EXISTS staff_security ON account_security;
CREATE POLICY staff_security ON account_security TO kerumo_staff USING (true) WITH CHECK (true);

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_sessions ON auth_sessions;
CREATE POLICY customer_sessions ON auth_sessions TO kerumo_customer USING (audience='techbaza-api' AND EXISTS (SELECT 1 FROM users WHERE id=user_id AND platform_role='user')) WITH CHECK (audience='techbaza-api' AND EXISTS (SELECT 1 FROM users WHERE id=user_id AND platform_role='user'));
DROP POLICY IF EXISTS staff_sessions ON auth_sessions;
CREATE POLICY staff_sessions ON auth_sessions TO kerumo_staff USING (true) WITH CHECK (true);

-- Workers may resolve a staff schedule author and customers may display their
-- service contact. This deliberately exposes identity metadata, never credentials.
CREATE OR REPLACE FUNCTION public.customer_actor_metadata(actor_id uuid)
RETURNS TABLE(id uuid, email varchar, display_name varchar, platform_role varchar, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT u.id, u.email, u.display_name, u.platform_role, u.is_active
  FROM public.users u WHERE u.id=actor_id;
$$;
REVOKE ALL ON FUNCTION public.customer_actor_metadata(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_actor_metadata(uuid) TO kerumo_customer, kerumo_staff;

CREATE OR REPLACE FUNCTION guard_customer_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='kerumo_customer' AND (
      (TG_TABLE_NAME='factory_audit' AND NEW.action='registered') OR
      (NEW.actor_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_user_id AND platform_role='user'))
  ) THEN RAISE EXCEPTION 'Private administrative audit requires staff database role'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_audit ON platform_audit;
CREATE TRIGGER guard_audit BEFORE INSERT ON platform_audit FOR EACH ROW EXECUTE FUNCTION guard_customer_audit();
DROP TRIGGER IF EXISTS guard_audit ON factory_audit;
CREATE TRIGGER guard_audit BEFORE INSERT ON factory_audit FOR EACH ROW EXECUTE FUNCTION guard_customer_audit();
