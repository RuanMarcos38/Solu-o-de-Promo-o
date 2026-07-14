# Solução de Promoção — Radar de Ofertas em Tempo Real

Plataforma SaaS para monitorar oportunidades de ofertas em marketplaces confiáveis, normalizar produtos, calcular score de promoção, evitar duplicidade e distribuir ofertas em tempo real para painel web, API, WhatsApp/Telegram/e-mail e canais de afiliados.

> Objetivo: ser um distribuidor profissional de oportunidades de ofertas usando integrações oficiais, regras de qualidade e atualização ao vivo.

## Visão do Produto

A solução foi pensada para operar como um “radar de promoções”:

1. Coleta produtos em marketplaces configurados.
2. Normaliza título, preço, imagem, marketplace, categoria, frete, seller e URL de afiliado.
3. Calcula desconto real e score de oportunidade.
4. Remove ofertas duplicadas ou fracas.
5. Salva ofertas e histórico de preço no PostgreSQL.
6. Publica as melhores ofertas no painel em tempo real via Socket.IO.
7. Enfileira coletas recorrentes com Redis + BullMQ.
8. Permite criar alertas por categoria, palavra-chave, desconto mínimo e preço máximo.
9. Permite administrar fontes, alertas, usuários e canais pelo painel.
10. Distribui ofertas automaticamente para Telegram, WhatsApp genérico, Evolution API ou Webhook.
11. Exibe status operacional de banco, Redis, filas, SLOs, alertas e logs.

## Stack Técnica

- **Backend:** Node.js, TypeScript, Fastify, Socket.IO, Prisma, PostgreSQL, Redis, BullMQ, JWT.
- **Frontend:** React, Vite, TypeScript, Socket.IO Client.
- **Observabilidade:** Prometheus, Grafana, Alertmanager e OpenTelemetry.
- **Deploy:** Docker Compose, Caddy, TLS automático, GHCR e scripts de rollback/restore.

## Como rodar localmente

```bash
docker compose up -d postgres redis
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev:api
npm run dev:worker
npm run dev:web
```

## Validação

```bash
npm run verify
npm run test:integration
npm run observability:validate
npm run deploy:validate
```

Os workflows validam typecheck, testes unitários e integrados, migrations, builds, auditoria, Docker, Prometheus, Alertmanager, Caddy e ativos de go-live.

## Deploy em produção

Arquivos principais:

- `compose.production.yml`;
- `.env.production.example`;
- `deploy/caddy/Caddyfile`;
- `scripts/prepare-production.sh`;
- `scripts/deploy-production.sh`;
- `scripts/rollback-production.sh`;
- `scripts/backup-production.sh`;
- `scripts/restore-production.sh`.

Guia completo: `docs/DEPLOY_DEVOPS.md`.

## Homologação definida

A primeira homologação foi preparada para:

- VPS Hostinger: `2.25.155.142`;
- Aplicação: `ofertas.r2rmarketingdigital.com.br`;
- API: `api-ofertas.r2rmarketingdigital.com.br`;
- Grafana: `grafana-ofertas.r2rmarketingdigital.com.br`;
- Release candidate: `v0.1.0-rc.1`.

Comandos:

```bash
cp deploy/homologation.env.example deploy/homologation.env
bash scripts/go-live-preflight.sh deploy/homologation.env
bash scripts/publish-homologation-release.sh deploy/homologation.env
bash scripts/go-live-smoke.sh deploy/homologation.env
bash scripts/homologation-dr-drill.sh deploy/homologation.env
```

O go-live real depende de DNS, SSH e credenciais externas. Consulte `docs/GO_LIVE_HOMOLOGATION.md` e a issue operacional #15.

## Documentação

- `docs/SECURITY_PRODUCTION.md`;
- `docs/TESTING_AND_CI.md`;
- `docs/DISTRIBUTION_QUEUES.md`;
- `docs/DLQ_OPERATIONS_PANEL.md`;
- `docs/OPERATIONAL_ALERTS.md`;
- `docs/OBSERVABILITY_SLO.md`;
- `docs/GRAFANA_ALERTMANAGER.md`;
- `docs/DEPLOY_DEVOPS.md`;
- `docs/GO_LIVE_HOMOLOGATION.md`.

## Importante

Evite raspagem agressiva. Para operar profissionalmente e com menor risco, use APIs oficiais, feeds autorizados, programas de afiliados e parceiros comerciais.
