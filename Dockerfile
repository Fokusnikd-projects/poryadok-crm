FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 CRM_DB_PATH=/data/crm.sqlite
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server/start.mjs"]
