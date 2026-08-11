# Supabase — conexão segura do Promotion Radar

O projeto usa o Supabase como PostgreSQL gerenciado por meio do Prisma. A aplicação não acessa as tabelas diretamente pelo navegador e não necessita do Data API/PostgREST para funcionar.

## 1. Projeto e isolamento

Este repositório usa o projeto **CRM R2 MARKETING DIGITAL** (`iqrnytsgwaiegddfxfjs`) somente dentro do schema exclusivo `zenite_ofertas`. As migrations Supabase não criam nem modificam objetos em `public`, `gestao_ads`, `n8n_meta_reports` ou nos demais schemas do CRM.

Os arquivos versionados em `deploy/supabase/` são a fonte da estrutura gerenciada no Supabase. No deploy que aponta para este banco compartilhado, mantenha `DATABASE_MIGRATIONS_MANAGED_EXTERNALLY=true` para impedir que o container tente reaplicar as migrations Prisma destinadas ao PostgreSQL local.

As configurações operacionais ficam nas tabelas `zenite_ofertas."PlatformSetting"` e `zenite_ofertas."PlatformSettingAudit"`. Ambas usam RLS, revogam `anon` e `authenticated` e permitem acesso somente ao papel dedicado `zenite_ofertas_backend`.

Migrations Supabase, em ordem:

1. `20260808150000_zenite_ofertas_isolated.sql`
2. `20260808152000_zenite_backend_role.sql`
3. `20260808162000_zenite_runtime_settings.sql`

## 2. Usuário exclusivo do Prisma

O papel de permissões `zenite_ofertas_backend` já é criado pela migration sem capacidade de login e só recebe acesso ao schema isolado. No SQL Editor do projeto, crie uma senha forte para o login da aplicação:

```sql
create user "prisma_zenite"
  with password 'SUBSTITUA_POR_SENHA_FORTE'
  nosuperuser nocreatedb nocreaterole inherit nobypassrls;
grant "zenite_ofertas_backend" to "prisma_zenite";
```

O papel `prisma_zenite` fica somente no backend e herda exclusivamente as permissões definidas para a plataforma. Nunca coloque essa URL ou senha no frontend.

## 3. URL para VPS/EasyPanel

Para API e worker em containers permanentes, use o Supavisor em modo Session (porta 5432):

```env
DATABASE_URL=postgresql://prisma_zenite.iqrnytsgwaiegddfxfjs:SENHA@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require&schema=zenite_ofertas&connect_timeout=30&pool_timeout=30&connection_limit=5
DATABASE_MIGRATIONS_MANAGED_EXTERNALLY=true
```

Copie os valores reais na tela **Connect** do Supabase. Não copie exemplos literais.

## 4. Aplicar e validar

```bash
npm ci
npm run db:generate
npm run test:integration
```

As migrations Supabase isoladas habilitam RLS, revogam o acesso das funções `anon` e `authenticated` e concedem ao backend apenas as operações necessárias dentro de `zenite_ofertas`. O papel da aplicação não usa `bypassrls`.

Depois da migration, execute os Advisors de segurança e desempenho no Supabase. Se o projeto usar exclusivamente Prisma, também é possível desligar o Data API nas configurações de API do projeto.

## 5. Deploy serverless futuro

Se a API migrar para ambiente serverless/auto-scaling, use Supavisor Transaction (porta 6543) na aplicação com `pgbouncer=true` e mantenha uma URL Session/Direct separada para migrations. Não aplique essa configuração ao deploy atual em VPS sem necessidade.
