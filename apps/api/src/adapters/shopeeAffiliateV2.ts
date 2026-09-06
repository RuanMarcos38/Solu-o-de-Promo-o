import { config } from '../config.js';
import { fetchExternal } from '../http.js';
import type { MarketplaceAdapter, NormalizedOffer, SearchInput } from '../types.js';
import {
  createShopeeSignature,
  normalizeShopeeNode,
  shopeeAdapter as legacyShopeeAdapter
} from './shopee.js';

type ShopeeAffiliateNode = {
  itemId?: string | number;
  productId?: string | number;
  productName?: string;
  productLink?: string;
  offerLink?: string;
  imageUrl?: string;
  shopId?: string | number;
  shopName?: string;
  price?: string | number;
  priceMin?: string | number;
  priceMax?: string | number;
  priceDiscountRate?: string | number;
  ratingStar?: string | number;
  commissionRate?: string | number;
  sellerCommissionRate?: string | number;
  shopeeCommissionRate?: string | number;
  commission?: string | number;
  sales?: string | number;
};

type ShopeeAffiliateResponse = {
  data?: {
    productOfferV2?: {
      nodes?: ShopeeAffiliateNode[];
      pageInfo?: { page?: number; limit?: number; hasNextPage?: boolean };
    };
  };
  errors?: Array<{ message?: string }>;
};

const productOfferQueryV2 = `query ProductOffers($keyword: String!, $page: Int!, $limit: Int!) {
  productOfferV2(keyword: $keyword, page: $page, limit: $limit) {
    nodes {
      itemId
      productName
      productLink
      offerLink
      imageUrl
      shopId
      shopName
      price
      priceMin
      priceMax
      priceDiscountRate
      ratingStar
      commissionRate
      sellerCommissionRate
      shopeeCommissionRate
      commission
      sales
    }
    pageInfo { page limit hasNextPage }
  }
}`;

function numeric(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deriveOriginalPrice(node: ShopeeAffiliateNode) {
  const current = numeric(node.priceMin ?? node.price);
  const rawDiscount = numeric(node.priceDiscountRate);
  if (!current || rawDiscount === undefined) return undefined;
  const discount = rawDiscount > 0 && rawDiscount <= 1 ? rawDiscount * 100 : rawDiscount;
  if (discount <= 0 || discount >= 100) return undefined;
  return Number((current / (1 - discount / 100)).toFixed(2));
}

function configured() {
  return Boolean(config.shopeeAppId && config.shopeeSecret && config.shopeeEndpoint);
}

export async function searchShopeeAffiliateOfficial(input: SearchInput): Promise<NormalizedOffer[]> {
  if (!config.shopeeAppId || !config.shopeeSecret || !config.shopeeEndpoint) {
    throw new Error('Conecte a conta Shopee Afiliados e informe App ID/Secret da Open API.');
  }

  const variables = {
    keyword: input.keyword?.trim() || 'ofertas',
    page: 1,
    limit: Math.min(Math.max(input.limit ?? 30, 1), 50)
  };
  const payload = JSON.stringify({ query: productOfferQueryV2, variables });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createShopeeSignature(config.shopeeAppId, timestamp, payload, config.shopeeSecret);

  const response = await fetchExternal(config.shopeeEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${config.shopeeAppId}, Timestamp=${timestamp}, Signature=${signature}`
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(`Shopee Affiliate Open API retornou HTTP ${response.status}. Confira App ID, Secret e aprovação da Open API.`);
  }

  const result = await response.json() as ShopeeAffiliateResponse;
  const apiError = result.errors?.map((item) => item.message).filter(Boolean).join('; ');
  if (apiError) throw new Error(`Shopee Affiliate Open API: ${apiError}`);

  const offers = (result.data?.productOfferV2?.nodes ?? [])
    .map((node) => normalizeShopeeNode({
      ...node,
      itemId: node.itemId ?? node.productId,
      discountRate: node.priceDiscountRate,
      priceBeforeDiscount: deriveOriginalPrice(node)
    }))
    .filter((offer): offer is NormalizedOffer => Boolean(offer));

  if (!offers.length) {
    throw new Error('A Shopee não retornou ofertas afiliadas para esta busca. Tente outra palavra-chave ou confirme a liberação da Open API.');
  }

  const affiliateOffers = offers.filter((offer) => offer.affiliateEligible && offer.affiliateUrl);
  if (!affiliateOffers.length) {
    throw new Error('A Shopee retornou produtos, mas sem offerLink de afiliado. Confirme se sua conta está aprovada no programa de afiliados.');
  }

  return affiliateOffers;
}

export async function testShopeeAffiliateConnection() {
  const offers = await searchShopeeAffiliateOfficial({ keyword: 'ofertas', limit: 3 });
  return {
    connected: true,
    affiliateLinks: true,
    count: offers.length,
    sample: offers.slice(0, 3).map((offer) => ({
      title: offer.title,
      affiliateUrl: offer.affiliateUrl,
      discountPercent: offer.discountPercent,
      currentPrice: offer.currentPrice
    }))
  };
}

export const shopeeAffiliateV2Adapter: MarketplaceAdapter = {
  name: 'shopee',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    if (configured()) {
      try {
        return await searchShopeeAffiliateOfficial(input);
      } catch (officialError) {
        // Mantém descoberta legada como contingência, mas somente retorna links afiliados válidos
        // quando a conta oficial estiver configurada. Isso evita enviar link comum por engano.
        try {
          const fallback = await legacyShopeeAdapter.search(input);
          const verified = fallback.filter((offer) => offer.affiliateEligible && offer.affiliateUrl);
          if (verified.length) return verified;
        } catch {
          // A mensagem da API oficial é mais útil para o administrador.
        }
        throw officialError;
      }
    }

    // Sem credenciais da conta afiliada, a busca pública pode servir apenas para descoberta.
    // O envio permanece bloqueado porque não existe offerLink atribuído ao afiliado.
    return legacyShopeeAdapter.search(input);
  }
};
