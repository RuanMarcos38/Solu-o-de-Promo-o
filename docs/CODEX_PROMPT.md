# Prompt para Codex / Desenvolvimento Sênior

Use este projeto como base para criar uma plataforma profissional de radar de promoções em tempo real.

## Papel

Atue como uma equipe sênior composta por arquiteto de software, desenvolvedor backend, frontend, engenheiro de dados, especialista em marketplaces, especialista em afiliados e DevOps.

## Objetivo

Desenvolver uma solução SaaS que monitora ofertas em plataformas confiáveis como Mercado Livre, Amazon, Shopee e parceiros autorizados, identifica oportunidades reais, calcula score de promoção, evita duplicidade e distribui ofertas ao vivo para usuários, canais e clientes.

## Regras obrigatórias

1. Não alterar a arquitetura sem justificar tecnicamente.
2. Priorizar APIs oficiais e programas de afiliados.
3. Não usar práticas que violem termos das plataformas.
4. Manter backend e frontend separados.
5. Manter TypeScript em modo estrito sempre que possível.
6. Usar logs claros e tratamento de erro em todos os conectores.
7. Toda oferta precisa passar por normalização, score e deduplicação.
8. Toda integração nova deve implementar a interface `MarketplaceAdapter`.
9. Toda credencial deve ser lida por variável de ambiente.
10. Não salvar segredos no repositório.
11. O painel precisa exibir status, score, marketplace, preço, desconto e data de captura.
12. O sistema deve estar preparado para escala com fila, banco e cache.

## Funcionalidades essenciais

- Varredura manual por palavra-chave.
- Varredura automática recorrente.
- Feed de ofertas aprovadas.
- Filtro por marketplace, categoria, desconto e preço.
- Histórico de preço.
- Alertas personalizados.
- Distribuição para canais.
- Painel administrativo de fontes.
- Logs de coleta e erros.
- Webhook para integrações externas.

## Critérios de aceite

- `npm install` executa sem erro.
- `npm run build` executa sem erro.
- `docker compose up --build` sobe frontend, API, banco e Redis.
- `GET /health` retorna status ok.
- `POST /collect/run` executa coleta do Mercado Livre.
- Frontend exibe ofertas retornadas pela API.
- Código preparado para Amazon e Shopee com credenciais oficiais.

## Próxima etapa recomendada

Implementar persistência completa com Prisma em todos os endpoints e mover o armazenamento temporário em memória para PostgreSQL.
