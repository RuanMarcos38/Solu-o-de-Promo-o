# Arquitetura da Solução

## Objetivo

Criar uma plataforma de oportunidades de ofertas em tempo real, com coleta segura, ranking automático, painel ao vivo e distribuição comercial.

## Princípios técnicos

- Usar APIs oficiais, feeds autorizados e programas de afiliados sempre que possível.
- Evitar raspagem agressiva e qualquer prática que viole termos dos marketplaces.
- Separar coleta, normalização, análise, persistência e distribuição.
- Manter todos os conectores plugáveis por marketplace.
- Usar filas para não travar a API durante varreduras.
- Usar WebSocket para publicação ao vivo.

## Fluxo de dados

```txt
Marketplaces/APIs
   ↓
MarketplaceAdapter
   ↓
Normalizer
   ↓
OpportunityScorer
   ↓
Deduplication
   ↓
PostgreSQL
   ↓
WebSocket + API + Distribuição
```

## Módulos

### 1. Collectors
Responsáveis por buscar produtos nos marketplaces. Cada fonte implementa a interface `MarketplaceAdapter`.

### 2. Normalizer
Transforma formatos diferentes em um padrão único de oferta.

### 3. Scorer
Calcula a força da oportunidade considerando desconto, preço, reputação, frete, marketplace e histórico.

### 4. Deduplicação
Evita repetir a mesma oferta usando hash por marketplace, produto, título normalizado e URL.

### 5. API
Expõe endpoints para painel, filtros, alertas e coleta manual.

### 6. Realtime
Publica novas ofertas por Socket.IO em eventos como `offer:new` e `stats:update`.

### 7. Distribuição
Camada preparada para enviar ofertas aprovadas para Telegram, WhatsApp, e-mail, webhook, grupos e páginas.

## Entidades principais

- Offer
- PriceHistory
- MarketplaceSource
- AlertRule
- DispatchChannel
- DispatchLog

## Produção

Para produção, rode API, worker e frontend separados:

- `api`: endpoints e websocket.
- `worker`: varredura recorrente e distribuição.
- `web`: painel.
- `postgres`: banco principal.
- `redis`: fila e cache.

## Roadmap de alta performance

1. Login multiusuário.
2. Perfis de cliente e listas de alertas.
3. Painel administrativo de fontes.
4. Integração real com Amazon Creators API.
5. Integração real com Shopee Open Platform.
6. Histórico avançado de preço.
7. IA para reescrever copy da oferta.
8. Publicação automática em WhatsApp, Telegram e Instagram.
9. App mobile/PWA.
10. Sistema de assinatura SaaS.
