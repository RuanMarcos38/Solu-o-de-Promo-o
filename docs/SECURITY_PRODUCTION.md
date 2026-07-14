# Segurança e Produção

Este documento descreve os requisitos mínimos para publicar o Radar de Ofertas com segurança.

## 1. Variáveis obrigatórias

Em produção, configure no EasyPanel, Coolify, Railway, Render ou secret manager da VPS:

```bash
NODE_ENV=production
FRONTEND_ORIGINS=https://painel.seudominio.com
PUBLIC_API_URL=https://api.seudominio.com
JWT_EXPIRES_IN=30m
BOOTSTRAP_ADMIN_ENABLED=false
ALLOW_INSECURE_OUTBOUND_HTTP=false
```

Gere segredos exclusivos:

```bash
openssl rand -hex 48
openssl rand -base64 32
```

Use o primeiro resultado em `JWT_SECRET` e o segundo em `CHANNEL_CONFIG_ENCRYPTION_KEY`.

Nunca reutilize essas chaves entre desenvolvimento, homologação e produção.

## 2. Criação inicial do administrador

No primeiro deploy de um banco vazio:

```bash
BOOTSTRAP_ADMIN_ENABLED=true
ADMIN_NAME=Administrador
ADMIN_EMAIL=seu-email-corporativo
ADMIN_PASSWORD=uma-senha-forte-com-12-ou-mais-caracteres
```

Depois que o usuário for criado:

1. confirme o login;
2. altere `BOOTSTRAP_ADMIN_ENABLED=false`;
3. remova `ADMIN_PASSWORD` das variáveis da aplicação;
4. faça um novo deploy.

O backend não cria automaticamente administradores em produção quando o bootstrap está desabilitado.

## 3. CORS e domínios

`FRONTEND_ORIGINS` aceita uma lista separada por vírgulas:

```bash
FRONTEND_ORIGINS=https://painel.seudominio.com,https://admin.seudominio.com
```

Não use `*`. Informe somente origens completas, sem caminho adicional.

## 4. Configurações criptografadas

Novas configurações de fontes e canais são armazenadas com AES-256-GCM usando `CHANNEL_CONFIG_ENCRYPTION_KEY`.

A API retorna somente um resumo mascarado das configurações. Tokens, API keys, senhas, headers e autorizações não são devolvidos pelo endpoint administrativo.

Configurações antigas em texto puro continuam legíveis para compatibilidade, mas devem ser abertas e salvas novamente no painel para serem criptografadas.

Não altere `CHANNEL_CONFIG_ENCRYPTION_KEY` sem um plano de migração. A troca direta da chave torna configurações já criptografadas ilegíveis.

## 5. Chamadas externas e SSRF

Webhooks, WhatsApp e Evolution API passam por validação de URL, resolução DNS, bloqueio de endereços privados e timeout.

Em produção, HTTP sem TLS é bloqueado por padrão:

```bash
ALLOW_INSECURE_OUTBOUND_HTTP=false
```

Quando um provedor confiável estiver em uma rede Docker privada, adicione somente o hostname necessário:

```bash
ALLOW_PRIVATE_OUTBOUND_HOSTS=evolution,whatsapp-provider.internal
```

Não adicione curingas, `localhost`, ranges de IP ou hosts desnecessários.

## 6. Banco e Redis

O Docker Compose limita PostgreSQL e Redis ao endereço de loopback por padrão:

```bash
POSTGRES_BIND_ADDRESS=127.0.0.1
REDIS_BIND_ADDRESS=127.0.0.1
```

O Redis utiliza autenticação e persistência AOF. Em produção:

- use senhas fortes e exclusivas;
- prefira banco e Redis gerenciados;
- não publique as portas 5432 e 6379 na internet;
- limite acesso por firewall e rede privada;
- habilite criptografia em trânsito quando o serviço estiver fora da rede Docker.

## 7. SSL e proxy reverso

Publique API e frontend somente por HTTPS. Configure:

- certificado TLS válido;
- redirecionamento HTTP para HTTPS;
- HSTS depois de validar o domínio;
- limite de tamanho de request no proxy;
- timeout superior ao healthcheck, mas inferior ao timeout global da plataforma;
- preservação de `X-Forwarded-For` e `X-Request-Id`.

A API usa `trustProxy=1` em produção. Mantenha apenas um proxy confiável diretamente à frente da aplicação ou ajuste essa política antes de adicionar novas camadas.

## 8. Controle de acesso

Papéis disponíveis:

| Operação | VIEWER | EDITOR | ADMIN |
|---|---:|---:|---:|
| Visualizar ofertas | Sim | Sim | Sim |
| Visualizar fontes e alertas | Sim | Sim | Sim |
| Executar coleta | Não | Sim | Sim |
| Alterar fontes e alertas | Não | Sim | Sim |
| Visualizar logs de envio | Não | Sim | Sim |
| Gerenciar canais | Não | Não | Sim |
| Gerenciar usuários e sistema | Não | Não | Sim |

O backend consulta o usuário no PostgreSQL a cada requisição autenticada. Bloquear ou alterar o papel de um usuário produz efeito imediato, mesmo que ele ainda possua um JWT não expirado.

## 9. Backup

Requisitos mínimos:

- backup diário do PostgreSQL;
- retenção mínima de 7 cópias diárias e 4 semanais;
- cópia externa à VPS principal;
- teste mensal de restauração;
- registro do horário e resultado de cada backup;
- proteção separada da chave `CHANNEL_CONFIG_ENCRYPTION_KEY`.

Um backup do banco sem a chave de criptografia não permite recuperar configurações sensíveis.

## 10. Observabilidade

Monitore:

- `/health` para disponibilidade do processo;
- `/ready` para PostgreSQL e Redis;
- reinícios dos containers;
- jobs BullMQ em `failed` e `delayed`;
- logs de dispatch com status `FAILED`;
- latência e erros por marketplace;
- espaço em disco do PostgreSQL e Redis;
- expiração de certificado TLS.

Nunca envie tokens, senhas, payloads completos de canal ou variáveis de ambiente aos logs.

## 11. Checklist de go-live

- [ ] `NODE_ENV=production` configurado.
- [ ] `JWT_SECRET` aleatório com pelo menos 32 caracteres.
- [ ] `CHANNEL_CONFIG_ENCRYPTION_KEY` gerada com 32 bytes em base64.
- [ ] `BOOTSTRAP_ADMIN_ENABLED=false` após criação do primeiro administrador.
- [ ] `ADMIN_PASSWORD` removida após o bootstrap.
- [ ] `FRONTEND_ORIGINS` contém somente domínios autorizados.
- [ ] HTTPS válido para frontend e API.
- [ ] PostgreSQL e Redis sem exposição pública.
- [ ] Redis com senha forte.
- [ ] Backups configurados e restauração testada.
- [ ] Evolution/WhatsApp privado incluído somente quando necessário na allowlist.
- [ ] Healthcheck e readiness respondendo.
- [ ] Usuários VIEWER e EDITOR testados.
- [ ] Configurações antigas de canais salvas novamente para criptografia.
- [ ] Logs revisados para confirmar ausência de segredos.

## 12. Validação

Antes de publicar:

```bash
npm install
npm run db:generate
npm run lint
npm run build
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://localhost:3333/health
curl -fsS http://localhost:3333/ready
```

Depois, valide pelo domínio HTTPS e não apenas pelas portas locais.
