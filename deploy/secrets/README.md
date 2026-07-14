# Secrets locais de produção

Este diretório recebe arquivos reais somente na VPS. Eles são ignorados pelo Git e montados como somente leitura nos containers.

## Arquivos esperados

```text
promotion_radar_metrics_token
grafana_admin_password
grafana_oauth_client_secret
alertmanager_smtp_password
alertmanager_telegram_bot_token
alertmanager_primary_webhook_url
alertmanager_secondary_webhook_url
alertmanager_warning_webhook_url
```

A aplicação também usa `.env.production.secrets`, na raiz, para valores consumidos diretamente pela API, PostgreSQL e Redis.

## Geração e preenchimento

O comando `scripts/prepare-production.sh` gera localmente os valores internos de banco, Redis, JWT, criptografia, administração e métricas.

Os valores externos devem ser preenchidos diretamente na VPS:

```text
grafana_oauth_client_secret
alertmanager_smtp_password
alertmanager_telegram_bot_token
alertmanager_primary_webhook_url
alertmanager_secondary_webhook_url
alertmanager_warning_webhook_url
```

Grave sem quebra de linha final:

```bash
printf '%s' 'VALOR' > deploy/secrets/NOME_DO_ARQUIVO
```

## Permissões

```bash
chmod 700 deploy/secrets
chmod 600 .env.production .env.production.secrets
chmod 644 deploy/secrets/*
```

O diretório com modo `700` restringe a navegação no host. Os arquivos com modo `644` permitem leitura pelos usuários não-root dos containers através dos mounts definidos no Compose.

## Regras

1. Use valores diferentes em homologação e produção.
2. Não coloque quebra de linha final nos arquivos montados como credencial.
3. Não grave tokens do GHCR em `.env.production`.
4. Em Swarm, Kubernetes ou Vault, substitua os bind mounts pelo gerenciador nativo.
5. Rotacione imediatamente qualquer valor exposto em logs, tickets ou commits.
6. Nunca coloque valores reais neste README, em issues, pull requests, screenshots ou mensagens de chat.

O guia completo está em `docs/SECRETS_CONFIGURATION.md`.
