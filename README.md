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
9. Prepara distribuição para grupos, listas e canais comerciais.

## Stack Técnica

- **Backend:** Node.js, TypeScript, Fastify, Socket.IO, Prisma, PostgreSQL, Redis, BullMQ.
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
├── docs             # arquitetura e regras de negócio
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

Acessos padrão:

- API: `http://localhost:3333`
- Frontend: `http://localhost:5173`
- Healthcheck: `http://localhost:3333/health`

## Endpoints principais

```http
GET /health
GET /offers
GET /offers/stats
POST /collect/run
POST /collect/enqueue
POST /alerts
GET /alerts
```

## Tempo real

O backend emite eventos Socket.IO:

- `offers:init` — lista inicial de ofertas ao conectar.
- `offer:new` — nova oferta aprovada.
- `stats:update` — atualização de métricas.

O worker publica o resultado da coleta no Redis Pub/Sub e a API retransmite para o frontend via Socket.IO.

## Banco de dados

A persistência usa Prisma + PostgreSQL com as entidades:

- `Offer` — oferta normalizada e aprovada.
- `PriceHistory` — histórico de preço por captura.
- `AlertRule` — regras de alerta.
- `DispatchChannel` — canais de distribuição.
- `DispatchLog` — logs de envio.

## Regras de qualidade das ofertas

Uma oferta só entra no feed quando passa por critérios mínimos:

- preço atual válido;
- URL de compra válida;
- marketplace confiável;
- imagem válida quando disponível;
- desconto mínimo configurável;
- score mínimo configurável;
- bloqueio de produtos duplicados;
- comparação com histórico de preço quando existir.

## Variáveis importantes

Veja `.env.example` para configurar:

- banco PostgreSQL;
- Redis;
- URL do frontend;
- chaves Amazon/Shopee;
- tags de afiliado;
- limites de coleta;
- desconto mínimo e score mínimo.

## Próximos passos de produção

1. Criar contas oficiais de afiliado/API nos marketplaces.
2. Preencher `.env` com as credenciais.
3. Configurar domínio e SSL.
4. Ativar autenticação e multiusuário.
5. Criar política comercial de categorias, margem e frequência de postagem.
6. Conectar WhatsApp/Telegram para distribuição automática.
7. Adicionar observabilidade com logs estruturados, métricas e alertas.

## Importante

Evite raspagem agressiva de sites. Para operar profissionalmente e com menor risco, use APIs oficiais, feeds autorizados, programas de afiliados e parceiros comerciais.
