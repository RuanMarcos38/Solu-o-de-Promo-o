export type ShopeeBulkLinkEntry = {
  offerId?: string;
  externalId?: string;
  productUrl?: string;
  affiliateUrl: string;
  title?: string;
};

const urlPattern = /https?:\/\/[^\s"',;<>]+/gi;

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, '');
}

function normalizeHeader(value: string) {
  return stripBom(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function cleanCell(value: string | undefined) {
  return stripBom(String(value ?? '')).trim();
}

function detectDelimiter(firstLine: string) {
  const candidates = [',', ';', '\t'] as const;
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ',';
}

function parseDelimitedRows(input: string) {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const delimiter = detectDelimiter(normalized.split('\n')[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cleanCell(cell));
      cell = '';
      continue;
    }

    if (!quoted && char === '\n') {
      row.push(cleanCell(cell));
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cleanCell(cell));
  rows.push(row);

  return rows.filter((item) => item.some(Boolean));
}

function includesAny(value: string | undefined, aliases: string[]) {
  if (!value) return false;
  return aliases.some((alias) => value.includes(alias));
}

function looksLikeHeader(row: string[]) {
  const normalized = row.map(normalizeHeader);
  const hasKnownColumn = normalized.some((cell) => includesAny(cell, [
    'offerlink',
    'affiliatelink',
    'linkafiliado',
    'linkdeafiliado',
    'linkdashopee',
    'productlink',
    'itemid',
    'produto'
  ]));
  const hasUrl = row.some((cell) => /^https?:\/\//i.test(cell));
  return hasKnownColumn && !hasUrl;
}

function valueByHeader(row: string[], headers: string[], aliases: string[]) {
  const index = headers.findIndex((header) => includesAny(header, aliases));
  return index >= 0 ? cleanCell(row[index]) : undefined;
}

function firstUrl(value: string | undefined) {
  return cleanCell(value).match(urlPattern)?.[0];
}

function urlsFromRow(row: string[]) {
  return row.flatMap((cell) => cleanCell(cell).match(urlPattern) ?? []);
}

function containsUrl(value: string) {
  return /https?:\/\/[^\s"',;<>]+/i.test(value);
}

function nonUrlCells(row: string[]) {
  return row
    .flatMap((cell) => cleanCell(cell).split(/\s+/))
    .map(cleanCell)
    .filter((cell) => cell && !containsUrl(cell));
}

function isLikelyOfferId(value: string) {
  return /^[a-z0-9_-]{8,180}$/i.test(value) && !/^\d+$/.test(value);
}

function isLikelyExternalId(value: string) {
  return /^\d{6,}$/.test(value) || /^i\.\d+\.\d+$/i.test(value);
}

export function extractShopeeItemIdFromUrl(rawUrl: string | undefined) {
  if (!rawUrl) return undefined;
  const decoded = decodeURIComponent(rawUrl);
  const direct = decoded.match(/(?:product-)?i\.(\d+)\.(\d+)/i)
    ?? decoded.match(/\/product\/(\d+)\/(\d+)/i);
  if (direct?.[2]) return direct[2];

  try {
    const parsed = new URL(rawUrl);
    const redirected = parsed.searchParams.get('redir') || parsed.searchParams.get('url') || parsed.searchParams.get('originUrl');
    if (redirected && redirected !== rawUrl) return extractShopeeItemIdFromUrl(redirected);
  } catch {
    return undefined;
  }

  return undefined;
}

function entryFromHeaderRow(row: string[], headers: string[]): ShopeeBulkLinkEntry | undefined {
  const affiliateUrl = firstUrl(valueByHeader(row, headers, [
    'offerlink',
    'affiliatelink',
    'linkafiliado',
    'linkdeafiliado',
    'linkdaoferta',
    'linkdashopee',
    'convertedlink',
    'shortlink'
  ]));
  if (!affiliateUrl) return undefined;

  const productUrl = firstUrl(valueByHeader(row, headers, [
    'productlink',
    'producturl',
    'itemlink',
    'originurl',
    'originallink',
    'linkoriginal',
    'linkdoproduto'
  ]));
  const externalId = cleanCell(valueByHeader(row, headers, [
    'itemid',
    'idproduto',
    'productid',
    'iditem',
    'produtoid'
  ])) || extractShopeeItemIdFromUrl(productUrl);
  const offerId = cleanCell(valueByHeader(row, headers, ['offerid', 'ofertaid', 'idofer', 'idoffer'])) || undefined;
  const title = cleanCell(valueByHeader(row, headers, [
    'productname',
    'producttitle',
    'nomeproduto',
    'nomedoproduto',
    'tituloproduto',
    'titulodoproduto'
  ])) || undefined;

  return {
    affiliateUrl,
    productUrl,
    externalId: externalId || undefined,
    offerId,
    title
  };
}

function entryFromFreeRow(row: string[]): ShopeeBulkLinkEntry | undefined {
  const urls = urlsFromRow(row);
  if (urls.length === 0) return undefined;

  const affiliateUrl = urls[urls.length - 1];
  const productUrl = urls.length > 1 ? urls[0] : undefined;
  const cells = nonUrlCells(row);
  const offerId = cells.find(isLikelyOfferId);
  const externalId = cells.find(isLikelyExternalId) ?? extractShopeeItemIdFromUrl(productUrl);
  const title = cells.find((cell) => cell !== offerId && cell !== externalId && cell.length > 12);

  return {
    affiliateUrl,
    productUrl,
    offerId,
    externalId,
    title
  };
}

export function parseShopeeBulkLinks(input: string): ShopeeBulkLinkEntry[] {
  const rows = parseDelimitedRows(input);
  if (rows.length === 0) return [];

  if (looksLikeHeader(rows[0])) {
    const headers = rows[0].map(normalizeHeader);
    return rows
      .slice(1)
      .map((row) => entryFromHeaderRow(row, headers))
      .filter((entry): entry is ShopeeBulkLinkEntry => Boolean(entry));
  }

  return rows
    .map(entryFromFreeRow)
    .filter((entry): entry is ShopeeBulkLinkEntry => Boolean(entry));
}
