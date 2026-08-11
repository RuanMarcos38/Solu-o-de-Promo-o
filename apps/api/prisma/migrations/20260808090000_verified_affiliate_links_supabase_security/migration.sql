ALTER TABLE "Offer"
  ADD COLUMN "affiliateEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "affiliateProvider" TEXT,
  ADD COLUMN "affiliateVerifiedAt" TIMESTAMP(3);

CREATE INDEX "Offer_affiliateEligible_isActive_score_idx"
  ON "Offer"("affiliateEligible", "isActive", "score");

CREATE INDEX "DispatchLog_offerId_idx" ON "DispatchLog"("offerId");

-- Existing affiliateUrl values were not issued or verified by an authorized
-- affiliate provider. Keep them for auditability, but never mark them eligible.
UPDATE "Offer"
SET "affiliateEligible" = false,
    "affiliateProvider" = NULL,
    "affiliateVerifiedAt" = NULL;

-- Supabase exposes the public schema through its Data API depending on project
-- settings. The application accesses these tables only through its backend
-- Prisma role, so anonymous/authenticated Data API access is explicitly denied.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Offer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AlertRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DispatchChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DispatchLog" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE "User", "MarketplaceSource", "Offer", "PriceHistory", "AlertRule", "DispatchChannel", "DispatchLog" FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END $$;
