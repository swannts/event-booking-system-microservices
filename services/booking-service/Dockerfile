FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @event-booking/booking-service... build
RUN pnpm --filter @event-booking/booking-service deploy --prod --legacy /runtime

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps

RUN apk add --no-cache dumb-init

COPY --from=builder --chown=node:node /runtime ./

USER node

EXPOSE 3002

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
