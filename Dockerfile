# Stage 1: Build UI
FROM node:20-alpine AS ui-build
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY ui/ ./
RUN npm run build

# Stage 2: Build Server
FROM node:20-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# Stage 3: Production
FROM node:20-alpine AS production
WORKDIR /app

# Install production deps only
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --frozen-lockfile 2>/dev/null || npm install --omit=dev

# Copy built artifacts
COPY --from=server-build /app/dist ./dist
COPY --from=ui-build /app/ui/dist ./ui/dist

# Create data directory
RUN mkdir -p /data /app/logs

ENV NODE_ENV=production
ENV SQLITE_PATH=/data/logserver.db
ENV PORT=3100

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3100/api/health || exit 1

CMD ["node", "dist/index.js"]
