# Solução de Promoção — Radar de Ofertas em Tempo Real

Plataforma SaaS para monitorar oportunidades de ofertas em marketplaces confiáveis, normalizar produtos, calcular score de promoção, evitar duplicidade e distribuir ofertas em tempo real para painel web, API, WhatsApp/Telegram/e-mail e canais de afiliados.

> Objetivo: ser um distribuidor profissional de oportunidades de ofertas usando integrações oficiais, regras de qualidade e atualização ao vivo.

## Visão do Produto

A solução foi pensada para operar como um “radar de promoções”:

1. Coleta produtos em marketplaces configurados.
2. Normaliza título, preço, imagem, marketplace, categoria, frete, seller e URL de afiliado.
3. Calcula desconto real e score de oportunidade.
4. Remove ofertas duplicadas ou fracas.
5. Publica as melhores ofertas no painel em tempo real.
6. Permite criar alertas por categoria, palavra-chave, desconto mínimo e preço máximo.
7. Prepara distribuição para grupos, listas e canais comerciais.

## Stack Técnica

- **Backend:** Node.js, TypeScript, Fastify, Socket.IO, Prisma, PostgreSQL, Redis, BullMQ.
- **Frontend:** React, Vite, TypeScript, Socket.IO Client.
- **Banco:** PostgreSQL com Prisma ORM.
- **Fila e tempo real:** Redis + BullMQ + WebSocket.
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
│   ├── api          # API, jobs, conectores e websocket
│   └── web          # painel em tempo real
├── docs             # arquitetura e regras de negócio
├── docker-compose.yml
├── .env.example
└── package.json
```

## Como rodar localmente

```bash
cp .env.example .env
npm install
npm run db:generate
npm run dev
```

Subir banco e Redis:

```bash
docker compose up -d postgres redis
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
POST /alerts
GET /alerts
```

## Tempo real

O backend emite eventos WebSocket:

- `offer:new` — nova oferta aprovada.
- `offer:update` — oferta atualizada.
- `stats:update` — atualização de métricas.

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
4. Ativar workers em processo separado para alta escala.
5. Criar política comercial de categorias, margem e frequência de postagem.
6. Conectar WhatsApp/Telegram para distribuição automática.

## Importante

Evite raspagem agressiva de sites. Para operar profissionalmente e com menor risco, use APIs oficiais, feeds autorizados, programas de afiliados e parceiros comerciais.
