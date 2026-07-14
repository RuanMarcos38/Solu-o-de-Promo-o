import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from './config.js';

function isPrivateIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIp(address: string) {
  const normalized = address.toLowerCase();
  const version = isIP(normalized);

  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice('::ffff:'.length));
  }

  return false;
}

function isAllowlistedPrivateHost(hostname: string) {
  return config.allowedPrivateOutboundHosts.includes(hostname.toLowerCase());
}

export async function assertSafeOutboundUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL externa inválida');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Somente URLs HTTP ou HTTPS são permitidas');
  }

  if (parsed.protocol === 'http:' && !config.outboundAllowHttp) {
    throw new Error('HTTP sem TLS está desabilitado para chamadas externas');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Credenciais embutidas na URL não são permitidas');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Host externo não permitido');
  }

  if (isAllowlistedPrivateHost(hostname)) return parsed;

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Endereço IP privado ou reservado não permitido');
    return parsed;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Host resolve para endereço privado ou reservado');
  }

  return parsed;
}

export async function fetchExternal(
  rawUrl: string,
  init: RequestInit = {},
  timeoutMs = config.outboundHttpTimeoutMs
) {
  const parsed = await assertSafeOutboundUrl(rawUrl);
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);

  return fetch(parsed, {
    ...init,
    redirect: 'error',
    signal
  });
}
