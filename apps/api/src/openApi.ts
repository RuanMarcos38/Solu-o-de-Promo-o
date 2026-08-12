export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Promotion Radar Open API',
      version: '1.0.0',
      description: 'API pública, somente leitura, de ofertas. Por padrão retorna links afiliados verificados; a vitrine pode pedir produtos não rastreados com includeUntracked.'
    },
    servers: [{ url: process.env.PUBLIC_API_URL || 'http://localhost:3333' }],
    paths: {
      '/api/v1/health': {
        get: { summary: 'Verifica a disponibilidade da API', responses: { '200': { description: 'API disponível' } } }
      },
      '/api/v1/offers': {
        get: {
          summary: 'Lista ofertas da vitrine',
          parameters: [
            { name: 'keyword', in: 'query', schema: { type: 'string', maxLength: 160 } },
            { name: 'marketplace', in: 'query', schema: { type: 'string', enum: ['mercadolivre', 'amazon', 'shopee', 'magalu', 'aliexpress', 'other'] } },
            { name: 'minDiscount', in: 'query', schema: { type: 'number', minimum: 0, maximum: 100 } },
            { name: 'maxPrice', in: 'query', schema: { type: 'number', minimum: 0 } },
            { name: 'minScore', in: 'query', schema: { type: 'number', minimum: 0, maximum: 100 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
            { name: 'includeUntracked', in: 'query', schema: { type: 'boolean', default: false } }
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
      },
      '/api/v1/collect/run': {
        post: {
          summary: 'Executa busca imediata para a vitrine pública',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['keyword'],
                  properties: {
                    keyword: { type: 'string', minLength: 1, maxLength: 160 },
                    marketplace: { type: 'string', enum: ['mercadolivre', 'amazon', 'shopee'] }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Resultado da busca imediata' },
            '400': { description: 'Palavra-chave ausente ou inválida' }
          }
        }
      }
    },
    components: {
      schemas: {
        Offer: {
          type: 'object',
          required: ['id', 'externalId', 'marketplace', 'title', 'currentPrice', 'affiliateEligible', 'score'],
          properties: {
            id: { type: 'string' },
            externalId: { type: 'string' },
            marketplace: { type: 'string' },
            title: { type: 'string' },
            currentPrice: { type: 'number' },
            originalPrice: { type: 'number' },
            discountPercent: { type: 'number' },
            imageUrl: { type: 'string', format: 'uri' },
            productUrl: { type: 'string', format: 'uri' },
            affiliateUrl: { type: 'string', format: 'uri' },
            affiliateEligible: { type: 'boolean' },
            affiliateProvider: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100 }
          }
        }
      }
    }
  } as const;
}
