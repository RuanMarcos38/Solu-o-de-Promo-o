import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { amazonPublicKeywordVariants, amazonTokenEndpoint, normalizeAmazonItem, normalizeAmazonPublicBlock } from '../src/adapters/amazon.js';
import { normalizeMercadoLivreItem, parseMercadoLivreOfferPage } from '../src/adapters/mercadoLivre.js';
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

  test('usa variacoes conservadoras quando a vitrine publica da Amazon bloqueia termos comuns', () => {
    assert.deepEqual(amazonPublicKeywordVariants('iphone'), ['iphone', 'iphone apple']);
    assert.deepEqual(amazonPublicKeywordVariants('notebook gamer'), ['notebook gamer', 'laptop gamer']);
    assert.deepEqual(amazonPublicKeywordVariants('fone bluetooth'), ['fone bluetooth']);
  });

  test('normaliza vitrine pública da Amazon quando credenciais oficiais ainda não existem', () => {
    const offer = normalizeAmazonPublicBlock('B07JQKQ91F', `
      <img class="s-image" src="https://m.media-amazon.com/images/I/fone.jpg" alt="JBL, Fone de Ouvido in Ear, C50HI - Preto"/>
      <div data-cy="title-recipe"><a href="/Ouvido-JBL-C50HI-Intra-Auricular-Preto/dp/B07JQKQ91F/ref=sr_1_7"><h2 aria-label="JBL, Fone de Ouvido in Ear, C50HI - Preto"><span>JBL, Fone de Ouvido in Ear, C50HI - Preto</span></h2></a></div>
      <span class="a-offscreen">R$57,09</span>
      <span class="a-offscreen">De: R$74,90</span>
      <a aria-label="4,6 de 5 estrelas"></a>
      Entrega GRÁTIS
    `);

    assert.ok(offer);
    assert.equal(offer.affiliateEligible, false);
    assert.equal(offer.currentPrice, 57.09);
    assert.equal(offer.originalPrice, 74.9);
    assert.equal(offer.discountPercent, 23.78);
    assert.equal(offer.rating, 4.6);
  });

  test('normaliza JSON embutido da página de ofertas do Mercado Livre', () => {
    const offers = parseMercadoLivreOfferPage(`
      <script id="__NEXT_DATA__" type="application/json">{
        "props":{"pageProps":{"data":{"items":[{
          "card":{
            "metadata":{"id":"MLB4555189589","url":"www.mercadolivre.com.br/produto/p/MLB66637233","url_params":"?pdp_filters=deal%3AMLB779362-1","url_fragments":"#tracking"},
            "pictures":{"pictures":[{"id":"602304-MLA109372354737_032026"}]},
            "components":[
              {"type":"title","title":{"text":"Creatina Monohidratada 500g Growth Supplements - Sem Sabor em Pó"}},
              {"type":"seller","seller":{"values":[{"label":{"text":"Loja Oficial"}}]}},
              {"type":"reviews","reviews":{"rating_average":4.9}},
              {"type":"price","price":{"price_labels":[{"values":[{"pill":{"text":"24% OFF"}},{"price":{"value":104.9,"previous":true}}]}],"current_price":{"value":78.9,"currency":"BRL"}}},
              {"type":"shipping_v2","shipping_v2":[{"values":[{"label":{"text":"Frete grátis"}}]}]}
            ]
          }
        }]}}}
      }</script>
    `);

    assert.equal(offers.length, 1);
    assert.equal(offers[0].externalId, 'MLB4555189589');
    assert.equal(offers[0].currentPrice, 78.9);
    assert.equal(offers[0].originalPrice, 104.9);
    assert.equal(offers[0].discountPercent, 24);
    assert.equal(offers[0].freeShipping, true);
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
