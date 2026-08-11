# Testes e Integração Contínua

Este projeto usa o test runner nativo do Node.js com TypeScript executado por `tsx`.

## Comandos

```bash
npm run db:generate
npm run test:unit
npm run test:integration
npm run test:coverage
```

O comando `test:integration` exige PostgreSQL e Redis disponíveis. Por segurança, o setup recusa bancos cujo nome não contenha `promo_test`.

## Cobertura implementada

### Testes unitários

- normalização de títulos;
- cálculo de desconto;
- score e aprovação mínima de ofertas;
- criptografia AES-256-GCM;
- detecção de ciphertext adulterado;
- mascaramento de tokens, chaves, senhas e headers;
- bloqueio SSRF para protocolos, localhost, redes privadas e metadata cloud;
- correspondência de alertas;
- formatação das mensagens de distribuição.

### Testes de integração

- login válido e inválido;
- papéis `VIEWER`, `EDITOR` e `ADMIN`;
- revogação imediata do JWT quando o usuário é desativado;
- validação Zod e respostas HTTP 400;
- criptografia persistida das configurações de canais;
- ausência de secrets nas respostas da API;
- deduplicação por marketplace e ID externo;
- republicação quando o score melhora;
- logs `SKIPPED` quando nenhum alerta corresponde;
- logs `FAILED` sem interromper o processamento do lote.

## Pipeline CI

O workflow `.github/workflows/ci.yml` possui duas barreiras.

### Quality

1. instala dependências;
2. gera o Prisma Client;
3. executa typecheck da API e do frontend;
4. executa testes unitários;
5. gera os builds da API e do frontend;
6. executa `npm audit --omit=dev --audit-level=high`;
7. publica o relatório de auditoria como artefato;
8. bloqueia o PR quando há vulnerabilidade alta ou crítica.

### Integration

1. inicia PostgreSQL 16 e Redis 7 isolados;
2. aplica migrations no banco `promo_test`;
3. executa testes unitários e de integração com cobertura V8;
4. inicia a API compilada e valida `/health`, `/ready`, `/api/v1/health` e `/openapi.json`;
5. publica a cobertura bruta como artefato por 14 dias.

## Variáveis de teste

O arquivo `apps/api/test/setup.ts` define valores exclusivamente locais quando eles não foram fornecidos pelo ambiente. Nenhum secret de produção deve ser usado nos testes.

Variáveis principais:

```env
NODE_ENV=test
DATABASE_URL=postgresql://promo:promo@localhost:5432/promo_test?schema=public
REDIS_URL=redis://localhost:6379
BOOTSTRAP_ADMIN_ENABLED=true
```

## Critérios para merge

Antes do merge, os seguintes workflows precisam estar verdes:

- CI;
- API Diagnostics;
- Docker Build.

Falhas não devem ser ignoradas com `continue-on-error`. Vulnerabilidades devem ser corrigidas por atualização ou substituição da dependência afetada.
