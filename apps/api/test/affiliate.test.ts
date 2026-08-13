import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createInternalAffiliateLink, isMarketplaceAffiliateUrl, resolveAffiliateLink } from '../src/affiliate.js';

describe('validação de links afiliados', () => {
  test('aceita somente HTTPS e hosts pertencentes ao marketplace', () => {
    assert.equal(isMarketplaceAffiliateUrl('amazon', 'https://www.amazon.com.br/dp/ABC?tag=teste-20'), true);
    assert.equal(isMarketplaceAffiliateUrl('shopee', 'https://s.shopee.com.br/abc123'), true);
    assert.equal(isMarketplaceAffiliateUrl('mercadolivre', 'https://mercado.li/abc123'), true);
    assert.equal(isMarketplaceAffiliateUrl('amazon', 'http://www.amazon.com.br/dp/ABC?tag=teste-20'), false);
    assert.equal(isMarketplaceAffiliateUrl('amazon', 'https://amazon.com.br.evil.example/dp/ABC'), false);
    assert.equal(isMarketplaceAffiliateUrl('shopee', 'https://example.com/produto'), false);
  });

  test('gera link rastreavel da Amazon com Partner Tag configurado', async () => {
    const result = await resolveAffiliateLink({
      marketplace: 'amazon',
      externalId: 'B000TEST',
      productUrl: 'https://www.amazon.com.br/dp/B000TEST?psc=1'
    });

    assert.equal(result.affiliateEligible, true);
    assert.equal(result.affiliateProvider, 'amazon-partner-tag');
    assert.equal(result.affiliateUrl, 'https://www.amazon.com.br/dp/B000TEST?psc=1&tag=r2r-20');
    assert.ok(result.affiliateVerifiedAt);
  });

  test('gera link interno rastreavel da plataforma', () => {
    assert.equal(
      createInternalAffiliateLink('https://api-ofertas.r2rmarketingdigital.com.br/base?x=1', 'offer-1'),
      'https://api-ofertas.r2rmarketingdigital.com.br/r/offer-1'
    );
    assert.equal(createInternalAffiliateLink('ftp://api-ofertas.r2rmarketingdigital.com.br', 'offer-1'), undefined);
    assert.equal(createInternalAffiliateLink('url-invalida', 'offer-1'), undefined);
  });
});
