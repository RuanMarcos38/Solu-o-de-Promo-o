# Deploy e DevOps — Produção

Este runbook descreve a implantação do Radar de Ofertas com Docker Compose, Caddy, TLS automático, imagens imutáveis, Grafana com SSO, backups e rollback.

## Arquitetura

O ambiente de produção utiliza:

- Caddy como único ponto público nas portas 80 e 443;
- frontend em `APP_DOMAIN`;
- API em `API_DOMAIN`;
- Grafana em `GRAFANA_DOMAIN`;
- PostgreSQL, Redis, Prometheus e Alertmanager em redes internas;
- imagens da API e frontend publicadas no GHCR por tag imutável;
- volumes persistentes para banco, filas, certificados e observabilidade.

PostgreSQL, Redis, API, worker, Prometheus e Alertmanager não publicam portas diretamente no host.

## Pré-requisitos do servidor

Recomendado:

- Ubuntu LTS ou distribuição Linux equivalente;
- Docker Engine e Docker Compose v2;
- Git, curl, OpenSSL e Bash;
- usuário dedicado `promotion-radar` pertencente ao grupo Docker;
- no mínimo 2 vCPU, 4 GB de RAM e armazenamento persistente monitorado;
- portas TCP 80 e 443 liberadas;
- porta UDP 443 liberada para HTTP/3, quando permitido;
- acesso ao GHCR para baixar imagens privadas, quando o pacote não for público.

Estrutura sugerida:

```bash
sudo useradd --system --create-home --shell /bin/bash promotion-radar
sudo usermod -aG docker promotion-radar
sudo mkdir -p /opt/promotion-radar
sudo chown promotion-radar:promotion-radar /opt/promotion-radar
```

## DNS

Crie registros A e, quando aplicável, AAAA:

```text
APP_DOMAIN      -> IP público do servidor
API_DOMAIN      -> IP público do servidor
GRAFANA_DOMAIN  -> IP público do servidor
```

Exemplo:

```text
ofertas.exemplo.com
api.ofertas.exemplo.com
grafana.ofertas.exemplo.com
```

O Caddy solicita e renova automaticamente os certificados após o DNS resolver para o servidor e as portas 80/443 estarem acessíveis.

## Clonar e preparar

```bash
cd /opt/promotion-radar
git clone https://github.com/RuanMarcos38/Solu-o-de-Promo-o.git .
git checkout main

bash scripts/prepare-production.sh ofertas.exemplo.com admin@exemplo.com
```

O preparo cria localmente:

- `.env.production`;
- `.env.production.secrets`;
- `deploy/secrets/*`;
- `ops/alertmanager/generated/alertmanager.yml`;
- diretórios de backup e estado de release.

Nenhum desses valores sensíveis deve ser commitado.

## Configurar o ambiente

Edite `.env.production` e confirme:

```dotenv
APP_DOMAIN=ofertas.exemplo.com
API_DOMAIN=api.ofertas.exemplo.com
GRAFANA_DOMAIN=grafana.ofertas.exemplo.com
TLS_EMAIL=admin@exemplo.com
IMAGE_NAMESPACE=ruanmarcos38
PUBLIC_API_URL=https://api.ofertas.exemplo.com
FRONTEND_ORIGINS=https://ofertas.exemplo.com
ADMIN_EMAIL=admin@exemplo.com
```

A URL utilizada na construção da imagem web precisa ser exatamente a URL pública da API.

## Configurar credenciais e destinos

Preencha `.env.production.secrets` para integrações utilizadas diretamente pela aplicação.

Preencha os arquivos em `deploy/secrets/` sem quebra de linha final:

```bash
printf '%s' 'senha-real' > deploy/secrets/grafana_admin_password
printf '%s' 'client-secret-oidc' > deploy/secrets/grafana_oauth_client_secret
printf '%s' 'senha-smtp' > deploy/secrets/alertmanager_smtp_password
printf '%s' 'token-telegram' > deploy/secrets/alertmanager_telegram_bot_token
printf '%s' 'https://hooks.exemplo.com/primary' > deploy/secrets/alertmanager_primary_webhook_url
printf '%s' 'https://hooks.exemplo.com/secondary' > deploy/secrets/alertmanager_secondary_webhook_url
printf '%s' 'https://hooks.exemplo.com/warning' > deploy/secrets/alertmanager_warning_webhook_url

chmod 700 deploy/secrets
chmod 644 deploy/secrets/*
chmod 600 .env.production .env.production.secrets
```

O diretório fica restrito ao proprietário. Os arquivos são legíveis pelos usuários não-root dos containers porque o Docker Compose local os monta como bind mounts somente leitura.

## SSO do Grafana

O Grafana usa OAuth/OIDC genérico e funciona com provedores como Keycloak, Auth0, Google Workspace e Microsoft Entra ID.

Configure no provedor a callback:

```text
https://GRAFANA_DOMAIN/login/generic_oauth
```

Exemplo de configuração:

```dotenv
GRAFANA_OAUTH_ENABLED=true
GRAFANA_OAUTH_NAME=SSO Corporativo
GRAFANA_OAUTH_CLIENT_ID=promotion-radar-grafana
GRAFANA_OAUTH_SCOPES=openid profile email groups
GRAFANA_OAUTH_AUTH_URL=https://id.exemplo.com/authorize
GRAFANA_OAUTH_TOKEN_URL=https://id.exemplo.com/oauth/token
GRAFANA_OAUTH_API_URL=https://id.exemplo.com/userinfo
GRAFANA_OAUTH_ALLOWED_DOMAINS=exemplo.com
GRAFANA_OAUTH_ROLE_ATTRIBUTE_PATH="contains(groups[*], 'grafana-admins') && 'Admin' || contains(groups[*], 'grafana-editors') && 'Editor' || 'Viewer'"
GRAFANA_DISABLE_LOGIN_FORM=false
```

Procedimento seguro:

1. mantenha o login local habilitado;
2. teste o SSO com uma conta Viewer;
3. valide o mapeamento de Editor e Admin;
4. preserve uma credencial administrativa de emergência;
5. somente depois considere `GRAFANA_DISABLE_LOGIN_FORM=true`.

Com `allow_sign_up` desabilitado, os usuários precisam existir no Grafana. Não habilite criação automática sem restringir domínio, grupos e papéis no provedor.

## Publicar uma release

O workflow `Release Images` publica:

```text
ghcr.io/ruanmarcos38/promotion-radar-api:<tag>
ghcr.io/ruanmarcos38/promotion-radar-web:<tag>
```

Ele inclui SBOM e proveniência OCI.

Opções:

1. criar uma tag Git `vX.Y.Z`; nesse caso configure a variável de repositório `PUBLIC_API_URL`;
2. executar manualmente o workflow informando `release_tag` e `public_api_url`.

Exemplo:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Não reutilize uma tag já implantada. O rollback depende de tags imutáveis.

## Login no GHCR

Quando as imagens forem privadas:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u RuanMarcos38 --password-stdin
```

O token precisa somente da permissão necessária para leitura de pacotes no servidor.

## Validar a configuração

```bash
npm run deploy:validate
bash -n scripts/*.sh
bash scripts/render-alertmanager.sh .env.production

docker compose \
  --env-file .env.production \
  -f compose.production.yml \
  config --quiet
```

## Primeiro deploy

```bash
bash scripts/deploy-production.sh v1.0.0
```

O script:

1. valida domínios, arquivos e destinos de plantão;
2. renderiza o Alertmanager;
3. cria backup quando já existe banco em execução;
4. baixa as imagens da release;
5. inicia PostgreSQL e Redis;
6. executa migrations;
7. atualiza API, worker, frontend e observabilidade;
8. inicia Caddy e solicita TLS;
9. valida aplicação, API e Grafana via HTTPS;
10. executa rollback automático quando os healthchecks falham e existe release anterior.

Depois do primeiro acesso, crie outro administrador, teste o login e altere:

```dotenv
BOOTSTRAP_ADMIN_ENABLED=false
```

Reimplante a mesma release somente para aplicar a configuração, sem recriar o administrador inicial.

## Firewall

Exponha somente:

```text
22/tcp   SSH restrito por IP ou VPN
80/tcp   desafio ACME e redirecionamento HTTPS
443/tcp  HTTPS
443/udp  HTTP/3 opcional
```

Não exponha 3333, 5432, 6379, 9090, 9093, 9464 ou 3000 diretamente.

## Backups

Backup manual:

```bash
bash scripts/backup-production.sh
```

O backup contém:

- dump custom do PostgreSQL;
- snapshot RDB do Redis;
- metadata da release;
- checksums SHA-256.

Configure:

```dotenv
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=14
BACKUP_ENCRYPTION_RECIPIENT=age1...
```

Quando `BACKUP_ENCRYPTION_RECIPIENT` estiver definido, o servidor precisa possuir `age` instalado. O diretório temporário é removido após a criação do arquivo criptografado.

Backups locais não são suficientes contra perda do servidor. Sincronize os arquivos criptografados para S3, Backblaze B2, Cloudflare R2 ou outro storage externo com política de retenção e versionamento.

## Agendamento com systemd

Ajuste usuário e diretório nos arquivos em `deploy/systemd/`, depois instale:

```bash
sudo cp deploy/systemd/promotion-radar-backup.service /etc/systemd/system/
sudo cp deploy/systemd/promotion-radar-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now promotion-radar-backup.timer
sudo systemctl list-timers promotion-radar-backup.timer
```

O timer executa diariamente por volta de 02:30, com atraso aleatório de até 20 minutos, e recupera execuções perdidas após reinicialização.

## Testar restauração

Teste restauração periodicamente em ambiente isolado. Um backup não testado não deve ser considerado recuperável.

Restauração controlada:

```bash
RESTORE_CONFIRM=RESTORE_PRODUCTION \
  bash scripts/restore-production.sh backups/20260714T020000Z
```

O script valida checksums, interrompe escrita, restaura PostgreSQL e Redis, executa migrations e aguarda healthchecks.

A restauração substitui os dados atuais. Faça snapshot do servidor e um backup adicional antes de executar em produção.

## Rollback

Rollback para a release anterior registrada:

```bash
bash scripts/rollback-production.sh
```

Rollback para uma tag específica:

```bash
bash scripts/rollback-production.sh v0.9.5
```

O rollback troca somente as imagens da API, worker e frontend. Ele não desfaz migrations.

Todas as alterações de banco precisam seguir expand/contract:

1. adicionar estrutura nova de forma compatível;
2. implantar código que aceite estrutura antiga e nova;
3. migrar dados;
4. remover estrutura antiga apenas em uma release posterior.

Migrations destrutivas impedem rollback seguro.

## Verificação pós-deploy

```bash
curl -fsS https://$APP_DOMAIN/
curl -fsS https://$API_DOMAIN/health
curl -fsS https://$API_DOMAIN/ready
curl -fsS https://$GRAFANA_DOMAIN/api/health

docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 caddy api worker
```

Confirme também:

- certificado válido e renovação automática;
- endpoint `/metrics` indisponível publicamente;
- Prometheus coletando API e worker;
- dashboards carregados;
- alerta sintético chegando ao plantão primário;
- escalonamento secundário;
- backup diário e cópia externa;
- recuperação de um backup em ambiente de teste.

## Atualização normal

```bash
git pull --ff-only
bash scripts/deploy-production.sh v1.1.0
```

Nunca execute `docker compose down -v` em produção, pois isso remove volumes persistentes.
