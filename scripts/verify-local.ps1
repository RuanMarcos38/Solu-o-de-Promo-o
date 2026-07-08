$ErrorActionPreference = "Stop"

if (!(Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host ".env criado a partir de .env.example"
}

Write-Host "Subindo Postgres e Redis..."
docker compose up -d postgres redis

Write-Host "Instalando dependências..."
npm install

Write-Host "Gerando Prisma Client..."
npm run db:generate

Write-Host "Aplicando migrations..."
npm run db:migrate

Write-Host "Executando typecheck e build..."
npm run verify

Write-Host "Validando build Docker..."
docker compose build api worker web migrate

Write-Host "Validação concluída com sucesso."
