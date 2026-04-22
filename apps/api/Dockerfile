# apps/api/Dockerfile
# Multi-stage build — production image với FFmpeg

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production=false

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install FFmpeg (required for video processing)
RUN apk add --no-cache ffmpeg python3 py3-pip

WORKDIR /app

# Copy only production deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built files
COPY --from=builder /app/dist ./dist

# Create tmp directory for video processing
RUN mkdir -p /tmp/affiliateai && chmod 777 /tmp/affiliateai

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S affiliateai -u 1001
USER affiliateai

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]
