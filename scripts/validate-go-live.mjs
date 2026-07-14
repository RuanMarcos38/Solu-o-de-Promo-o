import { readFileSync } from 'node:fs';

const envPath = 'deploy/homologation.env.example';
const zonePath = 'deploy/dns/r2rmarketingdigital.com.br.homologation.zone';

const parseEnv = (content) => Object.fromEntries(
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    })
);

const env = parseEnv(readFileSync(envPath, 'utf8'));
const zone = readFileSync(zonePath, 'utf8');

const expected = {
  SERVER_IP: '2.25.155.142',
  APP_DOMAIN: 'ofertas.r2rmarketingdigital.com.br',
  API_DOMAIN: 'api-ofertas.r2rmarketingdigital.com.br',
  GRAFANA_DOMAIN: 'grafana-ofertas.r2rmarketingdigital.com.br',
  PUBLIC_API_URL: 'https://api-ofertas.r2rmarketingdigital.com.br'
};

for (const [key, value] of Object.entries(expected)) {
  if (env[key] !== value) throw new Error(`${key} precisa ser ${value}`);
}

const protectedHosts = new Set([
  'r2rmarketingdigital.com.br',
  'www.r2rmarketingdigital.com.br',
  'crm.r2rmarketingdigital.com.br',
  'n8n.r2rmarketingdigital.com.br'
]);

for (const key of ['APP_DOMAIN', 'API_DOMAIN', 'GRAFANA_DOMAIN']) {
  if (protectedHosts.has(env[key])) throw new Error(`${key} colide com um serviço existente`);
}

if (!/^v\d+\.\d+\.\d+-rc\.\d+$/.test(env.RELEASE_TAG || '')) {
  throw new Error('RELEASE_TAG precisa usar o formato vX.Y.Z-rc.N');
}

for (const host of ['ofertas', 'api-ofertas', 'grafana-ofertas']) {
  const pattern = new RegExp(`^${host}\\s+300\\s+IN\\s+A\\s+2\\.25\\.155\\.142$`, 'm');
  if (!pattern.test(zone)) throw new Error(`Registro DNS ausente ou inválido: ${host}`);
}

console.log('Ativos de go-live/homologação validados.');
