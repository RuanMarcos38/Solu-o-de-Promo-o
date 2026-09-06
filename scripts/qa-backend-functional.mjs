#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3333').replace(/\/$/, '');
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@test.local';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'TestAdminPassword123!';
const runId = `${Date.now()}`;
const results = [];
let token = '';

function record(status, name, detail = '', meta = {}) {
  const item = { status, name, detail, ...meta };
  results.push(item);
  console.log(`[${status.toUpperCase().padEnd(4)}] ${name}${detail ? ` - ${detail}` : ''}`);
  return item;
}

async function request(pathname, options = {}, timeoutMs = 20000) {
  const headers = {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {})
  };
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body === undefined || typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* response textual */ }
  return { response, text, json };
}

async function check(name, pathname, options = {}, expected = [200], validate) {
  try {
    const result = await request(pathname, options);
    if (!expected.includes(result.response.status)) {
      throw new Error(`HTTP ${result.response.status}: ${result.text.slice(0, 300)}`);
    }
    await validate?.(result.json, result.response);
    record('pass', name, `HTTP ${result.response.status}`, { path: pathname, method: options.method ?? 'GET' });
    return result.json;
  } catch (error) {
    record('fail', name, error instanceof Error ? error.message : 'erro desconhecido', { path: pathname, method: options.method ?? 'GET' });
    return null;
  }
}

await check('Saude /health', '/health', {}, [200], (body) => {
  if (body?.status !== 'ok') throw new Error('status de health inesperado');
});
await check('Saude /api/v1/health', '/api/v1/health', {}, [200], (body) => {
  if (body?.status !== 'ok') throw new Error('status de api/v1/health inesperado');
});
await check('Prontidao /ready', '/ready', {}, [200], (body) => {
  if (!String(body?.status ?? '').startsWith('ready')) throw new Error('API nao esta pronta');
});
await check('OpenAPI', '/openapi.json', {}, [200], (body) => {
  for (const required of ['/api/v1/offers', '/api/v1/offers/stats', '/api/v1/marketplaces', '/api/v1/collect/run']) {
    if (!body?.paths?.[required]) throw new Error(`rota ausente no OpenAPI: ${required}`);
  }
});
await check('Ofertas publicas', '/api/v1/offers?includeUntracked=true&minDiscount=50&limit=100');
await check('Estatisticas de ofertas', '/api/v1/offers/stats');
await check('Status dos marketplaces', '/api/v1/marketplaces', {}, [200], (body) => {
  const names = new Set((body?.marketplaces ?? []).map((item) => item.marketplace));
  for (const marketplace of ['mercadolivre', 'amazon', 'shopee']) {
    if (!names.has(marketplace)) throw new Error(`marketplace ausente: ${marketplace}`);
  }
});

await check('Login invalido protegido', '/auth/login', {
  method: 'POST',
  body: { email: adminEmail, password: 'senha-incorreta-qa' }
}, [401]);

const login = await check('Login administrativo', '/auth/login', {
  method: 'POST',
  body: { email: adminEmail, password: adminPassword }
}, [200], (body) => {
  if (!body?.token) throw new Error('token ausente');
});
if (login?.token) token = login.token;

await check('Sessao /auth/me', '/auth/me', {}, [200], (body) => {
  if (!body?.user?.id || body?.user?.role !== 'ADMIN') throw new Error('usuario ADMIN nao carregado');
});

const source = await check('Criar fonte', '/admin/sources', {
  method: 'POST',
  body: { name: `QA Fonte ${runId}`, marketplace: 'mercadolivre', keywords: ['qa', 'oferta'] }
}, [200, 201]);
const sourceId = source?.source?.id ?? source?.id;
if (sourceId) {
  await check('Alternar fonte', `/admin/sources/${encodeURIComponent(sourceId)}`, {
    method: 'PUT',
    body: { isActive: false }
  }, [200]);
} else {
  record('fail', 'Alternar fonte', 'ID da fonte nao retornado');
}
await check('Listar fontes', '/admin/sources');

const alert = await check('Criar alerta', '/alerts', {
  method: 'POST',
  body: {
    name: `QA Alerta ${runId}`,
    keywords: ['qa'],
    marketplaces: ['mercadolivre'],
    minDiscountPercent: 50
  }
}, [200, 201]);
const alertId = alert?.alert?.id ?? alert?.id;
if (alertId) {
  await check('Alternar alerta', `/alerts/${encodeURIComponent(alertId)}`, {
    method: 'PUT',
    body: { isActive: false }
  }, [200]);
} else {
  record('fail', 'Alternar alerta', 'ID do alerta nao retornado');
}
await check('Listar alertas', '/alerts');

const channel = await check('Criar canal webhook', '/dispatch/channels', {
  method: 'POST',
  body: {
    name: `QA Webhook ${runId}`,
    type: 'webhook',
    isActive: true,
    config: { url: 'https://example.com/qa-webhook' }
  }
}, [200, 201]);
const channelId = channel?.channel?.id ?? channel?.id;
if (channelId) {
  await check('Alternar canal', `/dispatch/channels/${encodeURIComponent(channelId)}`, {
    method: 'PUT',
    body: { isActive: false }
  }, [200]);
} else {
  record('fail', 'Alternar canal', 'ID do canal nao retornado');
}
await check('Listar canais', '/dispatch/channels');
await check('Historico de envios', '/dispatch/logs?limit=20');

const qaUserEmail = `qa-${runId}@test.local`;
const user = await check('Criar usuario', '/admin/users', {
  method: 'POST',
  body: { name: 'QA Usuario', email: qaUserEmail, password: 'QaFunctionalPassword123!', role: 'VIEWER' }
}, [200, 201]);
const userId = user?.user?.id ?? user?.id;
if (userId) {
  await check('Desativar usuario', `/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: { isActive: false }
  }, [200]);
  await check('Reativar usuario', `/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: { isActive: true }
  }, [200]);
} else {
  record('fail', 'Alternar usuario', 'ID do usuario nao retornado');
}
await check('Listar usuarios', '/admin/users');

const settings = await check('Ler configuracoes', '/admin/settings');
if (settings?.settings && Number.isInteger(settings?.version)) {
  await check('Salvar configuracoes', '/admin/settings', {
    method: 'PUT',
    body: { expectedVersion: settings.version, settings: settings.settings }
  }, [200]);
} else {
  record('fail', 'Salvar configuracoes', 'payload de configuracao incompleto');
}

await check('Listar conexoes de afiliados', '/affiliate/connections');
await check('Salvar configuracao Mercado Livre', '/affiliate/connections/mercadolivre', {
  method: 'PUT',
  body: {
    accountEmail: 'qa-mercadolivre@test.local',
    affiliateLabel: 'QA Mercado Livre',
    clientId: 'qa-client-id',
    clientSecret: 'qa-client-secret',
    redirectUri: `${apiUrl}/affiliate/connections/mercadolivre/oauth/callback`
  }
}, [200]);
await check('Iniciar OAuth Mercado Livre', '/affiliate/connections/mercadolivre/oauth/start', {
  method: 'POST',
  body: {}
}, [200], (body) => {
  const url = new URL(body?.authUrl ?? '');
  if (url.hostname !== 'auth.mercadolivre.com.br') throw new Error('URL OAuth nao aponta para Mercado Livre');
  if (!url.searchParams.get('state')) throw new Error('OAuth sem state');
});

await check('Salvar configuracao Shopee', '/affiliate/connections/shopee', {
  method: 'PUT',
  body: {
    accountEmail: 'qa-shopee@test.local',
    affiliateLabel: 'QA Shopee',
    endpoint: 'https://open-api.affiliate.shopee.com.br/graphql'
  }
}, [200]);
await check('Salvar configuracao Amazon', '/affiliate/connections/amazon', {
  method: 'PUT',
  body: {
    accountEmail: 'qa-amazon@test.local',
    affiliateLabel: 'QA Amazon',
    partnerTag: 'qa-associado-20',
    apiBaseUrl: 'https://creatorsapi.amazon'
  }
}, [200]);

const offers = await check('Carregar ofertas QA', '/api/v1/offers?keyword=QA&includeUntracked=true&minDiscount=50&limit=100');
const qaOffers = offers?.offers ?? [];
const pendingMl = qaOffers.find((item) => item.marketplace === 'mercadolivre' && !item.affiliateEligible);
const affiliateMl = qaOffers.find((item) => item.marketplace === 'mercadolivre' && item.affiliateEligible);

if (pendingMl?.id) {
  await check('Vincular link afiliado manual', `/affiliate/offers/${encodeURIComponent(pendingMl.id)}/manual-link`, {
    method: 'POST',
    body: { affiliateUrl: 'https://www.mercadolivre.com.br/qa-link-afiliado-validado' }
  }, [200]);
} else {
  record('warn', 'Vincular link afiliado manual', 'Oferta Mercado Livre pendente nao encontrada na massa QA');
}

await check('Afiliacao em lote', '/affiliate/batch/resolve', {
  method: 'POST',
  body: { marketplace: 'shopee', limit: 10 }
}, [200], (body) => {
  if (typeof body?.requested !== 'number' || typeof body?.pendingCount !== 'number') {
    throw new Error('resumo da afiliacao em lote incompleto');
  }
});

if (affiliateMl?.id) {
  await check('Disparo WhatsApp por oferta', `/dispatch/whatsapp/${encodeURIComponent(affiliateMl.id)}`, {
    method: 'POST',
    body: {}
  }, [200]);
  await check('Automacao afiliado + WhatsApp', `/automation/affiliate-whatsapp/${encodeURIComponent(affiliateMl.id)}`, {
    method: 'POST',
    body: {}
  }, [200]);
} else {
  record('warn', 'Fluxos WhatsApp', 'Oferta afiliada QA nao encontrada');
}

await check('Validacao de oferta inexistente', '/affiliate/offers/qa-inexistente/manual-link', {
  method: 'POST',
  body: { affiliateUrl: 'https://www.mercadolivre.com.br/qa' }
}, [404]);

const report = {
  generatedAt: new Date().toISOString(),
  apiUrl,
  summary: {
    pass: results.filter((item) => item.status === 'pass').length,
    warn: results.filter((item) => item.status === 'warn').length,
    fail: results.filter((item) => item.status === 'fail').length
  },
  results
};

await mkdir(path.join(root, 'qa-reports'), { recursive: true });
await writeFile(path.join(root, 'qa-reports', 'backend-functional.json'), JSON.stringify(report, null, 2));
console.log(`Backend QA: ${report.summary.pass} passou, ${report.summary.warn} aviso(s), ${report.summary.fail} falhou.`);
if (report.summary.fail > 0) process.exit(1);
