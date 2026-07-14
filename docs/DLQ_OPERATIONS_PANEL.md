# Painel Operacional da Dead-Letter Queue

## Objetivo

O painel operacional permite que administradores acompanhem a saúde das filas BullMQ e reprocessem entregas que esgotaram todas as tentativas, sem acesso direto ao Redis ou ao terminal do servidor.

O painel é exibido somente quando a sessão autenticada pertence a um usuário com papel `ADMIN`.

## Informações exibidas

### Filas

- `collect-offers`: jobs de coleta de ofertas;
- `dispatch-offers`: jobs individuais de entrega por canal;
- `dispatch-dead-letter`: entregas que esgotaram as tentativas.

Para cada fila são exibidos:

- aguardando;
- ativos;
- atrasados;
- falhos;
- concluídos.

### DispatchLog

O painel mostra os totais acumulados de:

- `PENDING`;
- `SENT`;
- `FAILED`;
- `SKIPPED`.

Também são apresentadas as falhas recentes com oferta, canal, erro, data e número da tentativa quando disponível.

### Dead-Letter Queue

Cada item da DLQ apresenta:

- oferta;
- marketplace;
- canal e tipo;
- número de tentativas;
- mensagem da falha final;
- data da falha;
- job original;
- estado atual no BullMQ.

O filtro local permite pesquisar por oferta, canal, marketplace ou mensagem de erro.

## Reprocessamento

O botão `Reprocessar` executa uma ação individual e administrativa.

Fluxo:

1. o frontend chama o endpoint protegido;
2. a API verifica a sessão e o papel `ADMIN`;
3. um novo job é criado em `dispatch-offers` com sufixo de replay;
4. o campo `replayOf` preserva a origem para auditoria;
5. o item original é removido da DLQ somente depois da criação do novo job;
6. o painel atualiza o snapshot.

Não existe reprocessamento automático em massa no painel. Essa decisão reduz o risco de reenviar milhares de mensagens após uma correção de configuração sem avaliação prévia.

## Endpoints

### Snapshot operacional

```http
GET /admin/dispatch/operations?limit=50&offset=0
Authorization: Bearer <JWT_ADMIN>
```

Resposta resumida:

```json
{
  "generatedAt": "2026-07-14T17:00:00.000Z",
  "queues": {
    "collect": {},
    "dispatch": {},
    "deadLetter": {}
  },
  "dispatchLogs": {
    "pending": 0,
    "sent": 120,
    "failed": 4,
    "skipped": 20
  },
  "recentFailures": [],
  "deadLetters": {
    "total": 1,
    "offset": 0,
    "limit": 50,
    "items": []
  }
}
```

O endpoint não retorna configurações de canais, tokens, API keys, headers de autorização ou outros segredos.

### Reprocessar item

```http
POST /admin/dispatch/dlq/:jobId/retry
Authorization: Bearer <JWT_ADMIN>
```

Resposta:

```json
{
  "status": "requeued",
  "deadLetterJobId": "dlq-dispatch-chave",
  "dispatchJobId": "dispatch-chave-retry-nonce"
}
```

## Atualização automática

O componente atualiza as informações a cada 15 segundos enquanto uma sessão administrativa estiver ativa. Também existe atualização manual.

A atualização automática é somente leitura. Nenhum job é reprocessado sem clique explícito do administrador.

## Arquivos principais

```text
apps/api/src/application.ts
apps/api/src/dispatchOperations.ts
apps/web/src/DlqPanel.tsx
apps/web/src/entry.tsx
apps/web/src/styles.css
apps/api/test/dispatchOperations.integration.test.ts
```

## Checklist operacional antes do replay

- corrigir token, URL, destinatário ou instância do canal;
- confirmar se o canal está ativo;
- avaliar se a oferta ainda é válida;
- confirmar que o replay não causará comunicação duplicada indesejada;
- acompanhar a fila `dispatch-offers` depois do reprocessamento;
- verificar se o item retorna à DLQ em caso de nova falha.
