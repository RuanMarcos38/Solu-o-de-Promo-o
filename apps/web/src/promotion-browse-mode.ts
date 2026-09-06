/*
 * Modo de navegação de promoções.
 *
 * O frontend existente envia POST /api/v1/collect/run ao clicar em "Buscar agora".
 * Quando a palavra-chave está vazia, o backend legado rejeita a requisição como
 * inválida. Para preservar o backend e as integrações já existentes, este módulo
 * transforma somente esse caso em uma leitura do catálogo de ofertas já
 * qualificadas. Assim, campo vazio significa "mostrar promoções disponíveis".
 */

const nativeFetch = window.fetch.bind(window);

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function readJsonBody(init?: RequestInit) {
  if (typeof init?.body !== 'string') return null;
  try {
    return JSON.parse(init.body) as { keyword?: unknown; marketplace?: unknown };
  } catch {
    return null;
  }
}

function isEmptyKeyword(value: unknown) {
  return typeof value !== 'string' || value.trim().length === 0;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input);
  const method = requestMethod(input, init);

  if (method === 'POST' && /\/api\/v1\/collect\/run(?:\?|$)/.test(url)) {
    const body = readJsonBody(init);

    if (body && isEmptyKeyword(body.keyword)) {
      const collectUrl = new URL(url, window.location.origin);
      const offersUrl = new URL('/api/v1/offers', collectUrl.origin);
      const marketplace = typeof body.marketplace === 'string' ? body.marketplace.trim() : '';

      if (marketplace) offersUrl.searchParams.set('marketplace', marketplace);
      offersUrl.searchParams.set('includeUntracked', 'true');
      offersUrl.searchParams.set('limit', '100');

      const offersResponse = await nativeFetch(offersUrl.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      if (!offersResponse.ok) {
        const errorPayload = await offersResponse.json().catch(() => ({ message: 'Não foi possível carregar as promoções disponíveis.' }));
        return jsonResponse(errorPayload, offersResponse.status);
      }

      const data = await offersResponse.json() as { offers?: unknown[] };
      const offers = Array.isArray(data.offers) ? data.offers : [];

      return jsonResponse({
        offers,
        approved: offers,
        approvedCount: offers.length,
        foundCount: offers.length,
        errors: [],
        browseMode: true
      });
    }
  }

  return nativeFetch(input, init);
};
