# Validação da Solução

Este arquivo existe para abrir um Pull Request de validação e disparar os workflows do GitHub Actions por `pull_request`.

## Formas de validar

1. GitHub Actions `CI`: executa instalação, Prisma generate, typecheck e build.
2. GitHub Actions `Docker Build`: executa build Docker, sobe banco/Redis, roda migrations e testa `/health`.
3. Local Linux/Mac: `bash scripts/verify-local.sh`.
4. Local Windows PowerShell: `powershell -ExecutionPolicy Bypass -File scripts/verify-local.ps1`.
5. Docker direto: `docker compose up --build`.
