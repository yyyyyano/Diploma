# syntax=docker/dockerfile:1
# Образ приложения «Кошта» (ADR-0015, T-011): один образ на api, worker и bot — роль выбирает command в compose.yaml.
# Сборка: зависимости по pnpm-lock.yaml → сайт (vite build → web/) → сервер (tsdown: один .mjs на точку входа,
# @kosht/* внутри) → pnpm deploy: только боевые npm-зависимости сервера в node_modules рядом с бандлом (libpg-query
# с .wasm и pg-boss с патчем — внешние). Запуск — node:26 slim, пользователь node, файлы образа принадлежат root:
# процесс их не перепишет, а compose.yaml ещё и монтирует корень только для чтения.
# Контекст сборки — корень репозитория; что в него попадает — docker/Dockerfile.dockerignore (белый список).
ARG NODE_IMAGE=node:26.12.1-trixie-slim

FROM ${NODE_IMAGE} AS build
# pnpm — версия из packageManager (package.json); corepack в Node 26 больше не входит.
RUN npm install --global --no-fund --no-audit pnpm@12.15.0
WORKDIR /src
COPY . .
# Скрипты установки не нужны сборке (allowBuilds — только lefthook, git-хуки разработчика).
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @kosht/web exec vite build \
  && pnpm --filter @kosht/server exec tsdown \
  && pnpm --filter @kosht/server deploy --prod /deploy

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
  MIGRATIONS_DIR=/app/drizzle \
  WEB_DIST_DIR=/app/web \
  DATA_DIR=/app/data
WORKDIR /app
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./web
USER node
CMD ["node", "dist/api.mjs"]
