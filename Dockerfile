# syntax=docker/dockerfile:1

# ---------------------------------------------------------------
# Deploying on Dokploy
#
#   Application -> Build Type: Dockerfile (path: ./Dockerfile)
#   Environment -> Build-time Arguments: the NEXT_PUBLIC_* values
#                  listed in Stage 2 (inlined into the client bundle)
#   Environment -> Environment Settings: runtime secrets
#                  (SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY,
#                  META_APP_SECRET, ... see .env.local.example)
#   Domains     -> Container Port: 3000
#
# Changing any NEXT_PUBLIC_* value requires a redeploy (rebuild).
# ---------------------------------------------------------------

# ---------------------------------------------------------------
# Stage 1 — install dependencies (cached until package*.json change)
# ---------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------
# Stage 2 — build
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build
# time, so they must be provided as build args (Dokploy build-time
# arguments, or docker-compose.yml forwarding them from .env.local).
# Server-only secrets (service role key, ENCRYPTION_KEY,
# META_APP_SECRET, ...) are read at runtime and must NOT be baked
# into the image.
# ---------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE=en
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------
# Stage 3 — minimal runtime (standalone output)
# ---------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000

# Lets Dokploy (Swarm) hold traffic on the old container until the
# new one answers. Any non-5xx counts: / redirects to /login.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then((r)=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
