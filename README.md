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
11. Exibe status operacional de banco, Redis, fila, jobs, fontes, alertas, canais e logs.

## Stack Técnica

- **Backend:** Node.js, TypeScript, Fastify, Socket.IO, Prisma, PostgreSQL, Redis, BullMQ, JWT.
- **Frontend:** React, Vite, TypeScript, Socket.IO Client.
- **Banco:** PostgreSQL com Prisma ORM e histórico de preço.
- **Fila e tempo real:** Redis + BullMQ + Redis Pub/Sub + WebSocket.
- **Deploy:** Docker Compose, pronto para VPS, EasyPanel, Coolify, Render ou Railway.

## Integrações previstas

A arquitetura usa adaptadores por marketplace. Cada adaptador precisa respeitar as regras da plataforma.

- Mercado Livre: busca pública/API oficial por site, termo e categoria.
- Amazon: conector preparado para Amazon Creators API/Associates, exigindo credenciais de afiliado.
- Shopee: conector preparado para Shopee Open Platform/Afiliados, exigindo credenciais.
- Outros marketplaces: Magazine Luiza, AliExpress, KaBuM, Casas Bahia, Carrefour, Americanas e lojas parceiras podem ser adicionados com o padrão `MarketplaceAdapter`.

## Estrutura

```txt
.
├── apps
│   ├── api          # API, worker, Prisma, conectores e websocket
│   └── web          # painel em tempo real
├── docs             # arquitetura, deploy e regras de negócio
├── scripts          # scripts de validação local
├── docker-compose.yml
├── .env.example
└── package.json
```

## Como rodar localmente

Suba banco e Redis:

```bash
docker compose up -d postgres redis
```

Instale e prepare o projeto:

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
```

Rodar API, worker e frontend em terminais separados:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

Rodar tudo com Docker:

```bash
docker compose up --build
```

O Docker Compose executa o serviço `migrate` antes de subir API e worker, então o banco recebe as migrations automaticamente.

## Formas de validar execução

### 1. GitHub Actions — CI Node

Workflow: `.github/workflows/ci.yml`.

Executa:

```bash
npm install
npm run db:generate
npm run lint
npm run build
```

### 2. GitHub Actions — Docker Build

Workflow: `.github/workflows/docker-build.yml`.

Executa:

```bash
docker compose build api worker web migrate
docker compose up -d postgres redis
docker compose run --rm migrate
docker compose up -d api worker
curl -fsS http://localhost:3333/health
curl -fsS http://localhost:3333/ready
node scripts/smoke-public.mjs
```

### 3. Local Linux/Mac

```bash
bash scripts/verify-local.sh
```

### 4. Local Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-local.ps1
```

### 5. GitHub Codespaces

Abra o repositório no GitHub, clique em **Code > Codespaces > Create codespace**. O arquivo `.devcontainer/devcontainer.json` prepara Node 20, Docker e Prisma.

Depois rode:

```bash
bash scripts/verify-local.sh
```

## Acessos padrão

- API: `http://localhost:3333`
- Frontend: `http://localhost:5173`
- Healthcheck: `http://localhost:3333/health`
- Readiness: `http://localhost:3333/ready`
- Login inicial: `ADMIN_EMAIL` e `ADMIN_PASSWORD` configurados no `.env`.
- Padrão local do `.env.example`: `admin@promoradar.local` / `admin123456`.

Troque `JWT_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` antes de publicar em produção.

## Endpoints principais

```http
POST /auth/login
GET /auth/me
GET /health
GET /ready
GET /offers
GET /offers/stats
GET /offers/:id/history
POST /collect/run
POST /collect/enqueue
GET /admin/system
GET /admin/users
POST /admin/users
PUT /admin/users/:id
GET /admin/sources
POST /admin/sources
PUT /admin/sources/:id
DELETE /admin/sources/:id
GET /alerts
POST /alerts
PUT /alerts/:id
DELETE /alerts/:id
GET /dispatch/channels
POST /dispatch/channels
PUT /dispatch/channels/:id
DELETE /dispatch/channels/:id
GET /dispatch/logs
POST /dispatch/test/:offerId
```

## Painel administrativo

O frontend permite:

- login administrativo;
- status operacional de API, banco, Redis e fila BullMQ;
- contagem de jobs waiting, active, delayed, completed e failed;
- indicadores de fontes, alertas, canais, envios e falhas;
- criação de fontes por marketplace e palavras-chave;
- ativar/desativar fontes;
- criação de alertas;
- ativar/desativar alertas;
- criação de canais Webhook, Telegram, WhatsApp genérico e Evolution API;
- ativar/desativar canais;
- criação e bloqueio de usuários;
- visualização de logs de distribuição;
- filtro de ofertas por marketplace, palavra-chave e desconto mínimo;
- coleta manual com envio para fila.

## Tempo real

O backend emite eventos Socket.IO:

- `offers:init` — lista inicial de ofertas ao conectar.
- `offer:new` — nova oferta aprovada.
- `stats:update` — atualização de métricas.

O worker publica o resultado da coleta no Redis Pub/Sub e a API retransmite para o frontend via Socket.IO.

## Banco de dados

A persistência usa Prisma + PostgreSQL com as entidades:

- `User` — login administrativo com JWT.
- `MarketplaceSource` — fontes configuráveis de coleta.
- `Offer` — oferta normalizada e aprovada.
- `PriceHistory` — histórico de preço por captura.
- `AlertRule` — regras de alerta.
- `DispatchChannel` — canais de distribuição.
- `DispatchLog` — logs de envio.

## Distribuição de ofertas

A distribuição respeita alertas ativos. Se não houver alerta ativo, as ofertas aprovadas são enviadas normalmente. Se houver alertas ativos, a oferta só é enviada quando combina com marketplace, palavras-chave, desconto mínimo e preço máximo.

Canais suportados:

- `telegram`: usa `botToken` e `chatId` no config do canal ou variáveis de ambiente.
- `whatsapp`: usa provider HTTP genérico com `url`, `token` e `to`.
- `evolution`: usa Evolution API com `baseUrl`, `apiKey`, `instanceName` e `number`.
- `webhook`: envia `{ message, offer, matchedAlerts }` para a URL configurada.

Exemplo de config Webhook no painel:

```json
{"url":"https://seu-webhook.com/ofertas"}
```

Exemplo de config Evolution API:

```json
{"baseUrl":"https://evolution.seudominio.com","apiKey":"SUA_API_KEY","instanceName":"minha-instancia","number":"5547999999999"}
```

## Regras de qualidade das ofertas

Uma oferta só entra no feed quando passa por critérios mínimos:

- preço atual válido;
- URL de compra válida;
- marketplace confiável;
- imagem válida quando disponível;
- desconto mínimo configurável;
- score mínimo configurável;
- bloqueio de produtos duplicados;
- publicação somente quando a oferta é nova, muda preço ou melhora score.

## Deploy em produção

Veja os guias:

- `docs/FINAL_HANDOFF.md` — entrega final do projeto.
- `docs/GO_LIVE_CHECKLIST.md` — checklist final antes de publicar.
- `docs/DEPLOY_PRODUCTION.md` — guia geral de produção.
- `docs/EASYPANEL_DEPLOY.md` — passo a passo para EasyPanel.
- `docs/DEPLOY_DEVOPS.md` — deploy endurecido com Caddy, TLS automático, domínios, GHCR, SSO do Grafana, backups e rollback.
- `docs/GO_LIVE_HOMOLOGATION.md` — homologação real na VPS Hostinger, publicação da primeira release e drill de disaster recovery.

## Homologação definida

- VPS: `2.25.155.142`;
- aplicação: `ofertas.r2rmarketingdigital.com.br`;
- API: `api-ofertas.r2rmarketingdigital.com.br`;
- Grafana: `grafana-ofertas.r2rmarketingdigital.com.br`;
- release candidate: `v0.1.0-rc.1`.

Comandos operacionais:

```bash
cp deploy/homologation.env.example deploy/homologation.env
npm run go-live:preflight
npm run go-live:publish
npm run go-live:smoke
npm run go-live:drill
```

A publicação real depende de DNS, SSH e credenciais externas. O checklist operacional está na issue #15.

## Variáveis importantes

Veja `.env.example` para configurar:

- banco PostgreSQL;
- Redis;
- URL pública da API para o frontend;
- JWT e usuário admin;
- chaves Amazon/Shopee;
- tags de afiliado;
- limites de coleta;
- desconto mínimo e score mínimo;
- canais Telegram/WhatsApp;
- Evolution API.

## Próximos passos de produção

1. Criar contas oficiais de afiliado/API nos marketplaces.
2. Preencher variáveis reais no EasyPanel Environment Variables.
3. Configurar domínio e SSL.
4. Criar novas fontes pelo painel.
5. Criar alertas de distribuição.
6. Criar canais Webhook, Telegram, WhatsApp ou Evolution API.
7. Definir política comercial de categorias, margem e frequência de postagem.
8. Acompanhar logs de envio e métricas de ofertas no painel.

## Importante

Evite raspagem agressiva de sites. Para operar profissionalmente e com menor risco, use APIs oficiais, feeds autorizados, programas de afiliados e parceiros comerciais.
