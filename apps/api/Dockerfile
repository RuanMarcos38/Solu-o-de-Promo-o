FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
RUN npm install --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
RUN export DATABASE_URL="postgresql://localhost:5432/promo_db" && npm run prisma:generate -w apps/api
RUN npm run build -w apps/api
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
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
