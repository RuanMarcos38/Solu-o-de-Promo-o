#!/usr/bin/env node
import { Marketplace, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const offers = [
  {
    externalId: 'QA-ML-AFF-001',
    marketplace: Marketplace.MERCADO_LIVRE,
    title: 'QA Oferta Mercado Livre afiliada',
    normalizedTitle: 'qa oferta mercado livre afiliada',
    category: 'QA',
    currentPrice: 59.9,
    originalPrice: 199.9,
    discountPercent: 70,
    productUrl: 'https://www.mercadolivre.com.br/qa-oferta-afiliada',
    affiliateUrl: 'https://www.mercadolivre.com.br/qa-oferta-afiliada?tracking=qa',
    affiliateEligible: true,
    affiliateProvider: 'qa-verified-link',
    affiliateVerifiedAt: new Date(),
    sellerName: 'QA Seller',
    rating: 4.8,
    freeShipping: true,
    score: 96,
    isActive: true
  },
  {
    externalId: 'QA-ML-PENDING-002',
    marketplace: Marketplace.MERCADO_LIVRE,
    title: 'QA Oferta Mercado Livre pendente',
    normalizedTitle: 'qa oferta mercado livre pendente',
    category: 'QA',
    currentPrice: 79.9,
    originalPrice: 299.9,
    discountPercent: 73,
    productUrl: 'https://www.mercadolivre.com.br/qa-oferta-pendente',
    affiliateEligible: false,
    sellerName: 'QA Seller',
    rating: 4.7,
    freeShipping: true,
    score: 92,
    isActive: true
  },
  {
    externalId: 'QA-SHOPEE-PENDING-003',
    marketplace: Marketplace.SHOPEE,
    title: 'QA Oferta Shopee pendente',
    normalizedTitle: 'qa oferta shopee pendente',
    category: 'QA',
    currentPrice: 39.9,
    originalPrice: 159.9,
    discountPercent: 75,
    productUrl: 'https://shopee.com.br/product/123456/987654',
    affiliateEligible: false,
    sellerName: 'QA Shopee Seller',
    rating: 4.9,
    freeShipping: true,
    score: 94,
    isActive: true
  }
];

try {
  await prisma.dispatchLog.deleteMany({ where: { offer: { externalId: { startsWith: 'QA-' } } } });
  await prisma.priceHistory.deleteMany({ where: { offer: { externalId: { startsWith: 'QA-' } } } });
  await prisma.offer.deleteMany({ where: { externalId: { startsWith: 'QA-' } } });

  for (const offer of offers) {
    await prisma.offer.create({ data: offer });
  }

  console.log(`QA seed pronto: ${offers.length} ofertas isoladas.`);
} finally {
  await prisma.$disconnect();
}
