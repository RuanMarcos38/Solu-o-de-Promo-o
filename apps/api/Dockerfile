FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN export DATABASE_URL="postgresql://localhost:5432/promo_db" && npm run prisma:generate -w apps/api
RUN npm run build -w apps/api

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps/api/package*.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/node_modules node_modules
EXPOSE 3333
CMD ["npm", "run", "start", "-w", "apps/api"]
