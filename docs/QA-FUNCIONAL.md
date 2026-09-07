# QA funcional da plataforma

Este projeto possui uma validação automatizada em ambiente isolado para impedir regressões antes da publicação.

O fluxo de QA sobe PostgreSQL, Redis, API e frontend, cria dados temporários, valida as rotas críticas do backend e usa um navegador Chromium para testar os principais botões e a integração frontend → backend.

A cobertura inclui autenticação e sessão, Dashboard, Ofertas, Marketplaces, Automação, Configurações, fontes, alertas, usuários, canais de distribuição, Central de Afiliados, OAuth do Mercado Livre, configuração da Shopee e Amazon, afiliação em lote, vínculo de link afiliado, grupos de WhatsApp e tratamento de erros HTTP/JavaScript.

Os testes não usam credenciais reais de clientes nem enviam ofertas para grupos reais. Integrações externas reais continuam dependendo das credenciais e autorizações oficiais de cada marketplace/provedor.