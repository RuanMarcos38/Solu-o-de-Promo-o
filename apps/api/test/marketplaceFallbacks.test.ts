import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseMercadoLivreSearchPage } from '../src/adapters/mercadoLivre.js';
import { normalizeShopeePublicItem } from '../src/adapters/shopee.js';

describe('fallbacks publicos de marketplaces', () => {
  test('extrai produto, preco e desconto da pagina de busca do Mercado Livre', () => {
    const offers = parseMercadoLivreSearchPage(`
      <ol>
        <li class="ui-search-layout__item">
          <div class="poly-card">
            <a class="poly-component__title" href="https://www.mercadolivre.com.br/fone-bluetooth/p/MLB1234567890">Fone Bluetooth Premium</a>
            <span class="andes-money-amount andes-money-amount--previous">
              <span class="andes-money-amount__fraction">399</span>
              <span class="andes-money-amount__cents">90</span>
            </span>
            <span class="andes-money-amount">
              <span class="andes-money-amount__fraction">199</span>
              <span class="andes-money-amount__cents">90</span>
            </span>
            <span>50% OFF</span>
            <span>Frete grátis</span>
            <img src="https://http2.mlstatic.com/D_NQ_NP_TESTE.webp" />
          </div>
        </li>
      </ol>
    `);

    assert.equal(offers.length, 1);
    assert.equal(offers[0].externalId, 'MLB1234567890');
    assert.equal(offers[0].title, 'Fone Bluetooth Premium');
    assert.equal(offers[0].currentPrice, 199.9);
    assert.equal(offers[0].originalPrice, 399.9);
    assert.equal(offers[0].discountPercent, 50);
    assert.equal(offers[0].freeShipping, true);
  });

  test('normaliza resposta publica da busca Shopee sem inventar link de afiliado', () => {
    const offer = normalizeShopeePublicItem({
      item_basic: {
        itemid: 987654321,
        shopid: 123456,
        name: 'Air Fryer 5 Litros',
        price: 8990000,
        price_before_discount: 12990000,
        image: 'abcdef0123456789abcdef0123456789',
        item_rating: { rating_star: 4.8 },
        free_shipping: true
      }
    });

    assert.ok(offer);
    assert.equal(offer.externalId, '987654321');
    assert.equal(offer.currentPrice, 89.9);
    assert.equal(offer.originalPrice, 129.9);
    assert.equal(offer.productUrl, 'https://shopee.com.br/product/123456/987654321');
    assert.equal(offer.affiliateEligible, false);
    assert.equal(offer.rating, 4.8);
  });
});
