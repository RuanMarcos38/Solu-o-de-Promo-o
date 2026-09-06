import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireEditor } from './auth.js';
import { config } from './config.js';
import { fetchExternal } from './http.js';
import { testShopeeAffiliateConnection } from './adapters/shopeeAffiliateV2.js';

const marketplaceSchema = z.object({
  marketplace: z.enum(['mercadolivre', 'shopee'])
});

type MercadoLivreMe = {
  id?: number | string;
  nickname?: string;
  email?: string;
  site_id?: string;
};

async function testMercadoLivre() {
  if (!config.mercadoLivreAccessToken) {
    throw Object.assign(new Error('Conecte sua conta Mercado Livre pelo botão de autorização OAuth.'), { statusCode: 400 });
  }

  const response = await fetchExternal('https://api.mercadolibre.com/users/me', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.mercadoLivreAccessToken}`
    }
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Mercado Livre recusou a sessão OAuth (HTTP ${response.status}). Reconecte a conta.`), { statusCode: 400 });
  }

  const user = await response.json() as MercadoLivreMe;
  return {
    connected: true,
    marketplace: 'mercadolivre',
    account: {
      id: user.id,
      nickname: user.nickname,
      siteId: user.site_id
    },
    affiliateLinks: Boolean(config.affiliateResolverUrl),
    message: config.affiliateResolverUrl
      ? 'Conta Mercado Livre conectada e gerador autorizado de links configurado.'
      : 'Conta Mercado Livre conectada. A geração automática de link de comissão ainda depende de um método autorizado do programa de afiliados.'
  };
}

export async function registerAffiliateDiagnosticsRoutes(app: FastifyInstance) {
  app.post('/affiliate/connections/:marketplace/test', async (request) => {
    await requireEditor(request);
    const { marketplace } = marketplaceSchema.parse(request.params);

    if (marketplace === 'shopee') {
      const result = await testShopeeAffiliateConnection();
      return {
        marketplace,
        ...result,
        message: 'Shopee Affiliate Open API autenticada e retornando offerLink rastreável da conta.'
      };
    }

    return testMercadoLivre();
  });
}
