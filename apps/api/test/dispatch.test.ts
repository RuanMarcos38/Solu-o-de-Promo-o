import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildDispatchIdempotencyKey,
  formatOfferMessage,
  checkMarketplaceChannelPolicy,
  offerMatchesAlert,
  type AlertForMatch,
  type OfferForDispatch
} from '../src/dispatchRules.js';

const offer: OfferForDispatch = {
  id: 'offer-1',
  title: 'Smart TV 55 4K Samsung',
  currentPrice: 2199.9,
  discountPercent: 55,
  productUrl: 'https://example.com/product',
  affiliateUrl: 'https://example.com/affiliate',
  affiliateEligible: true,
  marketplace: 'mercadolivre',
  score: 92
};

function alert(overrides: Partial<AlertForMatch> = {}): AlertForMatch {
  return {
    name: 'TV em promoção',
    keywords: ['smart tv'],
    marketplaces: ['mercadolivre'],
    minDiscountPercent: 50,
    maxPrice: 2500,
    ...overrides
  };
}

describe('distribuição', () => {
  test('combina palavra-chave, marketplace, desconto e preço máximo', () => {
    assert.equal(offerMatchesAlert(offer, alert()), true);
    assert.equal(offerMatchesAlert(offer, alert({ keywords: ['notebook'] })), false);
    assert.equal(offerMatchesAlert(offer, alert({ marketplaces: ['amazon'] })), false);
    assert.equal(offerMatchesAlert(offer, alert({ minDiscountPercent: 60 })), false);
    assert.equal(offerMatchesAlert(offer, alert({ maxPrice: 2000 })), false);
  });

  test('aceita alerta sem filtros opcionais', () => {
    assert.equal(offerMatchesAlert(offer, alert({ keywords: [], marketplaces: [], maxPrice: null })), true);
  });

  test('normaliza acentos na comparação de palavras-chave', () => {
    const accentedOffer = { ...offer, title: 'Cafeteira Edição Premium' };
    assert.equal(offerMatchesAlert(accentedOffer, alert({ keywords: ['edicao'], maxPrice: null })), true);
  });

  test('formata mensagem em pt-BR e prioriza URL de afiliado', () => {
    const message = formatOfferMessage(offer);

    assert.match(message, /Oferta encontrada/);
    assert.match(message, /R\$\s?2\.199,90/);
    assert.match(message, /55% OFF/);
    assert.match(message, /Score: 92/);
    assert.match(message, /https:\/\/example\.com\/affiliate/);
    assert.equal(message.includes(offer.productUrl), false);
  });

  test('gera chave idempotente estável por oferta, canal e versão comercial', () => {
    const first = buildDispatchIdempotencyKey(offer, 'channel-1');
    const duplicate = buildDispatchIdempotencyKey({ ...offer }, 'channel-1');
    const priceChanged = buildDispatchIdempotencyKey({ ...offer, currentPrice: 1999.9 }, 'channel-1');
    const scoreChanged = buildDispatchIdempotencyKey({ ...offer, score: 96 }, 'channel-1');
    const otherChannel = buildDispatchIdempotencyKey(offer, 'channel-2');

    assert.equal(first, duplicate);
    assert.notEqual(first, priceChanged);
    assert.notEqual(first, scoreChanged);
    assert.notEqual(first, otherChannel);
    assert.match(first, /^[a-f0-9]{64}$/);
  });

  test('bloqueia oferta não verificada e Mercado Livre em grupos fechados', () => {
    assert.equal(checkMarketplaceChannelPolicy({ ...offer, affiliateEligible: false }, 'telegram', { audience: 'public' }).allowed, false);
    assert.equal(checkMarketplaceChannelPolicy(offer, 'whatsapp', { audience: 'private' }).allowed, false);
    assert.equal(checkMarketplaceChannelPolicy(offer, 'telegram', { audience: 'private' }).allowed, false);
    assert.equal(checkMarketplaceChannelPolicy(offer, 'telegram', { audience: 'public' }).allowed, true);
    assert.equal(checkMarketplaceChannelPolicy({ ...offer, marketplace: 'amazon' }, 'whatsapp', { audience: 'private' }).allowed, true);
  });

  test('nunca usa o link comum como fallback', () => {
    assert.throws(
      () => formatOfferMessage({ ...offer, affiliateEligible: false, affiliateUrl: undefined }),
      /sem link afiliado verificado/
    );
  });
});
