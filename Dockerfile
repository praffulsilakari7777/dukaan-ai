# Builds the web app, then runs the zero-dependency Node server on Cloud Run.
FROM node:20-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY server/ ./
COPY --from=web /web/dist ./public
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "index.mjs"]
