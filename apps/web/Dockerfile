FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/*/package*.json apps/*/
RUN npm install
COPY . .
RUN npm run build -w apps/web

FROM nginx:1.27-alpine AS runner
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
