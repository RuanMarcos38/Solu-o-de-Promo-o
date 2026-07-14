# Distribuição com filas, retry e dead-letter queue

## Visão geral

A distribuição de ofertas não acontece mais dentro do job de coleta. A coleta apenas aprova e persiste ofertas; depois, cada combinação de oferta e canal ativo gera um job independente na fila `dispatch-offers`.

Isso impede que uma falha no Telegram, WhatsApp, Evolution API ou Webhook interrompa os demais canais.

## Filas

| Fila | Responsabilidade |
|---|---|
| `collect-offers` | Buscar, normalizar, pontuar e salvar ofertas. |
| `dispatch-offers` | Entregar uma oferta para exatamente um canal. |
| `dispatch-dead-letter` | Reter entregas que esgotaram todas as tentativas. |

## Idempotência

A chave idempotente usa SHA-256 sobre:

- ID interno da oferta;
- ID do canal;
- preço atual;
- percentual de desconto;
- score;
- URL final de destino;
- escopo do evento.

O mesmo evento comercial para o mesmo canal produz o mesmo `jobId` no BullMQ. Uma nova entrega é permitida quando o preço, desconto, score ou destino muda.

O endpoint administrativo de teste utiliza um escopo forçado para permitir testes repetidos sem alterar a idempotência de produção.

## Retry e backoff

Configurações:

```env
DISPATCH_ATTEMPTS=5
DISPATCH_BACKOFF_MS=10000
DISPATCH_CONCURRENCY=8
```

O backoff é exponencial. Com base de 10 segundos, as tentativas aguardam intervalos progressivamente maiores, reduzindo pressão sobre provedores instáveis.

Cada tentativa atualiza o `DispatchLog` com:

- chave idempotente;
- ID do job;
- ID e tipo do canal;
- número da tentativa;
- data da última tentativa;
- alertas correspondentes;
- erro mais recente;
- estado `PENDING`, `SENT`, `FAILED` ou `SKIPPED`.

## Dead-letter queue

Quando `attemptsMade` alcança o limite configurado, o worker cria um job persistente em `dispatch-dead-letter` e marca o log com:

```json
{
  "deadLetter": true,
  "deadLetterJobId": "dlq-dispatch-...",
  "deadLetteredAt": "2026-07-14T00:00:00.000Z"
}
```

A DLQ não remove jobs automaticamente. A retenção deve ser tratada como evidência operacional até reprocessamento ou descarte consciente.

## Inspeção e replay

Listar os primeiros jobs da DLQ:

```bash
npm run retry:dlq -w apps/api
```

Reprocessar um job:

```bash
npm run retry:dlq -w apps/api -- dlq-dispatch-CHAVE
```

Em uma imagem de produção já compilada:

```bash
npm run retry:dlq:prod -w apps/api -- dlq-dispatch-CHAVE
```

O replay:

1. cria um novo job de entrega com sufixo de retry;
2. preserva a chave idempotente original;
3. registra `replayOf` para auditoria;
4. remove o item da DLQ somente depois que o novo job foi criado.

Se o replay falhar novamente até esgotar as tentativas, ele retorna à DLQ.

## Retenção

```env
DISPATCH_COMPLETED_RETENTION_SECONDS=604800
DISPATCH_FAILED_RETENTION_SECONDS=1209600
DISPATCH_RETENTION_COUNT=10000
```

Padrões:

- concluídos: 7 dias;
- falhos na fila principal: 14 dias;
- máximo por estado: 10.000 jobs;
- DLQ: retenção indefinida.

## Recomendações operacionais

- alertar quando a DLQ tiver qualquer item novo;
- alertar quando a fila atrasada crescer continuamente;
- acompanhar taxa de sucesso por canal;
- não reprocessar falhas de configuração antes de corrigir token, URL, instância ou destinatário;
- limitar `DISPATCH_CONCURRENCY` conforme os limites de cada provedor;
- manter Redis com AOF, autenticação e backup do volume;
- utilizar URLs HTTPS e allowlist para integrações privadas.

## Fluxo resumido

```text
Oferta aprovada
    |
    v
Regras de alerta
    |
    +-- sem correspondência --> DispatchLog SKIPPED
    |
    v
Um job por canal ativo
    |
    v
dispatch-offers
    |
    +-- sucesso --> DispatchLog SENT
    |
    +-- falha --> retry exponencial
                      |
                      +-- sucesso --> SENT
                      |
                      +-- limite esgotado --> dispatch-dead-letter
```
