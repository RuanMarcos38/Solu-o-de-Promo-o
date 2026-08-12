import type { MarketplaceAdapter, NormalizedOffer, SearchInput } from '../types.js';
import { calculateDiscount, calculateScore, normalizeTitle } from '../scoring.js';
import { config } from '../config.js';
import { fetchExternal } from '../http.js';
import { resolveAffiliateLink } from '../affiliate.js';

type MercadoLivreItem = {
  id: string;
  title: string;
  price: number;
  original_price?: number | null;
  permalink: string;
  thumbnail?: string;
  category_id?: string;
  seller?: { nickname?: string };
  shipping?: { free_shipping?: boolean };
};

type MercadoLivreResponse = {
  results?: MercadoLivreItem[];
};

type MercadoLivreOfferPageItem = {
  card?: {
    metadata?: { id?: string; product_id?: string; url?: string; url_fragments?: string; url_params?: string };
    pictures?: { pictures?: Array<{ id?: string }>; alt_text?: string };
    components?: Array<{
      type?: string;
      title?: { text?: string };
      seller?: { values?: Array<{ label?: { text?: string } }> };
      reviews?: { rating_average?: number; count?: number };
      price?: {
        current_price?: { value?: number; currency?: string };
        price_labels?: Array<{ values?: Array<{ price?: { value?: number; previous?: boolean }; pill?: { text?: string } }> }>;
      };
      shipping_v2?: Array<{ values?: Array<{ label?: { text?: string; alt_text?: string } }> }>;
    }>;
  };
};

type MercadoLivreOfferPageData = {
  props?: { pageProps?: { data?: { items?: MercadoLivreOfferPageItem[] } } };
  appProps?: { pageProps?: { data?: { items?: MercadoLivreOfferPageItem[] } } };
  pageProps?: { data?: { items?: MercadoLivreOfferPageItem[] } };
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u002F/g, '/')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function extractNextData(html: string): MercadoLivreOfferPageData | undefined {
  const script = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i)?.[1];
  const nordicScript = html.match(/<script id="__NORDIC_RENDERING_CTX__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  const rawData = script ?? extractAssignedObject(nordicScript ?? '', '_n.ctx.r=');
  if (!rawData) return undefined;
  try {
    return JSON.parse(decodeHtml(rawData)) as MercadoLivreOfferPageData;
  } catch {
    return undefined;
  }
}

function extractAssignedObject(script: string, marker: string) {
  const markerIndex = script.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const start = script.indexOf('{', markerIndex + marker.length);
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = start; index < script.length; index += 1) {
    const char = script[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return script.slice(start, index + 1);
    }
  }

  return undefined;
}

function imageFromPictureId(pictureId: string | undefined) {
  if (!pictureId) return undefined;
  return `https://http2.mlstatic.com/D_NQ_NP_2X_${pictureId}-F.webp`;
}

function normalizeProductUrl(rawUrl: string | undefined, urlParams?: string, urlFragments?: string) {
  if (!rawUrl) return undefined;
  const withProtocol = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  try {
    const parsed = new URL(decodeHtml(withProtocol));
    if (urlParams) {
      const params = new URLSearchParams(decodeHtml(urlParams).replace(/^\?/, ''));
      params.forEach((value, key) => parsed.searchParams.set(key, value));
    }
    if (urlFragments) parsed.hash = decodeHtml(urlFragments).replace(/^#/, '');
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeMercadoLivreOfferPageItem(item: MercadoLivreOfferPageItem): Omit<NormalizedOffer, 'score'> | null {
  const card = item.card;
  const components = card?.components ?? [];
  const title = components.find((component) => component.type === 'title')?.title?.text?.trim();
  const priceComponent = components.find((component) => component.type === 'price');
  const currentPrice = Number(priceComponent?.price?.current_price?.value ?? 0);
  const originalPrice = priceComponent?.price?.price_labels
    ?.flatMap((label) => label.values ?? [])
    .map((value) => value.price)
    .find((price) => price?.previous && Number(price.value) > currentPrice)?.value;
  const discountText = priceComponent?.price?.price_labels
    ?.flatMap((label) => label.values ?? [])
    .map((value) => value.pill?.text)
    .find((text) => /\d+\s*%/i.test(text ?? ''));
  const explicitDiscount = Number(discountText?.match(/\d+(?:[,.]\d+)?/)?.[0]?.replace(',', '.'));
  const productUrl = normalizeProductUrl(card?.metadata?.url, card?.metadata?.url_params, card?.metadata?.url_fragments);
  const externalId = card?.metadata?.id ?? card?.metadata?.product_id;
  const sellerName = components.find((component) => component.type === 'seller')?.seller?.values
    ?.map((value) => value.label?.text)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const shippingText = components
    .flatMap((component) => component.shipping_v2 ?? [])
    .flatMap((shipping) => shipping.values ?? [])
    .map((value) => `${value.label?.text ?? ''} ${value.label?.alt_text ?? ''}`)
    .join(' ');
  const rating = components.find((component) => component.type === 'reviews')?.reviews?.rating_average;

  if (!externalId || !title || !productUrl || currentPrice <= 0) return null;

  return {
    externalId,
    marketplace: 'mercadolivre',
    title,
    normalizedTitle: normalizeTitle(title),
    currentPrice,
    originalPrice,
    discountPercent: Number.isFinite(explicitDiscount) ? explicitDiscount : calculateDiscount(currentPrice, originalPrice),
    imageUrl: imageFromPictureId(card?.pictures?.pictures?.[0]?.id),
    productUrl,
    affiliateEligible: false,
    sellerName,
    rating,
    freeShipping: /frete\s+gr[áa]tis/i.test(shippingText)
  };
}

export function parseMercadoLivreOfferPage(html: string) {
  const data = extractNextData(html);
  const items = data?.props?.pageProps?.data?.items ?? data?.appProps?.pageProps?.data?.items ?? data?.pageProps?.data?.items ?? [];
  return items
    .map(normalizeMercadoLivreOfferPageItem)
    .filter((item): item is Omit<NormalizedOffer, 'score'> => Boolean(item));
}

export function normalizeMercadoLivreItem(item: MercadoLivreItem): Omit<NormalizedOffer, 'score'> {
  const currentPrice = Number(item.price ?? 0);
  const originalPrice = item.original_price ? Number(item.original_price) : undefined;
  const discountPercent = calculateDiscount(currentPrice, originalPrice);

  return {
    externalId: item.id,
    marketplace: 'mercadolivre',
    title: item.title,
    normalizedTitle: normalizeTitle(item.title),
    category: item.category_id,
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl: item.thumbnail?.replace(/^http:\/\//i, 'https://'),
    productUrl: item.permalink,
    affiliateEligible: false,
    sellerName: item.seller?.nickname,
    freeShipping: Boolean(item.shipping?.free_shipping)
  };
}

async function resolveOffers(items: Array<Omit<NormalizedOffer, 'score'>>) {
  return Promise.all(items.map(async (item) => {
    const affiliate = await resolveAffiliateLink({
      marketplace: 'mercadolivre',
      externalId: item.externalId,
      productUrl: item.productUrl
    });
    const resolved = { ...item, ...affiliate };
    return { ...resolved, score: calculateScore(resolved) };
  }));
}

async function searchMercadoLivreOfferPage(input: SearchInput) {
  const params = new URLSearchParams({ search: input.keyword });
  const url = `https://www.mercadolivre.com.br/ofertas?${params.toString()}`;
  const response = await fetchExternal(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });

  if (!response.ok) throw new Error(`Mercado Livre ofertas retornou HTTP ${response.status}`);
  const offers = parseMercadoLivreOfferPage(await response.text());
  if (offers.length === 0) throw new Error('Mercado Livre não retornou produtos legíveis para esta busca');
  return resolveOffers(offers.slice(0, Math.min(Math.max(input.limit ?? config.maxResultsPerSource, 1), 48)));
}

export const mercadoLivreAdapter: MarketplaceAdapter = {
  name: 'mercadolivre',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    if (config.requireVerifiedAffiliateLinks && !config.affiliateResolverUrl) {
      // A busca imediata pode exibir ofertas públicas; a distribuição continua restrita a links verificados.
    }
    const params = new URLSearchParams({
      q: input.keyword,
      limit: String(input.limit ?? config.maxResultsPerSource)
    });

    const url = `https://api.mercadolibre.com/sites/${encodeURIComponent(config.mercadoLivreSiteId)}/search?${params.toString()}`;
    const response = await fetchExternal(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'User-Agent': 'ZeniteOfertas/1.0 (+https://ofertas.r2rmarketingdigital.com.br)',
        ...(config.mercadoLivreAccessToken ? { Authorization: `Bearer ${config.mercadoLivreAccessToken}` } : {})
      }
    });

    if (!response.ok) {
      return searchMercadoLivreOfferPage(input);
    }

    const data = (await response.json()) as MercadoLivreResponse;

    const results = Array.isArray(data.results) ? data.results : [];
    return resolveOffers(results.map(normalizeMercadoLivreItem));
  }
};
