FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:3333
ENV VITE_API_URL=$VITE_API_URL
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w apps/web

FROM nginx:1.27-alpine AS runner
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
