# Pacote EasyPanel

Arquivos deste pacote:

- `../../Dockerfile` — API resiliente, healthcheck de vida e porta 3333;
- `../../Dockerfile.worker` — worker BullMQ e métricas internas na porta 9464;
- `../../Dockerfile.web` — frontend Nginx na porta 80;
- `../../Dockerfile.prometheus` — Prometheus com regras e targets internos;
- `../../Dockerfile.alertmanager` — Alertmanager com configuração gerada a partir de Environment Secrets;
- `../../Dockerfile.grafana` — Grafana com dashboards provisionados;
- `easypanel.env.example` — variáveis da API e worker;
- `nginx.conf` — fallback SPA, healthcheck e headers;
- `alertmanager.yml.tmpl` — roteamento de alertas;
- `alertmanager-entrypoint.sh` — validação e inicialização segura;
- `grafana-dashboard-provider.yml` — provisionamento fora do volume de dados.

O passo a passo completo está em `docs/EASYPANEL_DEPLOY.md`.
