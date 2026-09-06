import { getAffiliateConnectionConfig, saveAffiliateConnectionConfig } from './affiliateConnectionStore.js';
import { config } from './config.js';
import { fetchExternal } from './http.js';

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function ensureMercadoLivreAccessToken() {
  let connection: Record<string, unknown>;
  try {
    connection = await getAffiliateConnectionConfig('mercadolivre');
  } catch {
    return config.mercadoLivreAccessToken;
  }

  const accessToken = text(connection.accessToken) ?? config.mercadoLivreAccessToken;
  const expiresAtText = text(connection.tokenExpiresAt);
  const expiresAt = expiresAtText ? Date.parse(expiresAtText) : Number.NaN;
  const stillValid = accessToken && (!Number.isFinite(expiresAt) || expiresAt - Date.now() > 5 * 60 * 1000);
  if (stillValid) return accessToken;

  const refreshToken = text(connection.refreshToken);
  const clientId = text(connection.clientId);
  const clientSecret = text(connection.clientSecret);
  if (!refreshToken || !clientId || !clientSecret) return accessToken;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });
    const response = await fetchExternal('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
    if (!response.ok) return accessToken;

    const payload = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user_id?: number | string;
      scope?: string;
    };
    if (!payload.access_token) return accessToken;

    await saveAffiliateConnectionConfig('mercadolivre', {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshToken,
      externalUserId: payload.user_id ? String(payload.user_id) : connection.externalUserId,
      scope: payload.scope ?? connection.scope,
      tokenExpiresAt: payload.expires_in
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : connection.tokenExpiresAt
    }, 'system-token-refresh');

    return payload.access_token;
  } catch {
    return accessToken;
  }
}
