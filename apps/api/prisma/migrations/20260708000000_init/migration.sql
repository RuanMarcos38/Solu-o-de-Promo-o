CREATE TYPE "Marketplace" AS ENUM ('MERCADO_LIVRE', 'AMAZON', 'SHOPEE', 'MAGALU', 'ALIEXPRESS', 'OTHER');
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "Offer" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "marketplace" "Marketplace" NOT NULL,
  "title" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL,
  "category" TEXT,
  "currentPrice" DECIMAL(12,2) NOT NULL,
  "originalPrice" DECIMAL(12,2),
  "discountPercent" DECIMAL(5,2),
  "imageUrl" TEXT,
  "productUrl" TEXT NOT NULL,
  "affiliateUrl" TEXT,
  "sellerName" TEXT,
  "rating" DECIMAL(3,2),
  "freeShipping" BOOLEAN NOT NULL DEFAULT false,
  "score" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceHistory" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keywords" TEXT[],
  "marketplaces" TEXT[],
  "minDiscountPercent" INTEGER NOT NULL DEFAULT 10,
  "maxPrice" DECIMAL(12,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DispatchChannel" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DispatchLog" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Offer_marketplace_externalId_key" ON "Offer"("marketplace", "externalId");
CREATE INDEX "Offer_marketplace_score_idx" ON "Offer"("marketplace", "score");
CREATE INDEX "Offer_normalizedTitle_idx" ON "Offer"("normalizedTitle");
CREATE INDEX "PriceHistory_offerId_capturedAt_idx" ON "PriceHistory"("offerId", "capturedAt");

ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DispatchLog" ADD CONSTRAINT "DispatchLog_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
