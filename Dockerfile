# ============================================================
# NOVA TV — universal container image
# Works on Railway, Koyeb, Fly.io, Google Cloud Run, Render
# (Docker), a VPS, or anywhere that runs containers.
# ------------------------------------------------------------
# The image bundles the static Psiphon client so the server can
# obtain a residential exit IP and fetch the REAL watch servers
# even from a datacenter host.
# ============================================================
FROM node:20-slim

# curl is handy for the healthcheck; ca-certificates for HTTPS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# App (zero runtime dependencies, but copy package.json for npm start).
COPY package.json ./
COPY . .

# Make the bundled Psiphon client executable.
RUN chmod +x tools/psiphon-tunnel-core tools/start-psiphon.sh || true

ENV NODE_ENV=production
ENV PORT=3000
# Start the bundled Psiphon tunnel automatically (set to 1 to disable).
ENV OSCAR_NO_PSIPHON=0
# Background snapshot refresh cadence (hours). 0 = rely on GitHub Actions.
ENV AUTO_REFRESH_HOURS=0
# Pull the freshest JSON snapshots from GitHub raw (no redeploy needed).
ENV DATA_SYNC_URL=https://raw.githubusercontent.com/meaee1m-dot/Nova/main/site/data
ENV DATA_SYNC_MINUTES=5

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
