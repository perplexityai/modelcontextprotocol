FROM node:22.12-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy only necessary files for build (exclude index.ts for stdio-based server)
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY server.ts ./

ENV CI=true

RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:22-alpine AS release

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml

ENV NODE_ENV=production

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

EXPOSE 8080

ENTRYPOINT ["node", "dist/server.js"]
