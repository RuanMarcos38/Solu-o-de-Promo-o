import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatOfferMessage,
  offerMatchesAlert,
  type AlertForMatch,
  type OfferForDispatch
} from '../src/dispatch.js';

const offer: OfferForDispatch = {
  id: 'offer-1',
  title: 'Smart TV 55 4K Samsung',
  currentPrice: 2199.9,
  discountPercent: 35,
  productUrl: 'https://example.com/product',
  affiliateUrl: 'https://example.com/affiliate',
  marketplace: 'mercadolivre',
  score: 92
};

function alert(overrides: Partial<AlertForMatch> = {}): AlertForMatch {
  return {
    name: 'TV em promoção',
    keywords: ['smart tv'],
    marketplaces: ['mercadolivre'],
    minDiscountPercent: 20,
    maxPrice: 2500,
    ...overrides
  };
}

describe('distribuição', () => {
  test('combina palavra-chave, marketplace, desconto e preço máximo', () => {
    assert.equal(offerMatchesAlert(offer, alert()), true);
    assert.equal(offerMatchesAlert(offer, alert({ keywords: ['notebook'] })), false);
    assert.equal(offerMatchesAlert(offer, alert({ marketplaces: ['amazon'] })), false);
    assert.equal(offerMatchesAlert(offer, alert({ minDiscountPercent: 40 })), false);
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
    assert.match(message, /35% OFF/);
    assert.match(message, /Score: 92/);
    assert.match(message, /https:\/\/example\.com\/affiliate/);
    assert.equal(message.includes(offer.productUrl), false);
  });
});
