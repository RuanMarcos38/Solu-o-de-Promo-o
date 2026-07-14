# Go-Live e Homologação

## Ambiente definido

A homologação do Radar de Ofertas usa a infraestrutura já conhecida da operação, sem alterar o site principal, CRM ou n8n.

| Serviço | Endereço |
|---|---|
| VPS Hostinger | `2.25.155.142` |
| Aplicação | `https://ofertas.r2rmarketingdigital.com.br` |
| API | `https://api-ofertas.r2rmarketingdigital.com.br` |
| Grafana | `https://grafana-ofertas.r2rmarketingdigital.com.br` |
| Release inicial | `v0.1.0-rc.1` |

Serviços protegidos que não devem ser alterados: domínio raiz, `www`, `crm` e `n8n`.

## Bloqueios externos atuais

O repositório não possui acesso ao painel DNS da Hostinger/Cloudflare, SSH da VPS ou credenciais reais de SMTP, Telegram, webhooks, OIDC e GHCR. Portanto, a publicação real somente pode começar após esses acessos serem configurados.

## 1. Criar os registros DNS

Os registros estão em:

```text
 deploy/dns/r2rmarketingdigital.com.br.homologation.zone
```

Crie três registros `A`, TTL 300:

```text
ofertas          → 2.25.155.142
api-ofertas      → 2.25.155.142
grafana-ofertas  → 2.25.155.142
```

Não altere os registros existentes do domínio principal, `www`, `crm` ou `n8n`.

## 2. Preparar o arquivo local de homologação

```bash
cp deploy/homologation.env.example deploy/homologation.env
```

Preencha obrigatoriamente:

```text
TLS_EMAIL
SSH_USER
SSH_PORT
REMOTE_APP_DIR
```

O arquivo `deploy/homologation.env` não deve ser versionado.

## 3. Preparar a VPS

Requisitos mínimos:

- Ubuntu LTS atualizado;
- Docker Engine e Docker Compose Plugin;
- Git;
- portas 22, 80 e 443 liberadas;
- pelo menos 4 GB de RAM e armazenamento compatível com PostgreSQL, Redis e observabilidade;
- acesso de leitura ao GHCR;
- diretório `/opt/promotion-radar` pertencente ao usuário de deploy.

Clone o repositório depois que o PR #14 estiver mesclado em `main`:

```bash
sudo mkdir -p /opt/promotion-radar
sudo chown "$USER":"$USER" /opt/promotion-radar
git clone https://github.com/RuanMarcos38/Solu-o-de-Promo-o.git /opt/promotion-radar
cd /opt/promotion-radar
bash scripts/prepare-production.sh
```

Preencha `.env.production`, `.env.production.secrets` e `deploy/secrets/` com os valores reais.

## 4. Validar DNS, portas, GitHub e SSH

```bash
bash scripts/go-live-preflight.sh deploy/homologation.env
```

O preflight só aprova quando:

- os três subdomínios apontam para `2.25.155.142`;
- SSH está autorizado sem interação;
- portas 80 e 443 estão acessíveis;
- Docker está disponível;
- GitHub CLI está autenticado quando usado para publicar a release.

## 5. Publicar a primeira release

O workflow `Release Images` precisa existir na branch `main`. Portanto, primeiro mescle o PR #14.

Depois execute:

```bash
bash scripts/publish-homologation-release.sh deploy/homologation.env
```

O script:

1. executa o preflight;
2. publica `v0.1.0-rc.1` no GHCR;
3. aguarda o workflow finalizar;
4. acessa a VPS por SSH;
5. executa o deploy da release;
6. valida HTTPS, API, Grafana, CORS, headers, certificado e Socket.IO.

## 6. Smoke test manual

```bash
bash scripts/go-live-smoke.sh deploy/homologation.env
```

Critérios obrigatórios:

- aplicação HTTP 200;
- API `/ready` HTTP 200;
- Grafana `/api/health` HTTP 200;
- `/metrics` público HTTP 404;
- redirecionamento HTTP para HTTPS;
- HSTS e headers de segurança;
- CORS restrito à aplicação;
- certificado com pelo menos 14 dias restantes;
- handshake Socket.IO ativo.

## 7. SSO do Grafana

Configure no provedor OIDC o callback:

```text
https://grafana-ofertas.r2rmarketingdigital.com.br/login/generic_oauth
```

Preencha em `.env.production`:

```text
GRAFANA_OAUTH_ENABLED=true
GRAFANA_OAUTH_CLIENT_ID=
GRAFANA_OAUTH_AUTH_URL=
GRAFANA_OAUTH_TOKEN_URL=
GRAFANA_OAUTH_API_URL=
GRAFANA_OAUTH_ALLOWED_DOMAINS=
GRAFANA_OAUTH_ROLE_ATTRIBUTE_PATH=
```

Grave o client secret apenas em:

```text
deploy/secrets/grafana_oauth_client_secret
```

Mantenha o login administrativo local ativo até o primeiro acesso SSO ser validado.

## 8. Drill completo de backup, restore e rollback

São necessárias duas releases publicadas:

```text
v0.1.0-rc.0
v0.1.0-rc.1
```

No arquivo `deploy/homologation.env`, defina:

```text
DRILL_CONFIRM=HOMOLOGATION_DISASTER_RECOVERY
DRILL_PREVIOUS_RELEASE=v0.1.0-rc.0
DRILL_CURRENT_RELEASE=v0.1.0-rc.1
```

Execute:

```bash
bash scripts/homologation-dr-drill.sh deploy/homologation.env
```

O drill:

1. cria um backup de controle;
2. adiciona sentinelas no PostgreSQL e Redis depois do backup;
3. restaura o backup;
4. confirma que as sentinelas desapareceram;
5. executa rollback para a release anterior;
6. valida os endpoints;
7. retorna para a release atual;
8. registra o resultado em `.deploy/last-dr-drill.env`.

Execute o drill somente na homologação. A restauração derruba temporariamente API, worker e frontend.

## 9. Critérios para promover a produção

- DNS estável por pelo menos 24 horas;
- todos os workflows verdes;
- smoke test aprovado;
- SSO validado com usuário real;
- alertas de teste entregues em todos os canais;
- backup copiado para armazenamento externo;
- restore e rollback aprovados;
- nenhum item inesperado na DLQ;
- dashboards e SLOs recebendo dados;
- registro do responsável pela aprovação.

## Evidência de homologação

Após o go-live, registre:

```text
Release:
Data UTC:
Operador:
Resultado do preflight:
Resultado do smoke:
Backup utilizado:
Release de rollback:
Resultado do restore:
Resultado do SSO:
Resultado dos alertas:
Observações:
```
