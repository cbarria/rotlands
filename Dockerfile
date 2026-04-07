# Build context = repo root (Railway, docker compose, etc.)
FROM node:22-alpine AS client-build
WORKDIR /client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=client-build /client/dist ./public
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > ./public/build.txt
RUN chown -R node:node /app
USER node
EXPOSE 3000
ENV NODE_ENV=production
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
