# Observabilidade, métricas e SLOs

## Objetivo

Esta camada permite acompanhar a disponibilidade da API, saúde das filas BullMQ, taxa de sucesso da distribuição, funcionamento dos alertas operacionais e consumo do orçamento de erro.

A implementação combina:

- Prometheus para métricas e alertas;
- OpenTelemetry para traces OTLP;
- PostgreSQL para indicadores persistentes de distribuição;
- Redis/BullMQ para profundidade, falhas e latência das filas;
- endpoints administrativos para diagnóstico sem acesso direto à infraestrutura.

## Endpoints

### Métricas da API

```http
GET /metrics
Authorization: Bearer <METRICS_BEARER_TOKEN>
```

Quando `METRICS_BEARER_TOKEN` não está definido fora de produção, um JWT administrativo também pode acessar o endpoint.

Em produção, métricas habilitadas exigem um token com pelo menos 24 caracteres.

### Métricas do worker

```text
http://worker:9464/metrics
```

O worker utiliza o mesmo `METRICS_BEARER_TOKEN` e expõe também:

```text
GET /health
```

A porta é publicada apenas em `127.0.0.1` por padrão no Docker Compose.

### Estado sanitizado

```http
GET /admin/observability/status
Authorization: Bearer <JWT_ADMIN>
```

Retorna somente:

- recursos habilitados;
- caminho e porta das métricas;
- presença do exportador OTLP;
- objetivos configurados;
- método de autenticação.

Tokens, endpoints privados e headers não são retornados.

### Snapshot dos SLOs

```http
GET /admin/observability/slo
Authorization: Bearer <JWT_ADMIN>
```

O snapshot contém:

- estado geral: `meeting`, `breached` ou `no_data`;
- disponibilidade HTTP desde o início do processo da API;
- sucesso persistente da distribuição na janela configurada;
- saúde dos alertas operacionais por canal;
- p95 de espera das filas;
- burn rate e orçamento de erro restante;
- quantidade mínima de amostras usada para tomar decisão.

## Métricas principais

### HTTP

```text
promotion_radar_http_requests_total
promotion_radar_http_request_duration_seconds
```

Labels permitidas:

- `method`;
- `route` normalizada;
- `status_class`.

IDs de usuário, oferta, canal ou request não são labels.

### BullMQ

```text
promotion_radar_queue_jobs_total
promotion_radar_queue_job_duration_seconds
promotion_radar_queue_waiting_duration_seconds
promotion_radar_queue_depth
promotion_radar_dispatch_dlq_items
```

Filas monitoradas:

- `collect-offers`;
- `dispatch-offers`;
- `dispatch-dead-letter`;
- `operational-alerts`.

### Distribuição

```text
promotion_radar_dispatch_attempts_total
```

Labels:

- `channel`: tipo normalizado do canal;
- `result`: `success` ou `failure`.

### Alertas operacionais

```text
promotion_radar_operational_alert_deliveries_total
```

Labels:

- `channel`;
- `kind`;
- `result`.

### Processo Node.js

Quando `METRICS_COLLECT_DEFAULTS=true`, são exportadas métricas de memória, CPU, event loop e garbage collector com prefixo `promotion_radar_`.

## OpenTelemetry

Ativação:

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=promotion-radar
OTEL_SERVICE_VERSION=0.1.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SAMPLING_RATIO=0.10
DEPLOYMENT_ENVIRONMENT=production
```

São criados spans manuais para:

- requisições HTTP;
- coleta de ofertas;
- jobs de distribuição;
- processamento de alertas operacionais.

Atributos de jobs incluem fila, operação, tentativa e tempo de espera. O ID do job pode aparecer no trace para diagnóstico, mas nunca é usado como label Prometheus.

O SDK é encerrado no graceful shutdown para descarregar spans pendentes.

## Objetivos padrão

| SLO | Objetivo | Fonte |
|---|---:|---|
| Disponibilidade da API | 99,9% | requests HTTP sem resposta 5xx |
| Sucesso da distribuição | 98% | `DispatchLog` SENT versus FAILED |
| Saúde dos alertas operacionais | 99% | jobs de entrega concluídos versus falhos |
| Latência das filas | p95 <= 30 s | início do processamento menos criação do job |

A janela persistente padrão é de 30 dias. O endpoint da API usa os dados HTTP desde o último início do processo, porque requests não são gravados no PostgreSQL.

Para histórico de disponibilidade entre reinícios, utilize Prometheus de longa retenção ou uma solução compatível, como Thanos, Mimir ou VictoriaMetrics.

## Orçamento de erro

Para um SLO de 99,9%, o erro permitido é 0,1%.

```text
burn_rate = taxa_de_erro_observada / taxa_de_erro_permitida
```

Interpretação:

- `burn_rate < 1`: orçamento sendo consumido dentro do planejado;
- `burn_rate = 1`: consumo exatamente no limite;
- `burn_rate > 1`: o orçamento acabará antes do fim da janela;
- `burn_rate > 14,4`: incidente de consumo rápido.

## Prometheus

Arquivos fornecidos:

```text
ops/prometheus/prometheus.example.yml
ops/prometheus/rules/promotion-radar-slo.yml
```

O token deve ser montado em:

```text
/run/secrets/promotion_radar_metrics_token
```

O conteúdo precisa ser exatamente o mesmo de `METRICS_BEARER_TOKEN`.

Validação das regras:

```bash
promtool check rules ops/prometheus/rules/promotion-radar-slo.yml
promtool check config ops/prometheus/prometheus.example.yml
```

## Regras de alerta

### API availability fast burn

Alerta quando o burn rate ultrapassa 14,4x simultaneamente nas janelas de 5 minutos e 1 hora.

Ações:

1. verificar `/ready`;
2. inspecionar taxa de 5xx por rota;
3. conferir PostgreSQL e Redis;
4. consultar traces OTLP com status de erro;
5. verificar deploys recentes;
6. considerar rollback quando a regressão estiver confirmada.

### Dispatch success below SLO

Alerta quando um tipo de canal permanece abaixo de 98% por 15 minutos.

Ações:

1. identificar o canal afetado;
2. verificar credenciais e validade do endpoint;
3. consultar `DispatchLog` e DLQ;
4. verificar timeout, DNS, rate limit e resposta do provedor;
5. corrigir a configuração antes de reprocessar itens.

### Operational alert health below SLO

Alerta quando Telegram, e-mail ou webhook operacional fica abaixo de 99%.

Ações:

1. verificar a fila `operational-alerts`;
2. validar o canal alternativo;
3. testar `POST /admin/operational-alerts/test`;
4. conferir SMTP, Telegram Bot API ou webhook;
5. não depender de um único canal para incidentes críticos.

### Queue latency high

Alerta quando o p95 de espera ultrapassa 30 segundos por 10 minutos.

Ações:

1. verificar jobs `waiting`, `active` e `delayed`;
2. comparar concorrência com taxa de entrada;
3. identificar provedor externo lento;
4. verificar CPU, memória e event loop;
5. escalar workers somente após confirmar que PostgreSQL e Redis suportam o aumento.

### DLQ not empty

Alerta quando existem itens na DLQ por mais de 5 minutos.

Use o painel administrativo e o procedimento descrito em `docs/DLQ_OPERATIONS_PANEL.md`.

## Segurança e cardinalidade

- `/metrics` nunca é público por padrão em produção;
- o worker não expõe a porta em interfaces externas por padrão;
- tokens e URLs privadas não aparecem nos endpoints administrativos;
- títulos de ofertas, e-mails, números de telefone e IDs não são labels;
- nomes de rota são normalizados;
- labels são limitadas a 80 caracteres;
- o webhook e os demais provedores continuam protegidos pelo controle SSRF existente.

## Checklist de produção

- definir `METRICS_BEARER_TOKEN` forte;
- manter portas de métricas em rede privada;
- configurar Prometheus para API e worker;
- carregar as regras de SLO;
- configurar Alertmanager;
- ativar OTLP apenas depois do Collector estar disponível;
- escolher uma taxa de amostragem compatível com o volume;
- criar dashboards de disponibilidade, distribuição, filas e alertas;
- testar a perda de cada dependência em ambiente controlado;
- revisar objetivos e orçamento de erro mensalmente.
