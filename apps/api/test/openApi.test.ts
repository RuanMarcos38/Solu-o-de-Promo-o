import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildOpenApiDocument } from '../src/openApi.js';

describe('Open API', () => {
  test('documenta endpoints públicos somente leitura e vitrine imediata', () => {
    const document = buildOpenApiDocument();
    assert.equal(document.openapi, '3.1.0');
    assert.ok(document.paths['/api/v1/offers'].get);
    assert.ok(document.paths['/api/v1/collect/run'].post);
    assert.equal('post' in document.paths['/api/v1/offers'], false);
    assert.equal(document.components.schemas.Offer.properties.affiliateEligible.type, 'boolean');
  });
});
