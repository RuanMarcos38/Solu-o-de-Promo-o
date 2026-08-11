import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { amazonTokenEndpoint, normalizeAmazonItem } from '../src/adapters/amazon.js';
import { normalizeMercadoLivreItem } from '../src/adapters/mercadoLivre.js';
import { createShopeeSignature, normalizeShopeeNode } from '../src/adapters/shopee.js';

describe('adaptadores de marketplaces', () => {
  test('normaliza Mercado Livre sem inventar link afiliado', () => {
    const offer = normalizeMercadoLivreItem({
      id: 'MLB123',
      title: 'Notebook em oferta',
      price: 2500,
      original_price: 4000,
      permalink: 'https://produto.mercadolivre.com.br/MLB123',
      thumbnail: 'http://http2.mlstatic.com/image.jpg'
    });
    assert.equal(offer.affiliateEligible, false);
    assert.equal(offer.affiliateUrl, undefined);
    assert.equal(offer.imageUrl?.startsWith('https://'), true);
  });

  test('normaliza item rastreado da Amazon Creators API', () => {
    const offer = normalizeAmazonItem({
      asin: 'B000TEST',
      detailPageURL: 'https://www.amazon.com.br/dp/B000TEST?tag=r2r-20',
      itemInfo: { title: { displayValue: 'Fone Bluetooth' } },
      images: { primary: { large: { url: 'https://m.media-amazon.com/test.jpg' } } },
      offersV2: { listings: [{
        isBuyBoxWinner: true,
        merchantInfo: { name: 'Amazon Brasil' },
        price: {
          money: { amount: 149.9 },
          savingBasis: { money: { amount: 199.9 } },
          savings: { percentage: 25 }
        }
      }] }
    }, 'r2r-20');
    assert.ok(offer);
    assert.equal(offer.affiliateEligible, true);
    assert.equal(offer.currentPrice, 149.9);
    assert.equal(offer.discountPercent, 25);
  });

  test('mapeia endpoints OAuth atuais da Amazon para o Brasil', () => {
    assert.match(amazonTokenEndpoint('2.1'), /amazoncognito\.com/);
    assert.equal(amazonTokenEndpoint('3.1'), 'https://api.amazon.com/auth/o2/token');
    assert.throws(() => amazonTokenEndpoint('1.0'), /não suportada/);
  });

  test('assina e normaliza ofertas rastreáveis da Shopee', () => {
    assert.equal(
      createShopeeSignature('app123', 1700000000, '{"query":"q"}', 'secret456'),
      '4cbdf6f02f2d1b1fe0b6e8096ba7dc5b250cf90ff4aaff8150d4686988489afc'
    );
    const offer = normalizeShopeeNode({
      itemId: 123,
      productName: 'Air Fryer 5L',
      productLink: 'https://shopee.com.br/produto-i.1.123',
      offerLink: 'https://s.shopee.com.br/abc123',
      price: '299,90',
      imageUrl: 'https://cf.shopee.com.br/image.jpg',
      shopName: 'Loja Oficial'
    });
    assert.ok(offer);
    assert.equal(offer.affiliateEligible, true);
    assert.equal(offer.currentPrice, 299.9);
  });
});
