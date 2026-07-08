# Deploy em Produção

## Deploy rápido com Docker Compose

1. Configure o arquivo `.env` a partir do `.env.example`.
2. Troque obrigatoriamente as credenciais padrão de administrador e a chave JWT.
3. Configure a URL pública da API e a origem do frontend.
4. Execute:

```bash
docker compose up --build -d
```

## Validação pós-deploy

```bash
curl -fsS http://SEU_DOMINIO_API/health
curl -fsS http://SEU_DOMINIO_API/ready
```

`/health` confirma que a API respondeu.
`/ready` confirma API, PostgreSQL e Redis.

## EasyPanel

- Tipo recomendado: Docker Compose na raiz.
- Build path: `/`.
- Arquivo: `docker-compose.yml`.
- Configure as variáveis do `.env` no painel.
- Exponha a API na porta `3333` e o frontend no serviço `web`.

## Domínios recomendados

- Frontend: `https://ofertas.seudominio.com.br`
- API: `https://api-ofertas.seudominio.com.br`

Depois de alterar a URL pública da API, faça novo build do serviço web, porque o Vite grava essa URL no build.

## Operação diária

1. Entrar no painel.
2. Criar fontes por marketplace e palavras-chave.
3. Criar alertas por desconto mínimo.
4. Configurar canal de distribuição.
5. Clicar em “Varrer agora” para teste manual.
6. Manter o worker ligado para coletas recorrentes.

## Canais de distribuição

### Webhook

```json
{"url":"https://seu-webhook.com/ofertas"}
```

### Telegram

```json
{"botToken":"VALOR_DO_BOT","chatId":"ID_DO_CANAL"}
```

### WhatsApp Provider HTTP

```json
{"url":"https://sua-api-whatsapp.com/send","token":"VALOR_DO_TOKEN","to":"NUMERO_DESTINO"}
```

## Segurança mínima

- Nunca use senha padrão em produção.
- Use senha forte e chave JWT longa.
- Restrinja acesso ao painel por domínio, firewall ou Cloudflare quando possível.
- Use apenas APIs oficiais e programas de afiliados autorizados.
