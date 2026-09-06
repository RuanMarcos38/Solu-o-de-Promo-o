# Integrações de afiliados sem API terceirizada paga

Este projeto foi preparado para operar com Mercado Livre, Amazon e Shopee sem depender obrigatoriamente de serviços terceirizados pagos para descoberta ou afiliação.

> Importante: "sem custo de API terceirizada" não significa acesso irrestrito. Cada marketplace exige conta válida, aprovação no programa de afiliados quando aplicável, credenciais próprias e respeito aos limites e termos da plataforma.

## Regra principal

- Nunca inventar parâmetros, tags ou links de afiliado.
- Nunca tratar um link comum como link com comissão.
- Somente distribuir automaticamente ofertas com `affiliateEligible=true` quando `REQUIRE_VERIFIED_AFFILIATE_LINKS=true`.
- Credenciais ficam apenas no backend/EasyPanel; não são expostas no frontend.
- Apify é opcional e deve permanecer sem token quando a operação precisar ser estritamente sem serviço externo pago.

## Mercado Livre

### Catálogo

Use a API do ecossistema Mercado Livre com aplicação registrada e OAuth quando a conta tiver credenciais disponíveis.

Variáveis:

```env
MERCADO_LIVRE_SITE_ID=MLB
MERCADO_LIVRE_ACCESS_TOKEN=
```

A aplicação também possui fallback de descoberta pública para continuidade operacional quando o token não estiver configurado.

### Afiliação

O sistema não adiciona uma tag inventada ao link do Mercado Livre. Para comissão automática, conecte um processo autorizado pelo programa Afiliados e Criadores capaz de transformar o anúncio elegível em URL rastreável.

Variáveis:

```env
AFFILIATE_LINK_RESOLVER_URL=
AFFILIATE_LINK_RESOLVER_TOKEN=
```

Contrato esperado do resolvedor:

```json
{
  "marketplace": "mercadolivre",
  "externalId": "MLB123",
  "productUrl": "https://produto.mercadolivre.com.br/..."
}
```

Resposta esperada:

```json
{
  "eligible": true,
  "affiliateUrl": "https://mercado.li/...",
  "provider": "portal-mercado-livre"
}
```

Se não houver link autorizado e verificado, a oferta não deve ser disparada como afiliada.

## Amazon

### Conta e Partner Tag

A conta precisa participar do Programa de Associados da Amazon no marketplace correspondente. Configure a Partner Tag da conta:

```env
AMAZON_PARTNER_TAG=
AMAZON_MARKETPLACE=www.amazon.com.br
```

Com a Partner Tag, o backend consegue validar e manter links rastreáveis compatíveis com o domínio Amazon.

### Creators API

Quando sua conta estiver elegível para a integração oficial, configure as credenciais da Amazon Creators API:

```env
AMAZON_ENABLED=true
AMAZON_CREATORS_CREDENTIAL_ID=
AMAZON_CREATORS_CREDENTIAL_SECRET=
AMAZON_CREATORS_CREDENTIAL_VERSION=3.1
AMAZON_CREATORS_API_BASE_URL=https://creatorsapi.amazon
```

O backend já possui fluxo OAuth 2.0, cache de token, busca e validação da Partner Tag.

## Shopee

### Affiliate Open API

Para retorno de `offerLink` oficial e rastreável, configure as credenciais da conta aprovada no programa de afiliados:

```env
SHOPEE_ENABLED=true
SHOPEE_APP_ID=
SHOPEE_SECRET=
SHOPEE_AFFILIATE_GRAPHQL_URL=https://open-api.affiliate.shopee.com.br/graphql
```

O adaptador envia a assinatura SHA-256 e aceita como afiliado somente o `offerLink` compatível com a Shopee.

### Operação sem Apify

Para manter a solução sem custo de API terceirizada, deixe obrigatoriamente:

```env
APIFY_TOKEN=
```

Sem token, o fallback Apify não é executado. O sistema tenta a API oficial quando configurada e a descoberta pública disponível no adaptador.

## WhatsApp e grupos de ofertas

O sistema já suporta distribuição por:

- WhatsApp genérico;
- Evolution API;
- Telegram;
- Webhook.

Para WhatsApp/Evolution, cadastre o canal no painel administrativo. A oferta só deve entrar no disparo automático quando houver link afiliado verificado.

Exemplo Evolution API:

```json
{
  "baseUrl": "https://evolution.seudominio.com",
  "apiKey": "SUA_API_KEY",
  "instanceName": "minha-instancia",
  "number": "5547999999999",
  "audience": "private"
}
```

## Configuração recomendada para produção

```env
REQUIRE_VERIFIED_AFFILIATE_LINKS=true

MERCADO_LIVRE_SITE_ID=MLB
MERCADO_LIVRE_ACCESS_TOKEN=
AFFILIATE_LINK_RESOLVER_URL=
AFFILIATE_LINK_RESOLVER_TOKEN=

AMAZON_ENABLED=true
AMAZON_CREATORS_CREDENTIAL_ID=
AMAZON_CREATORS_CREDENTIAL_SECRET=
AMAZON_CREATORS_CREDENTIAL_VERSION=3.1
AMAZON_PARTNER_TAG=
AMAZON_MARKETPLACE=www.amazon.com.br

SHOPEE_ENABLED=true
SHOPEE_APP_ID=
SHOPEE_SECRET=
SHOPEE_AFFILIATE_GRAPHQL_URL=https://open-api.affiliate.shopee.com.br/graphql

# Sem API terceirizada paga
APIFY_TOKEN=
```

## Fluxo final esperado

1. Usuário pesquisa uma palavra-chave ou a automação executa uma fonte cadastrada.
2. Adaptador consulta Mercado Livre, Amazon ou Shopee.
3. Backend normaliza preço, desconto, imagem, seller e URL.
4. Sistema calcula score e aplica regras de qualificação.
5. Afiliação é validada pela integração oficial/autorizada.
6. Oferta recebe `affiliateEligible=true` somente com link rastreável aceito.
7. Regra de automação seleciona a promoção.
8. Oferta é enviada para os canais ativos de WhatsApp/Evolution/Telegram/Webhook.
9. Logs registram sucesso ou falha do disparo.

## O que não fazer

- Não usar scraping pago como dependência obrigatória quando a meta for custo zero.
- Não criar parâmetros de afiliado falsos.
- Não mascarar link comum como link com comissão.
- Não enviar automaticamente uma oferta não verificada.
- Não colocar APP ID, Secret, token OAuth ou Partner Tag secreta no frontend.
