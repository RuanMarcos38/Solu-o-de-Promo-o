# Regras para Marketplaces

## Regra principal

A plataforma deve priorizar integrações oficiais e autorizadas. Raspagem de página HTML só deve ser considerada quando houver autorização expressa, baixa frequência, respeito a robots.txt e revisão jurídica/comercial.

## Mercado Livre

- Usar API pública/oficial quando possível.
- Começar pelo site `MLB` para Brasil.
- Usar token de aplicação quando a busca genérica exigir autenticação.
- Salvar item id, permalink, seller, preço, condição, thumbnail e frete.
- O permalink comum não é link afiliado.
- Aceitar somente link criado pelo Portal do Afiliado ou por resolvedor/API expressamente autorizado.
- Não distribuir links afiliados do Mercado Livre em WhatsApp, Evolution API ou grupos fechados. Telegram só pode ser usado quando o canal estiver configurado como público (`audience: public`).

## Amazon

- Usar Amazon Creators API. A antiga PA-API 5 foi descontinuada para o Brasil em 2026.
- Exige Credential ID, Credential Secret, versão da credencial e Partner Tag.
- Usar OAuth 2.0 com cache do token por até uma hora.
- Não copiar dados fora das regras do programa de afiliados.
- Cache e atualização de preço devem respeitar a documentação vigente.

## Shopee

- Usar Shopee Affiliate Open API.
- Exige App ID e Secret emitidos no portal de afiliados.
- Aceitar somente `offerLink` rastreável retornado pela API.

## Outros parceiros

Para novas fontes, criar um adaptador com:

```ts
interface MarketplaceAdapter {
  name: string;
  search(input: SearchInput): Promise<NormalizedOffer[]>;
}
```

## Qualidade mínima

A oferta deve conter:

- marketplace;
- título;
- preço atual;
- URL de compra;
- imagem quando disponível;
- categoria ou palavra-chave;
- data de captura;
- score calculado.
- `affiliateEligible=true`, `affiliateUrl`, provedor e data de verificação.

## Política anti-spam

- Não publicar a mesma oferta repetidamente.
- Limitar frequência por marketplace.
- Limitar frequência por categoria.
- Bloquear produtos com score baixo.
- Criar lista de palavras proibidas para itens sensíveis.
