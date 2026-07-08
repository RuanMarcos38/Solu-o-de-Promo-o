CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceSource" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "marketplace" "Marketplace" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "keywords" TEXT[],
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "MarketplaceSource_marketplace_isActive_idx" ON "MarketplaceSource"("marketplace", "isActive");
CREATE INDEX "Offer_category_idx" ON "Offer"("category");
CREATE INDEX "Offer_score_idx" ON "Offer"("score");

ALTER TABLE "DispatchChannel" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
