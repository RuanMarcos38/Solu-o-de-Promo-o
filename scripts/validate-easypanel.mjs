import { readFileSync } from 'node:fs';

const requiredFiles = [
  'Dockerfile',
  'Dockerfile.worker',
  'Dockerfile.web',
  'Dockerfile.prometheus',
  'Dockerfile.grafana',
  'Dockerfile.alertmanager',
  'deploy/easypanel/nginx.conf',
  'deploy/easypanel/easypanel.env.example',
  'deploy/easypanel/alertmanager.yml.tmpl',
  'deploy/easypanel/alertmanager-entrypoint.sh',
  'docs/EASYPANEL_DEPLOY.md'
];

for (const file of requiredFiles) {
  readFileSync(file, 'utf8');
}

const apiDockerfile = readFileSync('Dockerfile', 'utf8');
const workerDockerfile = readFileSync('Dockerfile.worker', 'utf8');
const webDockerfile = readFileSync('Dockerfile.web', 'utf8');
const prometheusDockerfile = readFileSync('Dockerfile.prometheus', 'utf8');
const grafanaDockerfile = readFileSync('Dockerfile.grafana', 'utf8');
const alertmanagerDockerfile = readFileSync('Dockerfile.alertmanager', 'utf8');
const alertmanagerEntrypoint = readFileSync('deploy/easypanel/alertmanager-entrypoint.sh', 'utf8');
const nginx = readFileSync('deploy/easypanel/nginx.conf', 'utf8');
const envTemplate = readFileSync('deploy/easypanel/easypanel.env.example', 'utf8');

const assertIncludes = (content, value, file) => {
  if (!content.includes(value)) throw new Error(`${file} precisa conter: ${value}`);
};

const assertExcludes = (content, value, file) => {
  if (content.includes(value)) throw new Error(`${file} não pode conter: ${value}`);
};

assertExcludes(apiDockerfile, 'npm run prisma:deploy -w apps/api', 'Dockerfile');
assertIncludes(apiDockerfile, 'CMD ["npm", "run", "start", "-w", "apps/api"]', 'Dockerfile');
assertIncludes(apiDockerfile, "'/health'", 'Dockerfile');
assertIncludes(apiDockerfile, 'USER node', 'Dockerfile');
assertExcludes(workerDockerfile, 'npm run prisma:deploy -w apps/api', 'Dockerfile.worker');
assertIncludes(workerDockerfile, 'CMD ["npm", "run", "start:worker", "-w", "apps/api"]', 'Dockerfile.worker');
assertIncludes(webDockerfile, 'VITE_API_URL=https://api-ofertas.r2rmarketingdigital.com.br', 'Dockerfile.web');
assertIncludes(prometheusDockerfile, 'ops/prometheus/prometheus.example.yml', 'Dockerfile.prometheus');
assertIncludes(grafanaDockerfile, 'ops/grafana/provisioning', 'Dockerfile.grafana');
assertIncludes(alertmanagerDockerfile, 'alertmanager-entrypoint', 'Dockerfile.alertmanager');
assertIncludes(alertmanagerEntrypoint, 'amtool check-config', 'deploy/easypanel/alertmanager-entrypoint.sh');
assertIncludes(nginx, 'try_files $uri $uri/ /index.html;', 'deploy/easypanel/nginx.conf');
assertIncludes(nginx, 'location = /health', 'deploy/easypanel/nginx.conf');

for (const value of [
  'API_HOST=0.0.0.0',
  'PUBLIC_API_URL=https://api-ofertas.r2rmarketingdigital.com.br',
  'FRONTEND_ORIGINS=https://ofertas.r2rmarketingdigital.com.br',
  'schema=zenite_ofertas',
  'OPERATIONAL_ALERT_DASHBOARD_URL=https://grafana-ofertas.r2rmarketingdigital.com.br',
  'ALLOW_INSECURE_OUTBOUND_HTTP=false',
  'BOOTSTRAP_ADMIN_ENABLED=false'
]) {
  assertIncludes(envTemplate, value, 'deploy/easypanel/easypanel.env.example');
}

if (/CADDY|80:80|443:443/.test(envTemplate)) {
  throw new Error('O pacote EasyPanel não deve configurar Caddy ou publicar 80/443 diretamente.');
}

console.log('Pacote EasyPanel validado.');
