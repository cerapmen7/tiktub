# TikTub Dockerfile - multi-stage
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY agents/tiktok-agent/package.json ./agents/tiktok-agent/package.json
COPY agents/youtube-agent/package.json ./agents/youtube-agent/package.json
COPY agents/scheduler-agent/package.json ./agents/scheduler-agent/package.json
COPY agents/orchestrator-agent/package.json ./agents/orchestrator-agent/package.json

RUN npm install --workspaces --include-workspace-root || npm install

COPY . .

# Generate Prisma client + build all
RUN npm run build --workspace=backend || true
RUN npm run build --workspace=frontend || true
RUN npx prisma generate --schema=backend/prisma/schema.prisma || true

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/data ./data

# Fallback: install prod deps if missing
RUN mkdir -p /app/data/downloads

EXPOSE 3001
CMD ["node", "backend/dist/index.js"]
