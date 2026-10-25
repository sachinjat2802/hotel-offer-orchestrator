# ── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Default command starts the Express server.
# The worker is started as a separate service in Docker Compose.
CMD ["node", "dist/index.js"]
