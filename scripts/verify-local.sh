#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env criado a partir de .env.example"
fi

echo "Subindo Postgres e Redis..."
docker compose up -d postgres redis

echo "Instalando dependências bloqueadas..."
npm ci

echo "Gerando Prisma Client..."
npm run db:generate

echo "Aplicando migrations..."
npm run db:migrate

echo "Executando typecheck e build..."
npm run verify

echo "Validando build Docker..."
docker compose build api worker web migrate

echo "Validação concluída com sucesso."
