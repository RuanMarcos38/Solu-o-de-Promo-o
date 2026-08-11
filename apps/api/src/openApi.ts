export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Promotion Radar Open API',
      version: '1.0.0',
      description: 'API pública, somente leitura, de ofertas com link afiliado verificado.'
    },
    servers: [{ url: process.env.PUBLIC_API_URL || 'http://localhost:3333' }],
    paths: {
      '/api/v1/health': {
        get: { summary: 'Verifica a disponibilidade da API', responses: { '200': { description: 'API disponível' } } }
      },
      '/api/v1/offers': {
        get: {
          summary: 'Lista somente ofertas afiliadas verificadas',
          parameters: [
            { name: 'keyword', in: 'query', schema: { type: 'string', maxLength: 160 } },
            { name: 'marketplace', in: 'query', schema: { type: 'string', enum: ['mercadolivre', 'amazon', 'shopee', 'magalu', 'aliexpress', 'other'] } },
            { name: 'minDiscount', in: 'query', schema: { type: 'number', minimum: 0, maximum: 100 } },
            { name: 'maxPrice', in: 'query', schema: { type: 'number', minimum: 0 } },
            { name: 'minScore', in: 'query', schema: { type: 'number', minimum: 0, maximum: 100 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } }
          ],
          responses: {
            '200': {
              description: 'Lista de ofertas',
              content: { 'application/json': { schema: { type: 'object', properties: { offers: { type: 'array', items: { $ref: '#/components/schemas/Offer' } } } } } }
            }
          }
        }
      },
      '/api/v1/offers/stats': {
        get: { summary: 'Estatísticas das ofertas verificadas', responses: { '200': { description: 'Estatísticas' } } }
      },
      '/api/v1/marketplaces': {
        get: { summary: 'Estado sanitizado dos conectores', responses: { '200': { description: 'Conectores configurados' } } }
      }
    },
    components: {
      schemas: {
        Offer: {
          type: 'object',
          required: ['id', 'externalId', 'marketplace', 'title', 'currentPrice', 'affiliateUrl', 'affiliateEligible', 'score'],
          properties: {
            id: { type: 'string' },
            externalId: { type: 'string' },
            marketplace: { type: 'string' },
            title: { type: 'string' },
            currentPrice: { type: 'number' },
            originalPrice: { type: 'number' },
            discountPercent: { type: 'number' },
            imageUrl: { type: 'string', format: 'uri' },
            affiliateUrl: { type: 'string', format: 'uri' },
            affiliateEligible: { const: true },
            affiliateProvider: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100 }
          }
        }
      }
    }
  } as const;
}
