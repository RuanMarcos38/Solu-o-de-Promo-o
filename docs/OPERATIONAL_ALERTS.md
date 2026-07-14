# Alertas Operacionais da DLQ

## Objetivo

Os alertas operacionais avisam administradores quando uma entrega entra na dead-letter queue, quando a quantidade de itens ultrapassa um limite crítico e quando a fila retorna ao nível normal.

A notificação não acontece dentro do processamento principal da oferta. Cada mensagem é criada na fila BullMQ `operational-alerts`, com retry e backoff próprios. Uma indisponibilidade do Telegram, SMTP ou webhook não impede a gravação do item na DLQ.

## Eventos

### `dlq-item`

Gerado uma única vez por item da DLQ e por canal configurado.

Contém:

- ID do job da DLQ;
- job original;
- oferta e canal internos;
- quantidade de tentativas;
- motivo final da falha.

### `dlq-threshold`

Gerado quando a DLQ atinge ou ultrapassa `OPERATIONAL_ALERT_DLQ_THRESHOLD`.

A primeira notificação marca a entrada do incidente. Enquanto a fila continuar crítica, lembretes só podem ser emitidos após o período definido em `OPERATIONAL_ALERT_COOLDOWN_SECONDS`.

### `dlq-recovery`

Gerado quando a fila estava crítica e volta a ficar abaixo do limite. Pode ser desativado com `OPERATIONAL_ALERT_RECOVERY_ENABLED=false`.

### `test`

Gerado manualmente por um administrador para validar os canais configurados.

## Configuração

```env
OPERATIONAL_ALERTS_ENABLED=true
OPERATIONAL_ALERT_CHANNELS=telegram,email,webhook
OPERATIONAL_ALERT_DLQ_THRESHOLD=5
OPERATIONAL_ALERT_CHECK_INTERVAL_SECONDS=60
OPERATIONAL_ALERT_COOLDOWN_SECONDS=900
OPERATIONAL_ALERT_RECOVERY_ENABLED=true
OPERATIONAL_ALERT_ATTEMPTS=5
OPERATIONAL_ALERT_BACKOFF_MS=30000
OPERATIONAL_ALERT_CONCURRENCY=3
OPERATIONAL_ALERT_DASHBOARD_URL=https://painel.exemplo.com
```

Use apenas os canais efetivamente configurados em `OPERATIONAL_ALERT_CHANNELS`.

## Telegram

```env
OPERATIONAL_ALERT_TELEGRAM_BOT_TOKEN=
OPERATIONAL_ALERT_TELEGRAM_CHAT_ID=
```

O token não é retornado por nenhum endpoint administrativo.

## Webhook

```env
OPERATIONAL_ALERT_WEBHOOK_URL=https://automacao.exemplo.com/webhooks/radar
OPERATIONAL_ALERT_WEBHOOK_SECRET=
```

Quando o segredo é informado, o corpo JSON é assinado com HMAC-SHA256. A assinatura é enviada em:

```text
X-Operational-Alert-Signature: sha256=<assinatura>
```

O tipo do evento é enviado em `X-Operational-Alert-Event`.

A URL passa pela mesma proteção SSRF utilizada nas demais integrações: bloqueio de protocolos indevidos, credenciais embutidas, localhost, IPs privados e redirecionamentos.

## E-mail SMTP

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
OPERATIONAL_ALERT_EMAIL_FROM=alertas@exemplo.com
OPERATIONAL_ALERT_EMAIL_TO=admin1@exemplo.com,admin2@exemplo.com
```

Para SMTP na porta 465, normalmente use `SMTP_SECURE=true`. Para STARTTLS na porta 587, normalmente use `SMTP_SECURE=false`.

## Fila BullMQ

A fila `operational-alerts` possui:

- um job independente por evento e canal;
- até cinco tentativas por padrão;
- backoff exponencial;
- retenção de concluídos por sete dias;
- retenção de falhos por quatorze dias;
- concorrência configurável.

Separar os canais evita que uma falha no SMTP faça o Telegram receber mensagens duplicadas durante o retry.

## Deduplicação

A chave do job combina:

- chave do incidente ou item da DLQ;
- canal de destino.

Assim, o mesmo item não cria duas notificações para o mesmo canal. Um novo incidente crítico recebe uma identificação própria e pode gerar novos alertas.

## Endpoints administrativos

### Consultar status

```http
GET /admin/operational-alerts/status
Authorization: Bearer <JWT_ADMIN>
```

A resposta informa somente:

- se o recurso está habilitado;
- canais solicitados e se estão completos;
- limite da DLQ;
- intervalo de verificação;
- cooldown;
- estado da fila operacional.

Nenhum token, senha, URL privada ou segredo é retornado.

### Enviar teste

```http
POST /admin/operational-alerts/test
Authorization: Bearer <JWT_ADMIN>
```

O endpoint retorna HTTP 202 e os IDs dos jobs criados.

### Executar verificação manual

```http
POST /admin/operational-alerts/check
Authorization: Bearer <JWT_ADMIN>
```

Executa imediatamente a avaliação do limite da DLQ. Um lock no Redis impede verificações concorrentes.

## Operação segura

- habilite somente os canais necessários;
- mantenha tokens e senhas apenas em variáveis de ambiente ou secret manager;
- utilize HTTPS no webhook;
- configure um segredo HMAC para validar a origem;
- ajuste o limite conforme o volume normal da operação;
- não use cooldown muito curto;
- monitore também jobs falhos da fila `operational-alerts`;
- execute o endpoint de teste depois de trocar qualquer credencial;
- confirme a recuperação depois de esvaziar ou reprocessar a DLQ.

## Arquivos principais

```text
apps/api/src/operationalConfig.ts
apps/api/src/operationalAlerts.ts
apps/api/src/operationalAlertRoutes.ts
apps/api/src/queue.ts
apps/api/src/worker.ts
apps/api/test/operationalAlerts.test.ts
apps/api/test/operationalAlerts.integration.test.ts
```