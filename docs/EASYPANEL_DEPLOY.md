# Deploy nativo no EasyPanel

Este guia publica o Radar de Ofertas no EasyPanel sem instalar Caddy dentro do projeto. O proxy, os domínios e os certificados Let's Encrypt ficam sob responsabilidade do próprio EasyPanel.

## Arquitetura

Crie um projeto chamado `promotion-radar` com estes serviços, usando exatamente esses nomes internos:

| Serviço | Tipo EasyPanel | Dockerfile/Imagem | Domínio | Proxy port |
|---|---|---|---|---|
| `postgres` | PostgreSQL | serviço gerenciado | nenhum | nenhum |
| `redis` | Redis | serviço gerenciado | nenhum | nenhum |
| `api` | App/GitHub | `Dockerfile` | `api-ofertas.r2rmarketingdigital.com.br` | `3333` |
| `worker` | App/GitHub | `Dockerfile.worker` | nenhum | nenhum |
| `web` | App/GitHub | `Dockerfile.web` | `ofertas.r2rmarketingdigital.com.br` | `80` |
| `alertmanager` | App/GitHub | `Dockerfile.alertmanager` | nenhum | nenhum |
| `prometheus` | App/GitHub | `Dockerfile.prometheus` | nenhum | nenhum |
| `grafana` | App/GitHub | `Dockerfile.grafana` | `grafana-ofertas.r2rmarketingdigital.com.br` | `3000` |

Os nomes são importantes porque a configuração interna usa `api`, `worker`, `prometheus` e `alertmanager` como hostnames privados.

## 1. DNS

No painel que administra `r2rmarketingdigital.com.br`, crie:

```text
ofertas          A  2.25.155.142
api-ofertas      A  2.25.155.142
grafana-ofertas  A  2.25.155.142
TTL: 300
```

Não altere os registros do domínio raiz, `www`, `crm` ou `n8n`.

## 2. Projeto e acesso ao GitHub

No EasyPanel:

1. Crie o projeto `promotion-radar`.
2. Em `Settings → GitHub`, conecte o repositório `RuanMarcos38/Solu-o-de-Promo-o`.
3. Use a branch `main`.
4. Para token fine-grained, conceda `Metadata: read`, `Contents: read` e `Webhooks: read/write` somente quando o auto deploy for usado.
5. Deixe o auto deploy desabilitado até a primeira homologação ser aprovada.

## 3. PostgreSQL

Crie um serviço PostgreSQL chamado `postgres`.

Configuração recomendada:

```text
Database: promo_db
User: promo
Password: gerar senha aleatória forte
Public port: desabilitado
```

Copie a URL interna exibida pelo EasyPanel. Ela será usada em `DATABASE_URL` na API e no worker.

Não exponha o PostgreSQL à internet.

### Backup

Configure um destino S3 compatível no EasyPanel e habilite backup diário do serviço `postgres`.

Sugestão de cron:

```text
30 2 * * *
```

Use retenção mínima de 14 dias e bucket separado do servidor.

## 4. Redis

Crie um serviço Redis chamado `redis`.

Configuração recomendada:

```text
Password: gerar senha aleatória forte
Public port: desabilitado
Persistência: habilitada
```

Copie a URL interna exibida pelo EasyPanel. Ela será usada em `REDIS_URL` na API e no worker.

Não exponha o Redis à internet.

## 5. API

Crie um App Service chamado `api`.

### Source

```text
Source: GitHub
Repository: RuanMarcos38/Solu-o-de-Promo-o
Branch: main
Build Path: /
Dockerfile: Dockerfile
```

As migrations do schema isolado são aplicadas pelo processo controlado de banco. O
container da API não executa migrations durante o boot e, por isso, não fica preso
antes de abrir a porta HTTP.

### Domain & Proxy

```text
Domain: api-ofertas.r2rmarketingdigital.com.br
Proxy port: 3333
HTTPS/Let's Encrypt: habilitado
```

### Healthcheck

```text
Path: /health
Expected status: 200
```

`/health` é o teste de vida do processo. Use `/ready` separadamente para confirmar
PostgreSQL; Redis pode aparecer como `degraded` sem bloquear login e consultas.

### Environment

Copie `deploy/easypanel/easypanel.env.example` para o campo Environment e substitua todos os valores `CHANGE_ME`.

Obrigatórios:

```text
NODE_ENV=production
DEPLOYMENT_ENVIRONMENT=homologation
API_HOST=0.0.0.0
API_PORT=3333
PUBLIC_API_URL=https://api-ofertas.r2rmarketingdigital.com.br
FRONTEND_ORIGINS=https://ofertas.r2rmarketingdigital.com.br
DATABASE_URL=<URL SESSION POOLER DO SUPABASE COM schema=zenite_ofertas>
REDIS_URL=<URL INTERNA DO REDIS>
JWT_SECRET=<64+ caracteres aleatórios>
CHANNEL_CONFIG_ENCRYPTION_KEY=<base64 de 32 bytes, opcional>
ADMIN_EMAIL=<e-mail real>
ADMIN_PASSWORD=<senha forte>
METRICS_BEARER_TOKEN=<token aleatório>
ALLOW_INSECURE_OUTBOUND_HTTP=false
```

Use somente uma réplica na primeira homologação.

## 6. Worker

Crie um App Service chamado `worker`.

```text
Source: GitHub
Repository: RuanMarcos38/Solu-o-de-Promo-o
Branch: main
Build Path: /
Dockerfile: Dockerfile.worker
Domain: nenhum
Replicas: 1
```

Cole exatamente o mesmo Environment da API.

O worker usa o mesmo schema já migrado pelo processo controlado de banco. Ele não
executa migrations durante o boot e deve ser implantado depois de a API responder em
`/ready`.

Não publique a porta `9464` externamente. Ela será usada apenas pelo Prometheus dentro do projeto.

## 7. Frontend

Crie um App Service chamado `web`.

```text
Source: GitHub
Repository: RuanMarcos38/Solu-o-de-Promo-o
Branch: main
Build Path: /
Dockerfile: Dockerfile.web
```

### Environment de build

```text
VITE_API_URL=https://api-ofertas.r2rmarketingdigital.com.br
```

### Domain & Proxy

```text
Domain: ofertas.r2rmarketingdigital.com.br
Proxy port: 80
HTTPS/Let's Encrypt: habilitado
```

### Healthcheck

```text
Path: /health
Expected status: 200
```

O Nginx está configurado com fallback SPA, cache de arquivos estáticos e cabeçalhos de segurança.

## 8. Alertmanager

Crie um App Service chamado `alertmanager`.

```text
Source: GitHub
Repository: RuanMarcos38/Solu-o-de-Promo-o
Branch: main
Build Path: /
Dockerfile: Dockerfile.alertmanager
Domain: nenhum
```

### Environment

```text
ALERTMANAGER_SMTP_SMARTHOST=smtp.exemplo.com:587
ALERTMANAGER_SMTP_FROM=alerts@seudominio.com.br
ALERTMANAGER_SMTP_USERNAME=alerts@seudominio.com.br
ALERTMANAGER_EMAIL_TO=responsavel@seudominio.com.br
ALERTMANAGER_TELEGRAM_CHAT_ID=<chat id numérico>
```

### File mounts obrigatórios

Crie arquivos protegidos no EasyPanel com estes caminhos dentro do container:

```text
/run/secrets/alertmanager_smtp_password
/run/secrets/alertmanager_telegram_bot_token
/run/secrets/alertmanager_primary_webhook_url
/run/secrets/alertmanager_secondary_webhook_url
/run/secrets/alertmanager_warning_webhook_url
```

Cada arquivo deve conter somente o valor, sem aspas e sem quebra de linha adicional.

O container valida as variáveis, os secrets e o arquivo gerado usando `amtool check-config` antes de iniciar.

## 9. Prometheus

Crie um App Service chamado `prometheus`.

```text
Source: GitHub
Repository: RuanMarcos38/Solu-o-de-Promo-o
Branch: main
Build Path: /
Dockerfile: Dockerfile.prometheus
Domain: nenhum
```

### Volume

```text
Name: prometheus-data
Mount path: /prometheus
```

### File mount obrigatório

Crie um arquivo com o mesmo valor usado em `METRICS_BEARER_TOKEN`:

```text
Container path: /run/secrets/promotion_radar_metrics_token
```

O Prometheus consulta:

```text
api:3333/metrics
worker:9464/metrics
```

E envia alertas para:

```text
alertmanager:9093
```

## 10. Grafana

Crie um App Service chamado `grafana`.

```text
Source: GitHub
Repository: RuanMarcos38/Solu-o-de-Promo-o
Branch: main
Build Path: /
Dockerfile: Dockerfile.grafana
```

### Domain & Proxy

```text
Domain: grafana-ofertas.r2rmarketingdigital.com.br
Proxy port: 3000
HTTPS/Let's Encrypt: habilitado
```

### Volume

```text
Name: grafana-data
Mount path: /var/lib/grafana
```

Os dashboards ficam em `/etc/grafana/dashboards`, portanto não são escondidos pelo volume persistente.

### Environment mínimo

```text
GF_SERVER_DOMAIN=grafana-ofertas.r2rmarketingdigital.com.br
GF_SERVER_ROOT_URL=https://grafana-ofertas.r2rmarketingdigital.com.br
GF_SECURITY_ADMIN_USER=admin
GF_SECURITY_ADMIN_PASSWORD=<senha forte>
GF_SECURITY_COOKIE_SECURE=true
GF_SECURITY_COOKIE_SAMESITE=strict
GF_USERS_ALLOW_SIGN_UP=false
GF_AUTH_ANONYMOUS_ENABLED=false
```

### SSO opcional

```text
GF_AUTH_GENERIC_OAUTH_ENABLED=true
GF_AUTH_GENERIC_OAUTH_NAME=SSO
GF_AUTH_GENERIC_OAUTH_CLIENT_ID=
GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET=
GF_AUTH_GENERIC_OAUTH_SCOPES=openid profile email groups
GF_AUTH_GENERIC_OAUTH_AUTH_URL=
GF_AUTH_GENERIC_OAUTH_TOKEN_URL=
GF_AUTH_GENERIC_OAUTH_API_URL=
GF_AUTH_GENERIC_OAUTH_ALLOWED_DOMAINS=r2rmarketingdigital.com.br
```

Callback:

```text
https://grafana-ofertas.r2rmarketingdigital.com.br/login/generic_oauth
```

Mantenha o login local ativo até validar o primeiro acesso SSO.

## 11. Ordem de deploy

Execute nessa ordem:

1. `postgres`;
2. `redis`;
3. `alertmanager`;
4. `api`;
5. `worker`;
6. `prometheus`;
7. `grafana`;
8. `web`.

A API e o worker executam migrations automaticamente.

## 12. Validação

### DNS

```powershell
Resolve-DnsName ofertas.r2rmarketingdigital.com.br -Type A
Resolve-DnsName api-ofertas.r2rmarketingdigital.com.br -Type A
Resolve-DnsName grafana-ofertas.r2rmarketingdigital.com.br -Type A
```

Os três precisam retornar `2.25.155.142`.

### API e frontend

```powershell
Invoke-WebRequest https://api-ofertas.r2rmarketingdigital.com.br/health
Invoke-WebRequest https://api-ofertas.r2rmarketingdigital.com.br/ready
Invoke-WebRequest https://ofertas.r2rmarketingdigital.com.br/health
```

### Grafana

```powershell
Invoke-WebRequest https://grafana-ofertas.r2rmarketingdigital.com.br/api/health
```

### Smoke test do repositório

```bash
cp deploy/homologation.env.example deploy/homologation.env
bash scripts/go-live-smoke.sh deploy/homologation.env
```

## 13. Critérios de aprovação

O ambiente continua em homologação até todos os itens abaixo estarem aprovados:

- DNS dos três subdomínios;
- certificados TLS confiáveis;
- API `/ready` retornando 200;
- frontend carregando e autenticando;
- worker processando filas;
- Prometheus com targets `UP`;
- Grafana com dashboards recebendo dados;
- alerta de teste entregue por e-mail, Telegram e webhook;
- backup PostgreSQL enviado para storage externo;
- restore testado;
- rollback testado;
- retorno à versão atual validado.

## 14. Segurança

- Não exponha PostgreSQL, Redis, Prometheus ou Alertmanager publicamente.
- Não coloque tokens, senhas ou chaves no GitHub.
- Use Environment Secrets/File mounts do EasyPanel.
- Ative auto deploy somente depois do primeiro go-live aprovado.
- Mantenha portas 80 e 443 sob controle exclusivo do EasyPanel.
- Não execute `compose.production.yml` dentro do EasyPanel, pois ele inclui Caddy e causaria conflito de proxy.
