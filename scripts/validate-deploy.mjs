import { readFileSync, existsSync } from 'node:fs';

const requiredFiles = [
  '.env.production.example',
  'compose.production.yml',
  'deploy/caddy/Caddyfile',
  'deploy/secrets/README.md',
  'scripts/lib/env-file.sh',
  'scripts/prepare-production.sh',
  'scripts/render-alertmanager.sh',
  'scripts/deploy-production.sh',
  'scripts/rollback-production.sh',
  'scripts/backup-production.sh',
  'scripts/restore-production.sh',
  '.github/workflows/release-images.yml'
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Arquivo obrigatório ausente: ${file}`);
}

const read = (file) => readFileSync(file, 'utf8');
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

if (existsSync('compose.production.yml')) {
  const compose = read('compose.production.yml');
  for (const service of ['postgres:', 'redis:', 'api:', 'worker:', 'web:', 'prometheus:', 'alertmanager:', 'grafana:', 'caddy:']) {
    expect(compose.includes(service), `Serviço ausente no Compose de produção: ${service}`);
  }
  expect(/backend:\r?\n\s+internal:\s+true/.test(compose), 'A rede backend precisa ser interna.');
  expect(/observability:\r?\n\s+internal:\s+true/.test(compose), 'A rede observability precisa ser interna.');
  expect(compose.includes('"80:80"') && compose.includes('"443:443"'), 'Caddy precisa publicar 80 e 443.');
  expect(!compose.includes('3333:3333'), 'A API não pode publicar a porta 3333 em produção.');
  expect(!compose.includes('5432:5432'), 'PostgreSQL não pode publicar a porta 5432 em produção.');
  expect(!compose.includes('6379:6379'), 'Redis não pode publicar a porta 6379 em produção.');
  expect(compose.includes('GF_AUTH_GENERIC_OAUTH_ENABLED'), 'Configuração OIDC do Grafana ausente.');
  expect(compose.includes('grafana_oauth_client_secret'), 'Secret do cliente OIDC do Grafana ausente.');
}

if (existsSync('deploy/caddy/Caddyfile')) {
  const caddy = read('deploy/caddy/Caddyfile');
  expect(caddy.includes('{$APP_DOMAIN}'), 'Virtual host da aplicação ausente no Caddyfile.');
  expect(caddy.includes('{$API_DOMAIN}'), 'Virtual host da API ausente no Caddyfile.');
  expect(caddy.includes('{$GRAFANA_DOMAIN}'), 'Virtual host do Grafana ausente no Caddyfile.');
  expect(caddy.includes('Strict-Transport-Security'), 'HSTS ausente no Caddyfile.');
  expect(caddy.includes('respond @metrics 404'), 'Endpoint público de métricas precisa ser bloqueado.');
  expect(!caddy.includes('auto_https disable_redirects'), 'Redirecionamento automático para HTTPS não pode estar desabilitado.');
}

if (existsSync('.env.production.example')) {
  const env = read('.env.production.example');
  for (const key of [
    'APP_DOMAIN=',
    'API_DOMAIN=',
    'GRAFANA_DOMAIN=',
    'TLS_EMAIL=',
    'IMAGE_REGISTRY=',
    'IMAGE_NAMESPACE=',
    'RELEASE_TAG=',
    'GRAFANA_OAUTH_ENABLED=',
    'BACKUP_RETENTION_DAYS='
  ]) {
    expect(env.includes(key), `Variável ausente em .env.production.example: ${key}`);
  }
  expect(!/JWT_SECRET=\S+/.test(env), 'JWT_SECRET não pode possuir valor no template público.');
  expect(!/GRAFANA_ADMIN_PASSWORD=\S+/.test(env), 'Senha do Grafana não pode possuir valor no template público.');
}

for (const script of requiredFiles.filter((file) => file.endsWith('.sh'))) {
  if (!existsSync(script)) continue;
  const content = read(script);
  expect(content.startsWith('#!/usr/bin/env bash'), `${script} precisa usar bash explicitamente.`);
  expect(!content.includes('source "$ENV_FILE"'), `${script} não pode executar o arquivo .env diretamente.`);
}

if (existsSync('.github/workflows/release-images.yml')) {
  const workflow = read('.github/workflows/release-images.yml');
  expect(workflow.includes('packages: write'), 'Workflow de release precisa de permissão packages: write.');
  expect(workflow.includes('provenance: mode=max'), 'Imagens precisam publicar proveniência.');
  expect(workflow.includes('sbom: true'), 'Imagens precisam publicar SBOM.');
  expect(workflow.includes('PUBLIC_API_URL precisa usar HTTPS'), 'Workflow precisa rejeitar API sem HTTPS.');
}

if (failures.length > 0) {
  console.error('Falhas na validação de deploy:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Deploy validado: ${requiredFiles.length} arquivos essenciais e controles de produção.`);
