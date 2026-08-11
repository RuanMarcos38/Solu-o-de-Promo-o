SET search_path TO "zenite_ofertas", pg_catalog;

CREATE INDEX "DispatchLog_offerId_idx" ON "DispatchLog"("offerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zenite_ofertas_backend') THEN
    CREATE ROLE "zenite_ofertas_backend"
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA "zenite_ofertas" TO "zenite_ofertas_backend";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "zenite_ofertas"
  TO "zenite_ofertas_backend";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "zenite_ofertas"
  TO "zenite_ofertas_backend";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "zenite_ofertas"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "zenite_ofertas_backend";
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "zenite_ofertas"
  GRANT USAGE, SELECT ON SEQUENCES TO "zenite_ofertas_backend";

CREATE POLICY "zenite_backend_all" ON "User"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);
CREATE POLICY "zenite_backend_all" ON "MarketplaceSource"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);
CREATE POLICY "zenite_backend_all" ON "Offer"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);
CREATE POLICY "zenite_backend_all" ON "PriceHistory"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);
CREATE POLICY "zenite_backend_all" ON "AlertRule"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);
CREATE POLICY "zenite_backend_all" ON "DispatchChannel"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);
CREATE POLICY "zenite_backend_all" ON "DispatchLog"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);

RESET search_path;
