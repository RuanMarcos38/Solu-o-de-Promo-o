# Central de Afiliados — operação de ofertas

## Objetivo

A plataforma foi organizada para executar o fluxo comercial:

1. buscar ofertas nos marketplaces;
2. transformar a URL do produto em um link rastreável da conta de afiliado;
3. marcar a oferta como afiliada somente quando existir um link válido;
4. enviar a promoção aos grupos/canais WhatsApp configurados;
5. manter a comissão atribuída à conta conectada no marketplace.

## Regra de segurança

A plataforma **não armazena a senha pessoal do Mercado Livre, Shopee ou Amazon**.

- Mercado Livre: conexão de conta por OAuth 2.0 e tokens no backend.
- Shopee: App ID e Secret da Affiliate Open API.
- Amazon: Partner Tag do Programa de Associados e, quando disponível, credenciais da API oficial.

As credenciais inseridas na Central de Afiliados são armazenadas criptografadas com AES-256-GCM usando a mesma camada segura já utilizada pelo backend para configurações sensíveis.

## Mercado Livre

### Conexão da conta

Na Central de Afiliados informe:

- Client ID / App ID da aplicação Mercado Livre;
- Client Secret;
- URL de retorno OAuth registrada na aplicação;
- opcionalmente um resolvedor autorizado de links de afiliado.

Depois clique em **Conectar Mercado Livre**. O usuário é enviado para a página oficial de autorização do Mercado Livre; a senha continua sendo digitada somente no domínio do Mercado Livre.

### Links de comissão

A conexão OAuth permite catálogo autenticado, mas não transforma automaticamente qualquer URL em link de afiliado se a conta não tiver um mecanismo autorizado para essa conversão.

A plataforma suporta duas rotas:

1. **automática:** configurar um resolvedor autorizado no backend;
2. **manual oficial:** gerar o link na Central de Afiliados do Mercado Livre e colar o link na seção "Vincular link gerado no portal".

A oferta só fica liberada para WhatsApp depois que o link afiliado for validado.

## Shopee

Cadastre na Central de Afiliados:

- App ID;
- App Secret;
- endpoint da Affiliate Open API.

Com as credenciais válidas, o backend utiliza a API de afiliados para gerar um `shortLink` rastreável. Também aceita o `offerLink` retornado pela busca oficial de produtos.

Os domínios de links da Shopee aceitos incluem `shopee.com.br`, `s.shopee.com.br` e `shope.ee`.

## Amazon

Cadastre:

- Partner Tag da conta do Programa de Associados;
- Credential ID e Credential Secret quando a conta tiver acesso à API de catálogo;
- endpoints adicionais apenas quando fornecidos pela Amazon para a conta.

A Partner Tag é adicionada às URLs elegíveis da Amazon e a oferta passa a apontar para a conta configurada.

## Afiliação em lote

A Central de Afiliados possui a ação **Afiliar ofertas**.

Ela seleciona as ofertas pendentes de maior score e tenta gerar links oficiais/rastreáveis para até 50 produtos por execução. Produtos que não puderem receber link de comissão permanecem pendentes e não entram automaticamente no disparo.

## WhatsApp

O fluxo existente de WhatsApp/Evolution continua preservado. A automação só deve disparar ofertas quando `affiliateEligible=true` e houver `affiliateUrl`.

Fluxo recomendado diário:

**Buscar ofertas → Afiliar ofertas em lote → revisar pendências → enviar ao WhatsApp.**

## Variáveis de ambiente existentes

A Central de Afiliados não remove suporte às variáveis de ambiente atuais. Se nenhuma configuração for salva no banco, o backend continua utilizando os valores definidos no EasyPanel.

Principais variáveis já suportadas:

- `MERCADO_LIVRE_ACCESS_TOKEN`
- `AFFILIATE_LINK_RESOLVER_URL`
- `AFFILIATE_LINK_RESOLVER_TOKEN`
- `SHOPEE_APP_ID`
- `SHOPEE_SECRET`
- `SHOPEE_AFFILIATE_GRAPHQL_URL`
- `AMAZON_PARTNER_TAG`
- `AMAZON_CREATORS_CREDENTIAL_ID`
- `AMAZON_CREATORS_CREDENTIAL_SECRET`

## Observação de produção

Não colocar credenciais reais em `.env.example`, commits, issues ou documentação. Configure-as pela Central de Afiliados ou como secrets/variáveis privadas no EasyPanel.
