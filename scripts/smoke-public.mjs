import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiUrl = (process.env.API_URL ?? 'https://api-ofertas.r2rmarketingdigital.com.br').replace(/\/$/, '');
const appUrl = (process.env.APP_URL ?? 'https://ofertas.r2rmarketingdigital.com.br').replace(/\/$/, '');
const strictMarketplaces = process.env.STRICT_MARKETPLACES === 'true';
const requireMercadoLivre = process.env.REQUIRE_MERCADO_LIVRE_SMOKE !== 'false';
const probeOptionalMarketplaces = process.env.PROBE_OPTIONAL_MARKETPLACES === 'true';
const checkFrontendBundle = process.env.CHECK_FRONTEND_BUNDLE !== 'false';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 20000);
const marketplaceTimeoutMs = Number(process.env.MARKETPLACE_SMOKE_TIMEOUT_MS ?? 130000);

const results = [];

function record(status, name, detail = '') {
  results.push({ status, name, detail });
  const label = status.toUpperCase().padEnd(4);
  console.log(`[${label}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function request(url, options = {}, timeout = timeoutMs) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  return {
    response,
    text,
    json: () => text ? JSON.parse(text) : null
  };
}

async function checkJson(name, url, validate) {
  try {
    const { response, text, json } = await request(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
    const data = json();
    validate?.(data);
    record('pass', name);
    return data;
  } catch (error) {
    record('fail', name, error instanceof Error ? error.message : 'Erro desconhecido');
    return null;
  }
}

const health = await checkJson('API /health', `${apiUrl}/health`, (data) => {
  if (data.status !== 'ok') throw new Error(`status inesperado: ${data.status}`);
});

await checkJson('API /api/v1/health', `${apiUrl}/api/v1/health`, (data) => {
  if (data.status !== 'ok') throw new Error(`status inesperado: ${data.status}`);
});

await checkJson('API /ready', `${apiUrl}/ready`, (data) => {
  if (!String(data.status ?? '').startsWith('ready')) throw new Error(`ready inesperado: ${data.status}`);
});

await checkJson('API /api/v1/offers/stats', `${apiUrl}/api/v1/offers/stats`, (data) => {
  if (typeof data.totalOffers !== 'number') throw new Error('totalOffers ausente');
});

const marketplaceStatus = await checkJson('API /api/v1/marketplaces', `${apiUrl}/api/v1/marketplaces`, (data) => {
  const names = new Set((data.marketplaces ?? []).map((item) => item.marketplace));
  for (const marketplace of ['mercadolivre', 'amazon', 'shopee']) {
    if (!names.has(marketplace)) throw new Error(`marketplace ausente: ${marketplace}`);
  }
});

await checkJson('API OpenAPI publico', `${apiUrl}/openapi.json`, (document) => {
  const required = ['/api/v1/health', '/api/v1/offers', '/api/v1/offers/stats', '/api/v1/marketplaces', '/api/v1/collect/run'];
  for (const route of required) {
    if (!document.paths?.[route]) throw new Error(`OpenAPI sem ${route}`);
  }
});

async function checkAppBundle() {
  try {
    const { response, text } = await request(`${appUrl}/?qa=${Date.now()}`);
    if (!response.ok) throw new Error(`HTML HTTP ${response.status}`);
    const asset = text.match(/assets\/index-[^"']+\.js/)?.[0];
    if (!asset) throw new Error('asset JS principal nao encontrado');
    const assetUrl = new URL(asset, `${appUrl}/`).toString();
    const bundle = await request(assetUrl);
    if (!bundle.response.ok) throw new Error(`bundle HTTP ${bundle.response.status}`);
    if (!bundle.text.includes('/api/v1/collect/run')) throw new Error('bundle sem busca imediata publica');
    if (!bundle.text.includes('promo_language')) throw new Error('bundle sem persistencia de idioma');
    if (bundle.text.includes('localhost:3333')) throw new Error('bundle ainda aponta para localhost');
    if (bundle.text.includes('/collect/enqueue')) throw new Error('bundle ainda usa fila antiga de coleta');
    record('pass', 'Frontend publicado', asset);
  } catch (error) {
    record('fail', 'Frontend publicado', error instanceof Error ? error.message : 'Erro desconhecido');
  }
}

async function probeMarketplace(marketplace, keyword, required) {
  try {
    const { response, text, json } = await request(`${apiUrl}/api/v1/collect/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketplace, keyword })
    }, marketplaceTimeoutMs);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
    const data = json();
    const count = Array.isArray(data.offers) ? data.offers.length : 0;
    const errors = (data.errors ?? []).map((item) => item.error).join(' | ');
    if (count <= 0) throw new Error(errors || 'nenhuma oferta retornada');
    record('pass', `Marketplace ${marketplace}`, `${count} oferta(s) para "${keyword}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    if (required || strictMarketplaces) record('fail', `Marketplace ${marketplace}`, message);
    else record('warn', `Marketplace ${marketplace}`, `${message}. Dependencia externa indisponivel; o build interno continua validado.`);
  }
}

if (checkFrontendBundle) {
  await checkAppBundle();
}
await probeMarketplace('mercadolivre', process.env.MERCADO_LIVRE_SMOKE_KEYWORD ?? 'fone de ouvido', requireMercadoLivre);

if (probeOptionalMarketplaces || strictMarketplaces) {
  const statuses = marketplaceStatus?.marketplaces ?? [];
  const configured = new Map(statuses.map((item) => [item.marketplace, Boolean(item.configured)]));
  await probeMarketplace('amazon', process.env.AMAZON_SMOKE_KEYWORD ?? 'fone de ouvido', configured.get('amazon') === true);
  await probeMarketplace('shopee', process.env.SHOPEE_SMOKE_KEYWORD ?? 'fone de ouvido', configured.get('shopee') === true);
}

const report = {
  generatedAt: new Date().toISOString(),
  apiUrl,
  appUrl,
  health,
  results,
  summary: {
    pass: results.filter((item) => item.status === 'pass').length,
    warn: results.filter((item) => item.status === 'warn').length,
    fail: results.filter((item) => item.status === 'fail').length
  }
};

await mkdir(path.join(root, 'qa-reports'), { recursive: true });
await writeFile(path.join(root, 'qa-reports', 'public-smoke.json'), JSON.stringify(report, null, 2));

if (report.summary.fail > 0) {
  throw new Error(`Smoke publico falhou em ${report.summary.fail} checagem(ns).`);
}

console.log(`Smoke publico aprovado: ${report.summary.pass} checagem(ns), ${report.summary.warn} aviso(s).`);
