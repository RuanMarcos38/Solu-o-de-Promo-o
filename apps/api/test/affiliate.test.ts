import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isMarketplaceAffiliateUrl } from '../src/affiliate.js';

describe('validação de links afiliados', () => {
  test('aceita somente HTTPS e hosts pertencentes ao marketplace', () => {
    assert.equal(isMarketplaceAffiliateUrl('amazon', 'https://www.amazon.com.br/dp/ABC?tag=teste-20'), true);
    assert.equal(isMarketplaceAffiliateUrl('shopee', 'https://s.shopee.com.br/abc123'), true);
    assert.equal(isMarketplaceAffiliateUrl('mercadolivre', 'https://mercado.li/abc123'), true);
    assert.equal(isMarketplaceAffiliateUrl('amazon', 'http://www.amazon.com.br/dp/ABC?tag=teste-20'), false);
    assert.equal(isMarketplaceAffiliateUrl('amazon', 'https://amazon.com.br.evil.example/dp/ABC'), false);
    assert.equal(isMarketplaceAffiliateUrl('shopee', 'https://example.com/produto'), false);
  });
});
