# Grafana, Prometheus e Alertmanager

Este guia ativa os dashboards, alertas visuais, canais de plantão e escalonamento automático do Radar de Ofertas.

## Componentes

O perfil Docker `observability` adiciona:

- Prometheus para coleta, recording rules e alertas de SLO;
- Alertmanager para agrupamento, deduplicação, silêncios e escalonamento;
- Grafana com datasource e dashboards provisionados automaticamente.

As portas são vinculadas a `127.0.0.1` por padrão:

- Grafana: `3000`;
- Prometheus: `9090`;
- Alertmanager: `9093`;
- métricas do worker: `9464`.

## 1. Preparar o Alertmanager

Copie o modelo validado para o arquivo local ignorado pelo Git:

```bash
mkdir -p ops/alertmanager/generated
cp ops/alertmanager/alertmanager.example.yml ops/alertmanager/generated/alertmanager.yml
```

Edite o arquivo gerado e substitua:

- `smtp.example.invalid:587` pelo servidor SMTP;
- `alerts@example.invalid` pelo remetente e usuário SMTP;
- `oncall@example.invalid` pelos destinatários;
- `chat_id: 1` pelo chat ou grupo do Telegram.

Não edite o arquivo `alertmanager.example.yml` com dados reais.

## 2. Criar os arquivos de segredo

Crie os arquivos descritos em `ops/observability/secrets/README.md`:

```bash
mkdir -p ops/observability/secrets
printf '%s' "$METRICS_BEARER_TOKEN" > ops/observability/secrets/promotion_radar_metrics_token
printf '%s' "$GRAFANA_ADMIN_PASSWORD" > ops/observability/secrets/grafana_admin_password
printf '%s' "$ALERTMANAGER_SMTP_PASSWORD" > ops/observability/secrets/alertmanager_smtp_password
printf '%s' "$ALERTMANAGER_TELEGRAM_BOT_TOKEN" > ops/observability/secrets/alertmanager_telegram_bot_token
printf '%s' "$ALERTMANAGER_PRIMARY_WEBHOOK_URL" > ops/observability/secrets/alertmanager_primary_webhook_url
printf '%s' "$ALERTMANAGER_SECONDARY_WEBHOOK_URL" > ops/observability/secrets/alertmanager_secondary_webhook_url
printf '%s' "$ALERTMANAGER_WARNING_WEBHOOK_URL" > ops/observability/secrets/alertmanager_warning_webhook_url
chmod 700 ops/observability/secrets
chmod 644 ops/observability/secrets/*
chmod 644 ops/alertmanager/generated/alertmanager.yml
```

Os valores sensíveis são montados pelos recursos `secrets:` do Docker Compose. Como secrets com origem em arquivo usam bind mount no Compose local, o diretório fica restrito ao proprietário e os arquivos ficam legíveis pelos usuários não-root dos containers, sempre montados somente para leitura.

Os arquivos de segredo não devem possuir quebra de linha final. O valor de `promotion_radar_metrics_token` deve ser igual ao `METRICS_BEARER_TOKEN` da API e ter pelo menos 24 caracteres.

Os webhooks podem apontar para n8n, PagerDuty, Opsgenie, Slack, Microsoft Teams ou outro serviço que aceite o payload padrão do Alertmanager. Em produção, use HTTPS.

## 3. Validar antes de iniciar

```bash
npm run observability:validate

docker run --rm \
  -v "$PWD/ops/prometheus:/etc/prometheus:ro" \
  -v "$PWD/ops/observability/secrets:/run/secrets:ro" \
  --entrypoint /bin/promtool \
  prom/prometheus:v3.13.1 \
  check config /etc/prometheus/prometheus.example.yml

docker run --rm \
  -v "$PWD/ops/alertmanager:/etc/alertmanager:ro" \
  -v "$PWD/ops/observability/secrets:/run/secrets:ro" \
  --entrypoint /bin/amtool \
  prom/alertmanager:v0.33.1 \
  check-config /etc/alertmanager/generated/alertmanager.yml

docker compose --profile observability config > /dev/null
```

## 4. Iniciar o stack

```bash
npm run observability:up
```

Acesse:

- Grafana: `http://localhost:3000`;
- Prometheus: `http://localhost:9090`;
- Alertmanager: `http://localhost:9093`.

O usuário padrão do Grafana é definido por `GRAFANA_ADMIN_USER`. A senha vem do arquivo `grafana_admin_password`.

## Dashboards provisionados

### Radar de Ofertas — Visão Operacional

Apresenta:

- disponibilidade da API;
- sucesso da distribuição;
- saúde dos alertas;
- itens na DLQ;
- profundidade das filas;
- latência p95;
- alertas ativos.

### Radar de Ofertas — SLO & Incidentes

Apresenta:

- burn rate de 5 minutos e 1 hora;
- disponibilidade por janela;
- sucesso por canal;
- alertas críticos;
- DLQ;
- linha do tempo dos incidentes.

Os arquivos estão em `ops/grafana/dashboards/` e são carregados sem edição manual.

## Árvore de escalonamento

### Incidentes críticos

1. após 10 segundos, notificam o plantão primário por webhook e Telegram;
2. se continuarem ativos por 15 minutos, notificam o plantão secundário;
3. repetem no primário a cada 30 minutos;
4. repetem no secundário a cada 1 hora;
5. enviam notificação de recuperação quando resolvidos.

### Alertas de aviso

- aguardam 5 minutos para reduzir ruído de flapping;
- são enviados ao canal operacional de warning;
- repetem a cada 4 horas enquanto permanecerem ativos.

### Dead-letter queue

- começa a notificar após 30 segundos;
- direciona ao responsável operacional;
- repete a cada 1 hora até a DLQ voltar ao normal.

Alertas `warning` são inibidos quando existe um incidente `critical` equivalente para o mesmo serviço, SLO, canal ou fila.

## Testar o escalonamento

Um alerta sintético pode ser criado pela API do Alertmanager:

```bash
curl -X POST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "PromotionRadarSyntheticCritical",
      "service": "promotion-radar",
      "severity": "critical",
      "slo": "synthetic-test"
    },
    "annotations": {
      "summary": "Teste controlado do plantão",
      "description": "Alerta sintético para validar agrupamento e escalonamento.",
      "runbook": "docs/GRAFANA_ALERTMANAGER.md"
    },
    "startsAt": "2026-07-14T18:00:00Z"
  }]'
```

Remova o alerta enviando novamente o mesmo conjunto de labels com `endsAt` no passado ou criando um silêncio no Alertmanager.

## Silêncios e manutenção

Antes de uma manutenção programada:

1. abra a interface do Alertmanager;
2. crie um silêncio com os matchers necessários;
3. defina início, término, responsável e motivo;
4. confirme no dashboard que não existem incidentes inesperados fora do escopo silenciado.

Nunca silencie globalmente todos os alertas por tempo indeterminado.

## Segurança em produção

- mantenha Grafana, Prometheus e Alertmanager atrás de proxy reverso com TLS;
- não exponha diretamente as portas administrativas à internet;
- habilite SSO/OAuth no Grafana quando disponível;
- use senhas e tokens exclusivos por ambiente;
- restrinja webhooks por allowlist no provedor de destino;
- faça backup dos volumes `grafana_data`, `prometheus_data` e `alertmanager_data`;
- substitua tags por digests imutáveis após homologação;
- use duas instâncias de Alertmanager e Prometheus para alta disponibilidade quando o ambiente exigir.

## Encerramento

```bash
npm run observability:down
```

Os volumes persistentes permanecem. Para removê-los, use explicitamente `docker compose --profile observability down -v` somente quando a perda do histórico for intencional.
