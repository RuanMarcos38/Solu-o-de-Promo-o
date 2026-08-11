# Checklist Final de Go-Live

Use este checklist antes de colocar a Solucao de Promocao em producao.

## 1. Infraestrutura

- Projeto criado no EasyPanel, VPS, Coolify ou ambiente Docker.
- PostgreSQL ativo.
- Redis ativo.
- API publicada na porta 3333.
- Frontend publicado na porta 5173.
- Worker da fila ativo.
- Servico de migrations executado antes da API.

## 2. Dominios

Recomendado:

- Painel: `https://painel.seudominio.com.br`
- API: `https://api.seudominio.com.br`
- Evolution: `https://evolution.seudominio.com.br`, se usar WhatsApp.

## 3. Seguranca

- Trocar usuario admin padrao.
- Trocar senha admin padrao.
- Usar chave JWT forte.
- Nao commitar credenciais no GitHub.
- Usar Environment Variables do EasyPanel ou secrets da hospedagem.
- Habilitar HTTPS/SSL.
- Bloquear acesso direto ao banco fora da rede segura.

## 4. Variaveis obrigatorias

Configure no ambiente da hospedagem:

- NODE_ENV
- API_PORT
- WEB_PORT
- PUBLIC_API_URL
- FRONTEND_ORIGIN
- DATABASE_URL
- REDIS_URL
- JWT_SECRET
- JWT_EXPIRES_IN
- ADMIN_NAME
- ADMIN_EMAIL
- ADMIN_PASSWORD
- DEFAULT_MARKETPLACE
- DEFAULT_KEYWORDS
- MIN_DISCOUNT_PERCENT
- MIN_OPPORTUNITY_SCORE
- COLLECT_INTERVAL_SECONDS
- MAX_RESULTS_PER_SOURCE
- MERCADO_LIVRE_SITE_ID

## 5. Variaveis opcionais

Configure somente quando tiver credenciais reais:

- MERCADO_LIVRE_ACCESS_TOKEN
- AFFILIATE_LINK_RESOLVER_URL
- AFFILIATE_LINK_RESOLVER_TOKEN
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHANNEL_ID
- WHATSAPP_PROVIDER_URL
- WHATSAPP_PROVIDER_TOKEN
- WHATSAPP_DEFAULT_TO
- EVOLUTION_API_URL
- EVOLUTION_API_KEY
- EVOLUTION_INSTANCE_NAME
- AMAZON_ENABLED
- AMAZON_CREATORS_CREDENTIAL_ID
- AMAZON_CREATORS_CREDENTIAL_SECRET
- AMAZON_CREATORS_CREDENTIAL_VERSION
- AMAZON_PARTNER_TAG
- SHOPEE_ENABLED
- SHOPEE_APP_ID
- SHOPEE_SECRET
- SHOPEE_AFFILIATE_GRAPHQL_URL

## 6. Testes obrigatorios apos deploy

Execute:

```bash
curl https://api.seudominio.com.br/health
curl https://api.seudominio.com.br/ready
```

No painel:

1. Entrar com o usuario admin.
2. Conferir Status da operacao.
3. Criar uma fonte Mercado Livre.
4. Criar um alerta.
5. Enfileirar uma coleta.
6. Conferir ofertas aprovadas.
7. Conferir fila BullMQ.
8. Conferir logs de envio.
9. Criar canal Webhook de teste.
10. Depois, criar canal Telegram ou Evolution quando as credenciais reais existirem.

## 7. Operacao inicial recomendada

Comece com Mercado Livre e Webhook.

Depois ative:

1. Telegram.
2. Evolution API.
3. Amazon, apenas com credenciais oficiais.
4. Shopee, apenas com credenciais oficiais.

## 8. Criterio de pronto

A solucao esta pronta para operar quando:

- `/health` responder `ok`.
- `/ready` responder `ready`.
- Painel abrir sem erro.
- Login funcionar.
- Status da operacao mostrar banco e Redis `ok`.
- Uma coleta for enfileirada.
- Worker processar a fila.
- Ofertas aparecerem no painel.
- Logs de distribuicao forem registrados.

## 9. Arquivos principais

- `README.md`
- `docs/EASYPANEL_DEPLOY.md`
- `docs/DEPLOY_PRODUCTION.md`
- `docs/GO_LIVE_CHECKLIST.md`
- `.env.example`
- `docker-compose.yml`

## 10. Observacao final

Nao coloque credenciais reais em arquivos do repositorio. Use sempre variaveis de ambiente na hospedagem.
