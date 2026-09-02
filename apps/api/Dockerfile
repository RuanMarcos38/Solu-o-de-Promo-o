FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
RUN export DATABASE_URL="postgresql://localhost:5432/promo_db" && npm run prisma:generate -w apps/api
RUN npm run build -w apps/api
# O runtime da API/worker precisa apenas do Prisma Client. O CLI fica fora da imagem final.
RUN npm prune --omit=dev

FROM deps AS migrate
WORKDIR /app
COPY . .
# Usa uma versão do CLI sem o advisory do deepmerge-ts e somente na etapa efêmera de migration.
RUN npm install --no-save --no-audit --no-fund prisma@6.12.0
USER node
CMD ["npm", "run", "prisma:deploy", "-w", "apps/api"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps

COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/apps/api/package*.json apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma apps/api/prisma
COPY --from=build --chown=node:node /app/node_modules node_modules

USER node
EXPOSE 3333
CMD ["npm", "run", "start", "-w", "apps/api"]
