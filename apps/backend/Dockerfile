# ─────────────────────────────────────────────────────────────
#  SimpleCI Backend Dockerfile
#  Uses node:20-slim (Debian) — avoids Alpine/musl Prisma issues
# ─────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL (required by Prisma schema engine)
RUN apt-get update -qq && apt-get install -y -qq openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

# Install git (process runner clones repos) + OpenSSL (Prisma)
RUN apt-get update -qq && apt-get install -y -qq git openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
