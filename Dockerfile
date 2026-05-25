# ==============================
# Stage 1: Build the executable
# ==============================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace config files for layer caching (npm ci layer stays cached
# when only source code changes, not package.json). Preserve root package.json
# and add workspace package.json files without overwriting it.
COPY package.json package-lock.json tsconfig.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json

# Copy full workspace directories so TypeScript source code is available
# for compilation and bundling
COPY server/ server/
COPY web/ web/
COPY sea-config.json ./sea-config.json
COPY scripts/ ./scripts/
COPY opencode-template/ ./opencode-template/

# Install build tools + all workspace dependencies (dev + prod) in one layer
# so intermediate artifacts (build tools, node_modules) do not persist.
RUN apk add --no-cache python3 make g++ && \
    npm ci && \
    npm run build && \
    npm run build:sea:linux && \
    apk del python3 make g++ && \
    rm -rf node_modules && \
    rm -rf /tmp/*

# ==============================
# Stage 2: Minimal production image
# ==============================
FROM alpine:3.21

# Install only runtime dependencies needed by the executable
RUN apk add --no-cache ca-certificates libstdc++

WORKDIR /app

# Copy the bundled SEA executable and all runtime support files
# from the builder stage:
# - dist/agent-kanban          : the SEA executable itself
# - dist/node_modules/         : better-sqlite3 native addon
# - dist/web/dist/             : built WebUI (served by the server)
# - dist/opencode-template/    : opencode config templates for ZIP generation
COPY --from=builder /app/dist/agent-kanban ./dist/agent-kanban
COPY --from=builder /app/dist/node_modules ./dist/node_modules
COPY --from=builder /app/dist/web ./dist/web
COPY --from=builder /app/dist/opencode-template ./dist/opencode-template

# Create a non-root user for defense-in-depth security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app && \
    chmod +x /app/dist/agent-kanban

# Create a data directory for the SQLite database (persistent across restarts)
RUN mkdir -p /app/data 

# Expose the WebUI/REST API port and the MCP server port
EXPOSE 3000 3001

# Set default environment variables
ENV AGENT_KANBAN_HOST=0.0.0.0
ENV MCP_HOST=0.0.0.0
ENV DB_PATH=/app/data/agent-kanban.db

# Health check: probe the REST API port
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Run the bundled executable
CMD ["./dist/agent-kanban"]
