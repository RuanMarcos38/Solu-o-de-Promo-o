# Deploy no EasyPanel

Este guia prepara a Solucao de Promocao para rodar em producao no EasyPanel sem expor credenciais no GitHub.

## 1. Clonar pelo GitHub

No EasyPanel:

1. Crie um novo projeto.
2. Escolha GitHub como origem.
3. Selecione este repositorio.
4. Use a branch `main`.

## 2. Servicos necessarios

A solucao precisa de:

- API Node.js na porta `3333`;
- Frontend web na porta `5173`;
- PostgreSQL;
- Redis;
- worker da fila.

O `docker-compose.yml` ja contem esses servicos.

## 3. Configuracao de build

No EasyPanel, use:

- Build Path: `/`
- Docker Compose: habilitado quando disponivel
- Arquivo compose: `docker-compose.yml`

Se usar servico separado por Dockerfile:

- API: `apps/api/Dockerfile`
- Web: `apps/web/Dockerfile`

## 4. Variaveis obrigatorias

Configure no EasyPanel em Environment Variables:

```env
NODE_ENV=production
API_PORT=3333
WEB_PORT=5173
DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/NOME_DO_BANCO?schema=public
REDIS_URL=redis://HOST_REDIS:6379
JWT_SECRET=TROQUE_POR_UMA_CHAVE_FORTE_COM_32_CARACTERES_OU_MAIS
JWT_EXPIRES_IN=7d
ADMIN_NAME=Administrador
ADMIN_EMAIL=seu-email@seudominio.com.br
ADMIN_PASSWORD=troque-por-uma-senha-forte
PUBLIC_API_URL=https://api.seudominio.com.br
FRONTEND_ORIGIN=https://painel.seudominio.com.br
DEFAULT_MARKETPLACE=mercadolivre
DEFAULT_KEYWORDS=iphone,smart tv,notebook,air fryer,monitor gamer,fone bluetooth
MIN_DISCOUNT_PERCENT=10
MIN_OPPORTUNITY_SCORE=55
COLLECT_INTERVAL_SECONDS=60
MAX_RESULTS_PER_SOURCE=30
MERCADO_LIVRE_SITE_ID=MLB
```

## 5. Variaveis opcionais de integracao

Preencha apenas quando tiver credenciais reais.

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE_NAME=
WHATSAPP_DEFAULT_TO=
AMAZON_ACCESS_KEY=
AMAZON_SECRET_KEY=
AMAZON_PARTNER_TAG=
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
SHOPEE_AFFILIATE_ID=
```

Nunca coloque valores reais dessas credenciais em arquivos versionados no GitHub.

## 6. Banco de dados

A API usa Prisma. O compose possui o servico `migrate`, que executa as migrations antes da API e do worker.

Para rodar manualmente:

```bash
docker compose run --rm migrate
```

## 7. Dominios recomendados

Sugestao:

- Frontend: `https://painel.seudominio.com.br`
- API: `https://api.seudominio.com.br`
- Evolution API: `https://evolution.seudominio.com.br`

Configure `PUBLIC_API_URL` apontando para a API publica e `FRONTEND_ORIGIN` apontando para o painel.

## 8. Validacao apos deploy

Depois de subir, valide:

```bash
curl https://api.seudominio.com.br/health
curl https://api.seudominio.com.br/ready
```

No painel:

1. Acesse o frontend.
2. Entre com o admin configurado.
3. Verifique o bloco Status da operacao.
4. Crie uma fonte.
5. Crie um alerta.
6. Enfileire uma coleta.
7. Confira a fila BullMQ no painel.
8. Confira logs de envio.

## 9. Checklist de producao

- Trocar `ADMIN_EMAIL`.
- Trocar `ADMIN_PASSWORD`.
- Usar `JWT_SECRET` forte.
- Configurar dominio da API.
- Configurar dominio do frontend.
- Habilitar HTTPS/SSL.
- Validar `/health`.
- Validar `/ready`.
- Criar fontes reais.
- Criar alertas reais.
- Configurar canais de distribuicao.
- Testar Evolution/Telegram somente depois de inserir credenciais reais.

## 10. Importante

Mercado Livre funciona como primeira fonte operacional. Amazon e Shopee dependem de credenciais oficiais de afiliado/API antes de operar em producao.
