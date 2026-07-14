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

Cada arquivo deve conter somente o valor, sem quebra de linha final. Exemplo:

```bash
printf '%s' "$METRICS_BEARER_TOKEN" > ops/observability/secrets/promotion_radar_metrics_token
chmod 600 ops/observability/secrets/*
```

Evite `echo` ou `printf '%s\n'`: a quebra de linha pode fazer parte da credencial lida pelo Prometheus, Grafana ou Alertmanager.

Nunca faça commit desses arquivos. Os webhooks de produção devem utilizar HTTPS.
