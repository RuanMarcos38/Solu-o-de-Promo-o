# Segredos do ambiente de produção

Este diretório contém somente arquivos locais e nunca deve armazenar valores reais no Git.

Arquivos esperados pelo `compose.production.yml`:

- `promotion_radar_metrics_token`
- `grafana_admin_password`
- `grafana_oauth_client_secret`
- `alertmanager_smtp_password`
- `alertmanager_telegram_bot_token`
- `alertmanager_primary_webhook_url`
- `alertmanager_secondary_webhook_url`
- `alertmanager_warning_webhook_url`

A aplicação também utiliza `.env.production.secrets`, na raiz do projeto, para as variáveis que precisam ser consumidas diretamente pelo Node.js, PostgreSQL e Redis.

Regras:

1. use valores diferentes por ambiente;
2. não use quebra de linha final nos arquivos montados como credencial;
3. mantenha o diretório com modo `700` e os arquivos com modo `644` no Docker Compose local, pois são bind mounts lidos por usuários não-root;
4. mantenha `.env.production.secrets` com modo `600`;
5. em Swarm, Kubernetes ou Vault, substitua os bind mounts pelo gerenciador de segredos nativo;
6. rotacione imediatamente qualquer valor exposto em logs, tickets ou commits.

O script `scripts/prepare-production.sh` cria a estrutura inicial sem versionar os valores.
