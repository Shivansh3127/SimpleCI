# ─────────────────────────────────────────────────────────────
#  SimpleCI Backend Dockerfile
#  Multi-stage build: builder → production image
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source & build TypeScript
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install git (needed by process runner to clone repos)
RUN apk add --no-cache git

WORKDIR /app

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output + prisma schema
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

EXPOSE 3000

# Run migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
