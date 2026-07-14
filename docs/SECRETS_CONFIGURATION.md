# Configuração segura de secrets

## Política adotada

Os segredos de execução da aplicação ficam somente na VPS, em arquivos ignorados pelo Git. O GitHub Actions armazena apenas as credenciais necessárias para acessar a VPS e executar o deploy.

Essa separação evita duplicar SMTP, Telegram, webhooks, banco, JWT, criptografia e OIDC em dois locais.

## 1. Arquivos protegidos na VPS

No diretório `/opt/promotion-radar`, execute primeiro:

```bash
bash scripts/prepare-production.sh ofertas.r2rmarketingdigital.com.br SEU_EMAIL_TLS
```

Como a homologação usa subdomínios independentes, revise depois `.env.production` para manter:

```text
APP_DOMAIN=ofertas.r2rmarketingdigital.com.br
API_DOMAIN=api-ofertas.r2rmarketingdigital.com.br
GRAFANA_DOMAIN=grafana-ofertas.r2rmarketingdigital.com.br
PUBLIC_API_URL=https://api-ofertas.r2rmarketingdigital.com.br
FRONTEND_ORIGINS=https://ofertas.r2rmarketingdigital.com.br
```

O script gera automaticamente valores aleatórios para:

- PostgreSQL;
- Redis;
- JWT;
- AES-256-GCM;
- senha administrativa inicial;
- token de métricas;
- senha administrativa do Grafana;
- assinatura dos webhooks internos.

Preencha manualmente, diretamente na VPS, sem colar valores no GitHub ou no chat:

### `.env.production.secrets`

```text
OPERATIONAL_ALERT_TELEGRAM_BOT_TOKEN=
OPERATIONAL_ALERT_WEBHOOK_URL=
SMTP_PASS=
```

### `.env.production`

```text
TLS_EMAIL=
ADMIN_EMAIL=admin@r2rmarketingdigital.com.br
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=
OPERATIONAL_ALERT_EMAIL_FROM=
OPERATIONAL_ALERT_EMAIL_TO=
OPERATIONAL_ALERT_TELEGRAM_CHAT_ID=
ALERTMANAGER_SMTP_SMARTHOST=
ALERTMANAGER_SMTP_FROM=
ALERTMANAGER_SMTP_USERNAME=
ALERTMANAGER_EMAIL_TO=
ALERTMANAGER_TELEGRAM_CHAT_ID=
```

### `deploy/secrets/`

```text
grafana_oauth_client_secret
alertmanager_smtp_password
alertmanager_telegram_bot_token
alertmanager_primary_webhook_url
alertmanager_secondary_webhook_url
alertmanager_warning_webhook_url
```

Grave os arquivos sem quebra de linha final:

```bash
printf '%s' 'VALOR' > deploy/secrets/NOME_DO_ARQUIVO
```

Permissões:

```bash
chmod 700 deploy/secrets
chmod 600 .env.production .env.production.secrets
chmod 644 deploy/secrets/*
```

O diretório `deploy/secrets` é protegido e os arquivos são montados como somente leitura nos containers.

## 2. Login da VPS no GHCR

Crie um token GitHub com permissão mínima `read:packages` e execute somente na VPS:

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u RuanMarcos38 --password-stdin
unset GHCR_TOKEN
```

O token é armazenado pelo Docker no contexto do usuário da VPS. Não coloque esse token em `.env.production`.

## 3. GitHub Environment `homologation`

No repositório, abra:

```text
Settings → Environments → New environment → homologation
```

Adicione os secrets:

```text
VPS_SSH_HOST
VPS_SSH_USER
VPS_SSH_PORT
VPS_SSH_PRIVATE_KEY
VPS_SSH_KNOWN_HOSTS
```

Valores esperados:

```text
VPS_SSH_HOST=2.25.155.142
VPS_SSH_USER=root
VPS_SSH_PORT=22
```

A chave privada deve corresponder a uma chave pública autorizada em:

```text
/root/.ssh/authorized_keys
```

Gere o conteúdo confiável de `VPS_SSH_KNOWN_HOSTS` a partir de uma sessão já verificada, não por um `ssh-keyscan` cego dentro do workflow.

Adicione também as variables do ambiente:

```text
REMOTE_APP_DIR=/opt/promotion-radar
APP_DOMAIN=ofertas.r2rmarketingdigital.com.br
API_DOMAIN=api-ofertas.r2rmarketingdigital.com.br
GRAFANA_DOMAIN=grafana-ofertas.r2rmarketingdigital.com.br
```

## 4. Proteção do ambiente

Recomendações para o ambiente `homologation`:

- exigir aprovação manual antes do deploy;
- limitar o ambiente à branch `main`;
- impedir administradores de ignorarem a aprovação, quando a política permitir;
- não usar secrets do ambiente em pull requests externos;
- rotacionar a chave SSH após qualquer suspeita de exposição.

## 5. Deploy pelo GitHub Actions

Depois que o PR #14 estiver mesclado e as imagens estiverem publicadas:

```text
Actions → Deploy Homologation → Run workflow
```

Informe uma release no formato:

```text
v0.1.0-rc.1
```

O workflow usa somente os secrets SSH do ambiente, executa o deploy na VPS e realiza o smoke test público.

## 6. SSO do Grafana

O client secret deve existir somente em:

```text
deploy/secrets/grafana_oauth_client_secret
```

Configure os dados públicos em `.env.production`:

```text
GRAFANA_OAUTH_ENABLED=true
GRAFANA_OAUTH_CLIENT_ID=
GRAFANA_OAUTH_AUTH_URL=
GRAFANA_OAUTH_TOKEN_URL=
GRAFANA_OAUTH_API_URL=
GRAFANA_OAUTH_ALLOWED_DOMAINS=r2rmarketingdigital.com.br
```

Callback:

```text
https://grafana-ofertas.r2rmarketingdigital.com.br/login/generic_oauth
```

## 7. Verificação antes do deploy

Na VPS:

```bash
node scripts/validate-deploy.mjs
bash scripts/render-alertmanager.sh .env.production
docker compose --env-file .env.production -f compose.production.yml config --quiet
```

No operador:

```bash
npm run go-live:preflight
```

Nenhum secret real deve aparecer em commits, issues, logs, screenshots ou mensagens de chat.
