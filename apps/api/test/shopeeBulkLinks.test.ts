import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extractShopeeItemIdFromUrl, parseShopeeBulkLinks } from '../src/shopeeBulkLinks.js';

describe('importação de links Shopee em massa', () => {
  test('interpreta CSV oficial com Product Link e Offer Link', () => {
    const entries = parseShopeeBulkLinks(`Product Name,Product Link,Offer Link
"Fone Bluetooth","https://shopee.com.br/Fone-Bluetooth-i.123456.987654321","https://s.shopee.com.br/abc123"`);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'Fone Bluetooth');
    assert.equal(entries[0].externalId, '987654321');
    assert.equal(entries[0].affiliateUrl, 'https://s.shopee.com.br/abc123');
  });

  test('interpreta CSV em português separado por ponto e vírgula', () => {
    const entries = parseShopeeBulkLinks(`ID do produto;Nome do produto;Link do produto;Link afiliado
456789;Air Fryer;https://shopee.com.br/product/111/456789;https://shope.ee/oferta`);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'Air Fryer');
    assert.equal(entries[0].externalId, '456789');
    assert.equal(entries[0].productUrl, 'https://shopee.com.br/product/111/456789');
  });

  test('interpreta linhas livres com ID interno e link afiliado', () => {
    const entries = parseShopeeBulkLinks('clxoffer12345 https://s.shopee.com.br/linkcurto');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].offerId, 'clxoffer12345');
    assert.equal(entries[0].affiliateUrl, 'https://s.shopee.com.br/linkcurto');
  });

  test('extrai item id de URLs longas e universal-link', () => {
    assert.equal(
      extractShopeeItemIdFromUrl('https://shopee.com.br/Produto-i.999.888777666'),
      '888777666'
    );
    assert.equal(
      extractShopeeItemIdFromUrl('https://shopee.com.br/universal-link?redir=https%3A%2F%2Fshopee.com.br%2Fproduct%2F10%2F123456789'),
      '123456789'
    );
  });
});
