# Regras para Marketplaces

## Regra principal

A plataforma deve priorizar integrações oficiais e autorizadas. Raspagem de página HTML só deve ser considerada quando houver autorização expressa, baixa frequência, respeito a robots.txt e revisão jurídica/comercial.

## Mercado Livre

- Usar API pública/oficial quando possível.
- Começar pelo site `MLB` para Brasil.
- Salvar item id, permalink, seller, preço, condição, thumbnail e frete.
- Aplicar tag/parâmetro de afiliado apenas quando houver programa autorizado.

## Amazon

- A integração deve usar Amazon Creators API/Associates conforme disponibilidade da conta.
- Exige credenciais e tag de parceiro.
- Não copiar dados fora das regras do programa de afiliados.
- Cache e atualização de preço devem respeitar a documentação vigente.

## Shopee

- Usar Shopee Open Platform ou programa de afiliados autorizado.
- Exige partner id, partner key e affiliate id.
- Gerar links rastreáveis somente via método autorizado.

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

## Política anti-spam

- Não publicar a mesma oferta repetidamente.
- Limitar frequência por marketplace.
- Limitar frequência por categoria.
- Bloquear produtos com score baixo.
- Criar lista de palavras proibidas para itens sensíveis.
