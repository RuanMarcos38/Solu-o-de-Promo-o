# Segredos locais da observabilidade

Este diretório deve conter somente arquivos locais não versionados.

Arquivos esperados:

- `promotion_radar_metrics_token`
- `grafana_admin_password`
- `alertmanager_smtp_password`
- `alertmanager_telegram_bot_token`
- `alertmanager_primary_webhook_url`
- `alertmanager_secondary_webhook_url`
- `alertmanager_warning_webhook_url`

Cada arquivo deve conter apenas o valor, seguido opcionalmente de uma quebra de linha. Use permissões restritas:

```bash
chmod 600 ops/observability/secrets/*
```

Nunca faça commit desses arquivos. Os webhooks de produção devem utilizar HTTPS.
