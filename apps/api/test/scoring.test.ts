import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { config } from '../src/config.js';
import { calculateDiscount, calculateScore, isApprovedOffer, normalizeTitle } from '../src/scoring.js';
import type { NormalizedOffer } from '../src/types.js';

function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    externalId: 'MLB-TEST-1',
    marketplace: 'mercadolivre',
    title: 'Notebook Gamer',
    normalizedTitle: 'notebook gamer',
    currentPrice: 2500,
    originalPrice: 4000,
    discountPercent: 60,
    imageUrl: 'https://example.com/image.jpg',
    productUrl: 'https://example.com/product',
    affiliateUrl: 'https://example.com/affiliate',
    affiliateEligible: true,
    affiliateProvider: 'test',
    affiliateVerifiedAt: new Date('2026-08-08T00:00:00Z'),
    sellerName: 'Loja Oficial',
    rating: 4.8,
    freeShipping: true,
    score: 100,
    ...overrides
  };
}

describe('scoring', () => {
  test('normaliza acentos, símbolos e espaços repetidos', () => {
    assert.equal(normalizeTitle('  Smart TV 55” 4K — Edição Única!  '), 'smart tv 55 4k edicao unica');
  });

  test('calcula desconto percentual com duas casas decimais', () => {
    assert.equal(calculateDiscount(749.9, 999.9), 25);
    assert.equal(calculateDiscount(100, 100), 0);
    assert.equal(calculateDiscount(120, 100), 0);
    assert.equal(calculateDiscount(100), 0);
  });

  test('limita o score a 100 e valoriza sinais de qualidade', () => {
    const strongScore = calculateScore(makeOffer());
    const weakScore = calculateScore(makeOffer({
      discountPercent: 20,
      imageUrl: undefined,
      sellerName: undefined,
      rating: undefined,
      freeShipping: false
    }));

    assert.equal(strongScore, 100);
    assert.ok(strongScore > weakScore);
  });

  test('aprova somente ofertas que atendem preço, URL, desconto e score mínimos', () => {
    assert.equal(isApprovedOffer(makeOffer({ score: config.minOpportunityScore })), true);
    assert.equal(isApprovedOffer(makeOffer({ currentPrice: 0 })), false);
    assert.equal(isApprovedOffer(makeOffer({ productUrl: '' })), false);
    assert.equal(isApprovedOffer(makeOffer({ affiliateUrl: undefined })), false);
    assert.equal(isApprovedOffer(makeOffer({ affiliateEligible: false })), false);
    assert.equal(isApprovedOffer(makeOffer({ discountPercent: config.minDiscountPercent - 0.01 })), false);
    assert.equal(isApprovedOffer(makeOffer({ score: config.minOpportunityScore - 1 })), false);
  });

  test('permite vitrine imediata sem link afiliado quando a regra pedir explicitamente', () => {
    assert.equal(isApprovedOffer(makeOffer({
      affiliateUrl: undefined,
      affiliateEligible: false,
      discountPercent: 50,
      score: 12
    }), {
      minDiscountPercent: 50,
      minOpportunityScore: 0,
      requireVerifiedAffiliateLinks: false
    }), true);
  });
});
