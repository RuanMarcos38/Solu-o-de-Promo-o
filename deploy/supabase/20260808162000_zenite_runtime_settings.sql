SET search_path TO "zenite_ofertas", pg_catalog;

CREATE TABLE "PlatformSetting" (
  "id" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformSettingAudit" (
  "id" TEXT NOT NULL,
  "settingId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "previousValue" JSONB,
  "value" JSONB NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSettingAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformSettingAudit_settingId_version_key"
  ON "PlatformSettingAudit"("settingId", "version");
CREATE INDEX "PlatformSettingAudit_settingId_createdAt_idx"
  ON "PlatformSettingAudit"("settingId", "createdAt");

ALTER TABLE "PlatformSettingAudit"
  ADD CONSTRAINT "PlatformSettingAudit_settingId_fkey"
  FOREIGN KEY ("settingId") REFERENCES "PlatformSetting"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformSettingAudit" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "PlatformSetting", "PlatformSettingAudit"
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "PlatformSetting", "PlatformSettingAudit"
  TO "zenite_ofertas_backend";

CREATE POLICY "zenite_backend_all" ON "PlatformSetting"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);
CREATE POLICY "zenite_backend_all" ON "PlatformSettingAudit"
  FOR ALL TO "zenite_ofertas_backend" USING (true) WITH CHECK (true);

RESET search_path;
